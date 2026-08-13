import { expect } from "chai";
import { network } from "hardhat";
import type { ExecutionPlan } from "../../core/src/types.js";
import type { ExecutionRuntimeDependencies, RelayPermit } from "../../runtime/src/runtime.js";
import { ExecutionRuntime } from "../../runtime/src/runtime.js";

interface TokenLike {
  balanceOf(owner: string): Promise<bigint>;
}

const { ethers, networkHelpers } = await network.create();

const FXRP_SYMBOL = "FXRP";
const USDT0_SYMBOL = "USDT0";
const WFLR_SYMBOL = "WFLR";
const ADAPTER_NAME = "TestSwapAdapter";

const FXRP_TO_USDT0_RATE = ethers.parseUnits("2.5", 6);
const USDT0_TO_FXRP_RATE = ethers.parseUnits("0.4", 30);
const FXRP_TO_WFLR_RATE = ethers.parseUnits("10", 18);
const WFLR_TO_FXRP_RATE = ethers.parseUnits("0.1", 18);

interface RuntimeFixture {
  runtime: ExecutionRuntime;
  backend: Awaited<ReturnType<typeof ethers.getSigners>>[number];
  recipient: Awaited<ReturnType<typeof ethers.getSigners>>[number];
  adapterAddress: string;
  fxrp: TokenLike;
  usdt0: TokenLike;
  wflr: TokenLike;
  fxrpAddress: string;
  usdt0Address: string;
  wflrAddress: string;
}

async function deployRuntimeFixture(): Promise<RuntimeFixture> {
  const [owner, backend, recipient] = await ethers.getSigners();

  const fxrp = await ethers.deployContract("MockERC20", [FXRP_SYMBOL, FXRP_SYMBOL, 18]);
  const usdt0 = await ethers.deployContract("MockERC20", [USDT0_SYMBOL, USDT0_SYMBOL, 6]);
  const wflr = await ethers.deployContract("MockERC20", [WFLR_SYMBOL, WFLR_SYMBOL, 18]);
  const adapter = await ethers.deployContract("TestSwapAdapter");

  const fxrpAddress = await fxrp.getAddress();
  const usdt0Address = await usdt0.getAddress();
  const wflrAddress = await wflr.getAddress();
  const adapterAddress = await adapter.getAddress();

  await fxrp.mint(backend.address, ethers.parseEther("1000"));
  await fxrp.mint(owner.address, ethers.parseEther("1000"));
  await usdt0.mint(owner.address, ethers.parseUnits("1000000", 6));
  await wflr.mint(owner.address, ethers.parseEther("1000000"));

  await fxrp.connect(owner).approve(adapterAddress, ethers.MaxUint256);
  await usdt0.connect(owner).approve(adapterAddress, ethers.MaxUint256);
  await wflr.connect(owner).approve(adapterAddress, ethers.MaxUint256);
  await adapter.fundLiquidity(fxrpAddress, ethers.parseEther("1000"));
  await adapter.fundLiquidity(usdt0Address, ethers.parseUnits("1000000", 6));
  await adapter.fundLiquidity(wflrAddress, ethers.parseEther("1000000"));

  await adapter.setRate(fxrpAddress, usdt0Address, FXRP_TO_USDT0_RATE);
  await adapter.setRate(usdt0Address, fxrpAddress, USDT0_TO_FXRP_RATE);
  await adapter.setRate(fxrpAddress, wflrAddress, FXRP_TO_WFLR_RATE);
  await adapter.setRate(wflrAddress, fxrpAddress, WFLR_TO_FXRP_RATE);

  const backendProvider = backend.provider;
  if (backendProvider === null) {
    throw new Error("hardhat backend signer has no provider");
  }

  const runtime = new ExecutionRuntime({
    provider: backendProvider,
    signer: backend,
    adapters: { [ADAPTER_NAME]: adapterAddress },
    tokens: {
      [FXRP_SYMBOL]: fxrpAddress,
      [USDT0_SYMBOL]: usdt0Address,
      [WFLR_SYMBOL]: wflrAddress,
    },
  } as unknown as ExecutionRuntimeDependencies);

  return {
    runtime,
    backend,
    recipient,
    adapterAddress,
    fxrp,
    usdt0,
    wflr,
    fxrpAddress,
    usdt0Address,
    wflrAddress,
  };
}

describe("ExecutionRuntime", function () {
  it("settles a single-hop plan and pays out the received amount", async function () {
    const { runtime, recipient, usdt0 } =
      await networkHelpers.loadFixture(deployRuntimeFixture);

    const plan: ExecutionPlan = {
      planId: "plan-success",
      estimatedCost: "0.003",
      estimatedTime: "2500",
      estimatedOutput: "5",
      estimatedPayerAmount: "2",
      steps: [
        { stepId: 1, action: "AcquireAsset", asset: FXRP_SYMBOL },
        {
          stepId: 2,
          action: "ConvertAsset",
          from: FXRP_SYMBOL,
          to: USDT0_SYMBOL,
          asset: USDT0_SYMBOL,
          preferredAdapter: ADAPTER_NAME,
          properties: { reversible: true },
        },
        { stepId: 3, action: "Transfer", asset: USDT0_SYMBOL, to: recipient.address },
        { stepId: 4, action: "VerifySettlement", asset: USDT0_SYMBOL },
      ],
    };

    const receipt = await runtime.execute(plan);

    expect(receipt.status).to.equal("settled");
    expect(receipt.error).to.be.undefined;
    expect(receipt.steps.map((step) => step.status)).to.deep.equal(["ok", "ok", "ok", "ok"]);
    expect(receipt.steps[1].txHash).to.be.a("string");
    expect(receipt.steps[1].actualAmount).to.equal("5.0");
    expect(receipt.steps[2].actualAmount).to.equal("5.0");

    expect(await usdt0.balanceOf(recipient.address)).to.equal(ethers.parseUnits("5", 6));
  });

  it("rolls back a successful reversible conversion when a later step fails", async function () {
    const { runtime, backend, recipient, fxrp, usdt0, adapterAddress } =
      await networkHelpers.loadFixture(deployRuntimeFixture);

    const plan: ExecutionPlan = {
      planId: "plan-rollback",
      estimatedCost: "0.003",
      estimatedTime: "2500",
      estimatedOutput: "200",
      estimatedPayerAmount: "2",
      steps: [
        { stepId: 1, action: "AcquireAsset", asset: FXRP_SYMBOL },
        {
          stepId: 2,
          action: "ConvertAsset",
          from: FXRP_SYMBOL,
          to: USDT0_SYMBOL,
          asset: USDT0_SYMBOL,
          preferredAdapter: ADAPTER_NAME,
          properties: { reversible: true },
        },
        {
          stepId: 3,
          action: "ConvertAsset",
          from: USDT0_SYMBOL,
          to: WFLR_SYMBOL,
          asset: WFLR_SYMBOL,
          preferredAdapter: ADAPTER_NAME,
          properties: { reversible: true },
        },
        { stepId: 4, action: "Transfer", asset: WFLR_SYMBOL, to: recipient.address },
        { stepId: 5, action: "VerifySettlement", asset: WFLR_SYMBOL },
      ],
    };

    const backendFxrpBefore = await fxrp.balanceOf(backend.address);
    const adapterFxrpBefore = await fxrp.balanceOf(adapterAddress);
    const adapterUsdt0Before = await usdt0.balanceOf(adapterAddress);

    const receipt = await runtime.execute(plan);

    expect(receipt.status).to.equal("rolled_back");
    expect(receipt.error).to.match(/rate not set/);
    expect(receipt.steps.map((step) => step.status)).to.deep.equal(["ok", "ok", "failed"]);
    expect(receipt.steps[1].txHash).to.be.a("string");

    expect(await fxrp.balanceOf(backend.address)).to.equal(backendFxrpBefore);
    expect(await fxrp.balanceOf(adapterAddress)).to.equal(adapterFxrpBefore);
    expect(await usdt0.balanceOf(adapterAddress)).to.equal(adapterUsdt0Before);
    expect(await usdt0.balanceOf(recipient.address)).to.equal(0n);
  });

  it("fails without rolling back when the backend lacks payer funds", async function () {
    const { runtime, backend, recipient, fxrp } =
      await networkHelpers.loadFixture(deployRuntimeFixture);

    const plan: ExecutionPlan = {
      planId: "plan-insufficient",
      estimatedCost: "0.003",
      estimatedTime: "2500",
      estimatedOutput: "5",
      estimatedPayerAmount: "5000",
      steps: [
        { stepId: 1, action: "AcquireAsset", asset: FXRP_SYMBOL },
        {
          stepId: 2,
          action: "ConvertAsset",
          from: FXRP_SYMBOL,
          to: USDT0_SYMBOL,
          asset: USDT0_SYMBOL,
          preferredAdapter: ADAPTER_NAME,
          properties: { reversible: true },
        },
        { stepId: 3, action: "Transfer", asset: USDT0_SYMBOL, to: recipient.address },
        { stepId: 4, action: "VerifySettlement", asset: USDT0_SYMBOL },
      ],
    };

    const receipt = await runtime.execute(plan);

    expect(receipt.status).to.equal("failed");
    expect(receipt.error).to.match(/insufficient balance of FXRP/);
    expect(receipt.steps).to.deep.equal([{ stepId: 1, status: "failed" }]);
    expect(await fxrp.balanceOf(backend.address)).to.equal(ethers.parseEther("1000"));
  });

  it("quotes a pair directly without executing a plan", async function () {
    const { runtime } = await networkHelpers.loadFixture(deployRuntimeFixture);

    const quote = await runtime.quotePreview(FXRP_SYMBOL, USDT0_SYMBOL, "2", ADAPTER_NAME);

    expect(quote).to.deep.equal({
      fromAsset: FXRP_SYMBOL,
      toAsset: USDT0_SYMBOL,
      amountIn: "2",
      amountOut: "5.0",
      adapter: ADAPTER_NAME,
    });
  });

  it("quotePreview throws when the pair has no configured rate", async function () {
    const { runtime } = await networkHelpers.loadFixture(deployRuntimeFixture);

    await expectRejectedWith(
      runtime.quotePreview(USDT0_SYMBOL, WFLR_SYMBOL, "1", ADAPTER_NAME),
      /rate not set/
    );
  });

  it("quotePreview throws for an unknown asset symbol", async function () {
    const { runtime } = await networkHelpers.loadFixture(deployRuntimeFixture);

    await expectRejectedWith(
      runtime.quotePreview("ETH", USDT0_SYMBOL, "1", ADAPTER_NAME),
      /Unknown asset symbol "ETH"/
    );
  });
});

describe("ExecutionRuntime permit relay", function () {
  const PERMIT_VERSION = "1";
  const ERC2612_PERMIT_TYPES = {
    Permit: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };

  interface PermitFixture {
    runtime: ExecutionRuntime;
    backend: Awaited<ReturnType<typeof ethers.getSigners>>[number];
    payer: Awaited<ReturnType<typeof ethers.getSigners>>[number];
    recipient: Awaited<ReturnType<typeof ethers.getSigners>>[number];
    adapterAddress: string;
    fxrpPermit: Awaited<ReturnType<typeof ethers.deployContract>>;
    usdt0: Awaited<ReturnType<typeof ethers.deployContract>>;
    chainId: number;
  }

  async function deployPermitFixture(): Promise<PermitFixture> {
    const [owner, backend, recipient, payer] = await ethers.getSigners();

    const fxrpPermit = await ethers.deployContract("MockPermitERC20", [
      FXRP_SYMBOL,
      FXRP_SYMBOL,
      18,
      PERMIT_VERSION,
    ]);
    const usdt0 = await ethers.deployContract("MockERC20", [USDT0_SYMBOL, USDT0_SYMBOL, 6]);
    const adapter = await ethers.deployContract("TestSwapAdapter");

    const fxrpAddress = await fxrpPermit.getAddress();
    const usdt0Address = await usdt0.getAddress();
    const adapterAddress = await adapter.getAddress();

    await fxrpPermit.mint(payer.address, ethers.parseEther("1000"));
    await fxrpPermit.mint(owner.address, ethers.parseEther("1000"));
    await usdt0.mint(owner.address, ethers.parseUnits("1000000", 6));

    await fxrpPermit.connect(owner).approve(adapterAddress, ethers.MaxUint256);
    await usdt0.connect(owner).approve(adapterAddress, ethers.MaxUint256);
    await adapter.fundLiquidity(fxrpAddress, ethers.parseEther("1000"));
    await adapter.fundLiquidity(usdt0Address, ethers.parseUnits("1000000", 6));

    await adapter.setRate(fxrpAddress, usdt0Address, ethers.parseUnits("2.5", 6));

    const backendProvider = backend.provider;
    if (backendProvider === null) {
      throw new Error("hardhat backend signer has no provider");
    }

    const runtime = new ExecutionRuntime({
      provider: backendProvider,
      signer: backend,
      adapters: { [ADAPTER_NAME]: adapterAddress },
      tokens: {
        [FXRP_SYMBOL]: fxrpAddress,
        [USDT0_SYMBOL]: usdt0Address,
      },
    } as unknown as ExecutionRuntimeDependencies);

    const networkInfo = await backendProvider.getNetwork();
    return {
      runtime,
      backend,
      payer,
      recipient,
      adapterAddress,
      fxrpPermit,
      usdt0,
      chainId: Number(networkInfo.chainId),
    };
  }

  async function buildPermit(
    fixture: PermitFixture,
    plan: ExecutionPlan,
    overrides: Partial<RelayPermit> = {}
  ): Promise<RelayPermit> {
    const { payer, backend, fxrpPermit, chainId } = fixture;
    const fxrpAddress = await fxrpPermit.getAddress();
    const owner = payer.address;
    const spender = backend.address;
    const value = ethers.parseUnits(plan.estimatedPayerAmount, 18);
    const nonce = await fxrpPermit.nonces(owner);
    const deadline = Math.floor(Date.now() / 1000) + 3600;

    const domain = {
      name: FXRP_SYMBOL,
      version: PERMIT_VERSION,
      chainId,
      verifyingContract: fxrpAddress,
    };
    const signature = await payer.signTypedData(domain, ERC2612_PERMIT_TYPES, {
      owner,
      spender,
      value,
      nonce,
      deadline,
    });

    return {
      token: fxrpAddress,
      owner,
      spender,
      value: value.toString(),
      nonce: nonce.toString(),
      deadline,
      signature,
      domain,
      ...overrides,
    };
  }

  function makePermitPlan(planId: string, estimatedPayerAmount: string, estimatedOutput: string): ExecutionPlan {
    return {
      planId,
      estimatedCost: "0.003",
      estimatedTime: "2500",
      estimatedOutput,
      estimatedPayerAmount,
      steps: [
        { stepId: 1, action: "AcquireAsset", asset: FXRP_SYMBOL },
        {
          stepId: 2,
          action: "ConvertAsset",
          from: FXRP_SYMBOL,
          to: USDT0_SYMBOL,
          asset: USDT0_SYMBOL,
          preferredAdapter: ADAPTER_NAME,
          properties: { reversible: true },
        },
        { stepId: 3, action: "Transfer", asset: USDT0_SYMBOL, to: "" },
        { stepId: 4, action: "VerifySettlement", asset: USDT0_SYMBOL },
      ],
    };
  }

  it("settles a single-hop plan funded by a single payer permit", async function () {
    const fixture = await networkHelpers.loadFixture(deployPermitFixture);
    const plan = makePermitPlan("plan-permit-success", "2", "5");
    plan.steps[2] = { stepId: 3, action: "Transfer", asset: USDT0_SYMBOL, to: fixture.recipient.address };

    const permit = await buildPermit(fixture, plan);

    const receipt = await fixture.runtime.executeRelayed(plan, permit);

    expect(receipt.status).to.equal("settled");
    expect(receipt.steps.map((step) => step.status)).to.deep.equal(["ok", "ok", "ok", "ok"]);
    expect(await fixture.usdt0.balanceOf(fixture.recipient.address)).to.equal(
      ethers.parseUnits("5", 6)
    );
    expect(await fixture.fxrpPermit.balanceOf(fixture.payer.address)).to.equal(
      ethers.parseEther("998")
    );
  });

  it("rejects a relayed execution when the permit owner has insufficient funds", async function () {
    const fixture = await networkHelpers.loadFixture(deployPermitFixture);
    const plan = makePermitPlan("plan-permit-oversized", "2000", "2500");
    plan.steps[2] = { stepId: 3, action: "Transfer", asset: USDT0_SYMBOL, to: fixture.recipient.address };

    const permit = await buildPermit(fixture, plan);

    await expectRejectedWith(fixture.runtime.executeRelayed(plan, permit), /insufficient balance/);
  });

  it("rejects a relayed execution when the permit signature is forged", async function () {
    const fixture = await networkHelpers.loadFixture(deployPermitFixture);
    const [forger] = await ethers.getSigners();
    const plan = makePermitPlan("plan-permit-forged", "2", "5");
    plan.steps[2] = { stepId: 3, action: "Transfer", asset: USDT0_SYMBOL, to: fixture.recipient.address };

    const { payer, backend, fxrpPermit, chainId } = fixture;
    const fxrpAddress = await fxrpPermit.getAddress();
    const owner = payer.address;
    const spender = backend.address;
    const value = ethers.parseUnits(plan.estimatedPayerAmount, 18);
    const nonce = await fxrpPermit.nonces(owner);
    const deadline = Math.floor(Date.now() / 1000) + 3600;

    const domain = {
      name: FXRP_SYMBOL,
      version: PERMIT_VERSION,
      chainId,
      verifyingContract: fxrpAddress,
    };
    const paramMessage = { owner, spender, value, nonce, deadline };
    const forgedSignature = await forger.signTypedData(domain, ERC2612_PERMIT_TYPES, paramMessage);

    const permit = await buildPermit(fixture, plan, { signature: forgedSignature });

    await expectRejectedWith(
      fixture.runtime.executeRelayed(plan, permit),
      /permit signature does not match/
    );
  });

  it("rejects a relayed execution when the spender is not the backend relayer", async function () {
    const fixture = await networkHelpers.loadFixture(deployPermitFixture);
    const [owner] = await ethers.getSigners();
    const plan = makePermitPlan("plan-permit-wrong-spender", "2", "5");
    plan.steps[2] = { stepId: 3, action: "Transfer", asset: USDT0_SYMBOL, to: fixture.recipient.address };

    const permit = await buildPermit(fixture, plan, { spender: owner.address });

    await expectRejectedWith(
      fixture.runtime.executeRelayed(plan, permit),
      /spender does not match/
    );
  });
});

async function expectRejectedWith(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  let message = "no rejection";
  try {
    await promise;
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  expect(message).to.match(pattern);
}

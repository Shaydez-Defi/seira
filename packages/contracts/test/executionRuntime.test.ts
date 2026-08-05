import { expect } from "chai";
import { network } from "hardhat";
import type { ExecutionPlan } from "../../core/src/types.js";
import type { ExecutionRuntimeDependencies } from "../../runtime/src/runtime.js";
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
});

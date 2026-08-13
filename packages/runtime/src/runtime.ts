import {
  Contract,
  Signature,
  isError,
  JsonRpcProvider,
  MaxUint256,
  Wallet,
  formatUnits,
  parseUnits,
  verifyTypedData,
} from "ethers";
import type {
  ContractTransactionResponse,
  Interface,
  Provider,
  Signer,
  TransactionReceipt,
} from "ethers";
import type {
  ExecutionPlan,
  ExecutionStep,
  QuoteResponse,
} from "../../core/src/types";
import { ADAPTERS, COSTON2_CHAIN_ID, TOKENS } from "./config";

const ERC20_ABI = [
  "function decimals() external view returns (uint8)",
  "function balanceOf(address owner) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function transfer(address to, uint256 amount) external returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) external returns (bool)",
] as const;

const ERC2612_ABI = [
  "function nonces(address owner) external view returns (uint256)",
  "function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external",
] as const;

const SWAP_ADAPTER_ABI = [
  "function quote(address tokenIn, address tokenOut, uint256 amountIn) external view returns (uint256 amountOut)",
  "function swap(address tokenIn, address tokenOut, uint256 amountIn) external",
  "event Swap(address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, address sender)",
] as const;

/** Scale factor used to express a slippage fraction as whole parts per million. */
const SLIPPAGE_PPM_SCALE = 1_000_000n;

/** The EIP-712 Permit struct fields shared by ERC-2612 tokens. */
const ERC2612_PERMIT_TYPES: Record<string, Array<{ name: string; type: string }>> = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

/**
 * Thrown for expected business failures (insufficient balance, zero quote,
 * settlement mismatch) that should surface as a "failed" execution receipt
 * rather than a server error.
 */
export class ExecutionBusinessError extends Error {}

interface Erc20Contract {
  decimals(): Promise<bigint>;
  balanceOf(owner: string): Promise<bigint>;
  allowance(owner: string, spender: string): Promise<bigint>;
  approve(spender: string, amount: bigint): Promise<ContractTransactionResponse>;
  transfer(to: string, amount: bigint): Promise<ContractTransactionResponse>;
  transferFrom(from: string, to: string, amount: bigint): Promise<ContractTransactionResponse>;
}

interface SwapAdapterContract {
  quote(tokenIn: string, tokenOut: string, amountIn: bigint): Promise<bigint>;
  swap(tokenIn: string, tokenOut: string, amountIn: bigint): Promise<ContractTransactionResponse>;
  interface: Interface;
}

interface Erc2612Contract {
  nonces(owner: string): Promise<bigint>;
  permit(
    owner: string,
    spender: string,
    value: bigint,
    deadline: number,
    v: number,
    r: string,
    s: string
  ): Promise<ContractTransactionResponse>;
}

export interface ExecutionRuntimeDependencies {
  provider: Provider;
  signer: Signer;
  /** Adapter name to contract address. */
  adapters: Readonly<Record<string, string>>;
  /** Asset symbol to token contract address. */
  tokens: Readonly<Record<string, string>>;
}

export interface StepReceipt {
  stepId: number;
  status: "ok" | "failed";
  txHash?: string;
  actualAmount?: string;
}

export interface ExecutionReceipt {
  planId: string;
  status: "settled" | "failed" | "rolled_back";
  steps: StepReceipt[];
  error?: string;
}

/** EIP-712 domain over which an ERC-2612 permit is signed. */
export interface PermitDomain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
}

/**
 * An offline ERC-2612 permit signed by the payer authorizing the relayer
 * (backend wallet) to spend their payer asset, so the backend can execute
 * the plan on-chain with a single user signature.
 */
export interface RelayPermit {
  /** Payer asset token that the permit authorizes spending of. */
  token: string;
  /** Payer wallet that signed the permit. */
  owner: string;
  /** Relayer address permitted as spender (must match the backend signer). */
  spender: string;
  /** Raw token amount (in the token's smallest unit) being authorized. */
  value: string;
  /** Current on-chain nonce of the owner at signing time. */
  nonce: string;
  /** Unix timestamp (seconds) after which the permit is invalid. */
  deadline: number;
  /** 65-byte compact EIP-712 signature (r + s + v). */
  signature: string;
  /** EIP-712 domain used by the permit token. */
  domain: PermitDomain;
}

interface CompletedConvert {
  step: ExecutionStep;
  amountOut: bigint;
  txHash: string;
}

/**
 * Executes an ExecutionPlan against live contracts on behalf of a signer.
 */
export class ExecutionRuntime {
  private readonly signer: Signer;
  private readonly adapters: Readonly<Record<string, string>>;
  private readonly tokens: Readonly<Record<string, string>>;
  private readonly decimalsCache = new Map<string, number>();
  private signerAddress: string | undefined;

  constructor(deps: ExecutionRuntimeDependencies) {
    this.signer = deps.signer;
    this.adapters = deps.adapters;
    this.tokens = deps.tokens;
  }

  /**
   * Executes every step of the plan, rolling back reversible conversions on failure.
   */
  async execute(plan: ExecutionPlan): Promise<ExecutionReceipt> {
    const steps = [...plan.steps].sort((a, b) => a.stepId - b.stepId);
    const transferStep = steps.find((step) => step.action === "Transfer");
    const recipient = transferStep?.to;
    const receiverAsset =
      transferStep?.asset ?? steps.find((step) => step.action === "VerifySettlement")?.asset;
    if (transferStep === undefined || recipient === undefined || receiverAsset === undefined) {
      throw new Error(`Plan ${plan.planId} has no Transfer step with a recipient and asset`);
    }

    const payerAsset =
      steps.find((step) => step.action === "AcquireAsset")?.asset ??
      steps.find((step) => step.action === "ConvertAsset")?.from;
    if (payerAsset === undefined) {
      throw new Error(
        `Plan ${plan.planId} has no AcquireAsset or ConvertAsset step to derive the payer asset`
      );
    }

    const receiverToken = this.erc20At(this.resolveToken(receiverAsset));
    const recipientBefore = await receiverToken.balanceOf(recipient);

    const stepReceipts: StepReceipt[] = [];
    const completedConverts: CompletedConvert[] = [];
    let runningAmount: bigint | undefined;

    try {
      for (const step of steps) {
        if (step.action === "AcquireAsset") {
          await this.assertSufficientBalance(step, plan, payerAsset);
          stepReceipts.push({ stepId: step.stepId, status: "ok" });
        } else if (step.action === "ConvertAsset") {
          if (runningAmount === undefined) {
            runningAmount = parseUnits(
              plan.estimatedPayerAmount,
              await this.decimals(payerAsset)
            );
          }
          const result = await this.convert(step, runningAmount);
          runningAmount = result.amountOut;
          const toSymbol = step.to;
          if (toSymbol === undefined) {
            throw new Error(`ConvertAsset step ${step.stepId} is missing a "to" asset`);
          }
          completedConverts.push({ step, amountOut: result.amountOut, txHash: result.txHash });
          stepReceipts.push({
            stepId: step.stepId,
            status: "ok",
            txHash: result.txHash,
            actualAmount: formatUnits(result.amountOut, await this.decimals(toSymbol)),
          });
        } else if (step.action === "Transfer") {
          if (runningAmount === undefined) {
            throw new Error(`Transfer step ${step.stepId} executed without any converted amount`);
          }
          const tx = await receiverToken.transfer(recipient, runningAmount);
          await this.waitForTx(tx, `Transfer step ${step.stepId}`);
          stepReceipts.push({
            stepId: step.stepId,
            status: "ok",
            txHash: tx.hash,
            actualAmount: formatUnits(runningAmount, await this.decimals(receiverAsset)),
          });
        } else {
          const expectedMin = runningAmount ?? 0n;
          const tolerance =
            (expectedMin * this.slippagePpm(step)) / SLIPPAGE_PPM_SCALE;
          const delta = (await receiverToken.balanceOf(recipient)) - recipientBefore;
          if (delta < expectedMin - tolerance) {
            throw new ExecutionBusinessError(
              `VerifySettlement step ${step.stepId} failed: recipient balance increased ` +
                `by ${formatUnits(delta, await this.decimals(receiverAsset))} ${receiverAsset}, ` +
                `expected at least ${formatUnits(expectedMin, await this.decimals(receiverAsset))}`
            );
          }
          stepReceipts.push({ stepId: step.stepId, status: "ok" });
        }
      }
      return { planId: plan.planId, status: "settled", steps: stepReceipts };
    } catch (error) {
      return this.handleFailure(plan, steps, stepReceipts, completedConverts, error);
    }
  }

  /**
   * Returns the relayer address (the backend signer) that a payer must authorize
   * as spender in an ERC-2612 permit for relayed execution.
   */
  async relayerAddress(): Promise<string> {
    return this.getSignerAddress();
  }

  /**
   * Executes a plan funded by a single offline ERC-2612 permit signed by the
   * payer instead of live token approvals. Verifies the signature, replays it
   * on-chain (paying gas itself), pulls the payer asset into its own wallet,
   * then runs the plan steps as usual.
   */
  async executeRelayed(plan: ExecutionPlan, permit: RelayPermit): Promise<ExecutionReceipt> {
    const spender = await this.relayerAddress();
    if (permit.spender.toLowerCase() !== spender.toLowerCase()) {
      throw new ExecutionBusinessError(
        `relayed execution failed: permit spender does not match the backend relayer`
      );
    }

    const payerAsset =
      plan.steps.find((step) => step.action === "AcquireAsset")?.asset ??
      plan.steps.find((step) => step.action === "ConvertAsset")?.from;
    if (payerAsset === undefined) {
      throw new Error(
        `Plan ${plan.planId} has no AcquireAsset or ConvertAsset step to derive the payer asset`
      );
    }
    const payerToken = this.resolveToken(payerAsset);
    if (permit.token.toLowerCase() !== payerToken.toLowerCase()) {
      throw new ExecutionBusinessError(
        `relayed execution failed: permit token does not match payer asset ${payerAsset}`
      );
    }

    const needed = parseUnits(plan.estimatedPayerAmount, await this.decimals(payerAsset));
    const permitted = BigInt(permit.value);
    if (permitted < needed) {
      throw new ExecutionBusinessError(
        `relayed execution failed: permit value ${formatUnits(permitted, await this.decimals(payerAsset))} ` +
          `${payerAsset} is below the required ${plan.estimatedPayerAmount}`
      );
    }

    const signerAddress = await this.getSignerAddress();
    const erc2612 = this.erc2612At(payerToken);
    const currentNonce = await erc2612.nonces(permit.owner);
    if (BigInt(permit.nonce) !== currentNonce) {
      throw new ExecutionBusinessError(
        `relayed execution failed: stale permit nonce ${permit.nonce}, current is ${currentNonce}`
      );
    }

    const recovered = verifyTypedData(
      permit.domain,
      ERC2612_PERMIT_TYPES,
      {
        owner: permit.owner,
        spender: permit.spender,
        value: permitted,
        nonce: currentNonce,
        deadline: permit.deadline,
      },
      permit.signature
    );
    if (recovered.toLowerCase() !== permit.owner.toLowerCase()) {
      throw new ExecutionBusinessError(
        `relayed execution failed: permit signature does not match the owner ${permit.owner}`
      );
    }

    const signature = Signature.from(permit.signature);
    const permitTx = await erc2612.permit(
      permit.owner,
      permit.spender,
      permitted,
      permit.deadline,
      signature.v,
      signature.r,
      signature.s
    );
    await this.waitForTx(permitTx, "permit(owner, relayer)");

    const payerTokenContract = this.erc20At(payerToken);
    const allowance = await payerTokenContract.allowance(permit.owner, signerAddress);
    if (allowance < needed) {
      throw new ExecutionBusinessError(
        `relayed execution failed: smart-wallet permit left insufficient allowance` +
          ` (have ${formatUnits(allowance, await this.decimals(payerAsset))}, ` +
          `need ${plan.estimatedPayerAmount} ${payerAsset})`
      );
    }
    const pullTx = await payerTokenContract.transferFrom(
      permit.owner,
      signerAddress,
      needed
    );
    await this.waitForTx(pullTx, "transferFrom(payer, relayer)");

    return this.execute(plan);
  }

  /**
   * Previews the output of converting an amount through the given adapter without
   * running a plan, used by the API for live quote polling.
   */
  async quotePreview(
    fromAsset: string,
    toAsset: string,
    amountIn: string,
    adapterName: string
  ): Promise<QuoteResponse> {
    const fromAddress = this.resolveToken(fromAsset);
    const toAddress = this.resolveToken(toAsset);
    const adapterAddress = this.resolveAdapter(adapterName);

    const amountInRaw = parseUnits(amountIn, await this.decimals(fromAsset));
    const amountOutRaw = await this.swapAdapterAt(adapterAddress).quote(
      fromAddress,
      toAddress,
      amountInRaw
    );

    return {
      fromAsset,
      toAsset,
      amountIn,
      amountOut: formatUnits(amountOutRaw, await this.decimals(toAsset)),
      adapter: adapterName,
    };
  }

  private async assertSufficientBalance(
    step: ExecutionStep,
    plan: ExecutionPlan,
    payerAsset: string
  ): Promise<void> {
    const needed = parseUnits(plan.estimatedPayerAmount, await this.decimals(payerAsset));
    const balance = await this.erc20At(this.resolveToken(payerAsset)).balanceOf(
      await this.getSignerAddress()
    );
    if (balance < needed) {
      throw new ExecutionBusinessError(
        `AcquireAsset step ${step.stepId} failed: insufficient balance of ${payerAsset} ` +
          `(need ${formatUnits(needed, await this.decimals(payerAsset))}, ` +
          `have ${formatUnits(balance, await this.decimals(payerAsset))})`
      );
    }
  }

  private async convert(
    step: ExecutionStep,
    amountIn: bigint
  ): Promise<{ amountOut: bigint; txHash: string }> {
    const fromSymbol = step.from;
    const toSymbol = step.to;
    const adapterName = step.preferredAdapter;
    if (fromSymbol === undefined || toSymbol === undefined || adapterName === undefined) {
      throw new Error(
        `ConvertAsset step ${step.stepId} is missing from/to assets or a preferred adapter`
      );
    }

    const fromAddress = this.resolveToken(fromSymbol);
    const toAddress = this.resolveToken(toSymbol);
    const adapterAddress = this.resolveAdapter(adapterName);
    const tokenIn = this.erc20At(fromAddress);
    const adapter = this.swapAdapterAt(adapterAddress);

    const quoted = await adapter.quote(fromAddress, toAddress, amountIn);
    if (quoted === 0n) {
      throw new ExecutionBusinessError(
        `ConvertAsset step ${step.stepId} failed: quote returned zero output ` +
          `for ${fromSymbol} -> ${toSymbol} via ${adapterName}`
      );
    }

    const signerAddress = await this.getSignerAddress();
    const allowance = await tokenIn.allowance(signerAddress, adapterAddress);
    if (allowance < amountIn) {
      const approveTx = await tokenIn.approve(adapterAddress, MaxUint256);
      await this.waitForTx(approveTx, `approve ${fromSymbol} for ConvertAsset step ${step.stepId}`);
    }

    const swapTx = await adapter.swap(fromAddress, toAddress, amountIn);
    const receipt = await this.waitForTx(swapTx, `ConvertAsset step ${step.stepId}`);
    const amountOut = this.parseSwapAmountOut(receipt, adapterAddress, adapter);
    return { amountOut, txHash: swapTx.hash };
  }

  private async handleFailure(
    plan: ExecutionPlan,
    steps: ExecutionStep[],
    stepReceipts: StepReceipt[],
    completedConverts: CompletedConvert[],
    error: unknown
  ): Promise<ExecutionReceipt> {
    const message = error instanceof Error ? error.message : String(error);
    const failingStep = steps.find(
      (step) => !stepReceipts.some((receipt) => receipt.stepId === step.stepId)
    );
    if (failingStep !== undefined) {
      stepReceipts.push({ stepId: failingStep.stepId, status: "failed" });
    }

    const reversible = completedConverts.filter(
      (completed) => completed.step.properties?.reversible === true
    );
    if (reversible.length > 0) {
      try {
        await this.rollback(reversible);
        return {
          planId: plan.planId,
          status: "rolled_back",
          steps: stepReceipts,
          error: message,
        };
      } catch (rollbackError) {
        const rollbackMessage =
          rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
        throw new Error(`${message}; rollback failed: ${rollbackMessage}`, {
          cause: error,
        });
      }
    }
    if (!isBusinessError(error)) {
      throw error;
    }
    return { planId: plan.planId, status: "failed", steps: stepReceipts, error: message };
  }

  private async rollback(completed: CompletedConvert[]): Promise<void> {
    for (const { step, amountOut } of [...completed].reverse()) {
      const toSymbol = step.to;
      const fromSymbol = step.from;
      const adapterName = step.preferredAdapter;
      if (toSymbol === undefined || fromSymbol === undefined || adapterName === undefined) {
        throw new Error(
          `Cannot roll back ConvertAsset step ${step.stepId}: missing from/to assets or adapter`
        );
      }
      const adapterAddress = this.resolveAdapter(adapterName);
      const tokenToSendBack = this.erc20At(this.resolveToken(toSymbol));
      const adapter = this.swapAdapterAt(adapterAddress);

      const signerAddress = await this.getSignerAddress();
      const allowance = await tokenToSendBack.allowance(signerAddress, adapterAddress);
      if (allowance < amountOut) {
        const approveTx = await tokenToSendBack.approve(adapterAddress, MaxUint256);
        await this.waitForTx(approveTx, `approve ${toSymbol} for rollback of step ${step.stepId}`);
      }

      const reverseTx = await adapter.swap(
        this.resolveToken(toSymbol),
        this.resolveToken(fromSymbol),
        amountOut
      );
      await this.waitForTx(reverseTx, `rollback of ConvertAsset step ${step.stepId}`);
    }
  }

  private parseSwapAmountOut(
    receipt: TransactionReceipt,
    adapterAddress: string,
    adapter: SwapAdapterContract
  ): bigint {
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== adapterAddress.toLowerCase()) {
        continue;
      }
      const parsed = adapter.interface.parseLog(log);
      if (parsed !== null && parsed.name === "Swap") {
        const args = parsed.args as unknown as Record<string, unknown>;
        const amountOut = args["amountOut"];
        if (typeof amountOut !== "bigint") {
          throw new Error("Swap event is missing a valid amountOut argument");
        }
        return amountOut;
      }
    }
    throw new Error("no Swap event found in transaction receipt");
  }

  private slippagePpm(step: ExecutionStep): bigint {
    const slippage = step.properties?.estimatedSlippage;
    if (slippage === undefined) {
      return 0n;
    }
    const parsed = Number.parseFloat(slippage);
    if (Number.isNaN(parsed) || parsed < 0) {
      throw new Error(`Invalid estimatedSlippage on step ${step.stepId}: "${slippage}"`);
    }
    return BigInt(Math.round(parsed * 1_000_000));
  }

  private async waitForTx(
    tx: ContractTransactionResponse,
    context: string
  ): Promise<TransactionReceipt> {
    const receipt = await tx.wait();
    if (receipt === null || receipt.status !== 1) {
      throw new Error(`${context} failed (tx ${tx.hash})`);
    }
    return receipt;
  }

  private async decimals(symbol: string): Promise<number> {
    const address = this.resolveToken(symbol);
    const cached = this.decimalsCache.get(address);
    if (cached !== undefined) {
      return cached;
    }
    const tokenDecimals = Number(await this.erc20At(address).decimals());
    this.decimalsCache.set(address, tokenDecimals);
    return tokenDecimals;
  }

  private resolveToken(symbol: string): string {
    const address = this.tokens[symbol];
    if (address === undefined) {
      throw new Error(`Unknown asset symbol "${symbol}"`);
    }
    return address;
  }

  private resolveAdapter(name: string): string {
    const address = this.adapters[name];
    if (address === undefined) {
      throw new Error(`Unknown adapter "${name}"`);
    }
    return address;
  }

  private async getSignerAddress(): Promise<string> {
    if (this.signerAddress === undefined) {
      this.signerAddress = await this.signer.getAddress();
    }
    return this.signerAddress;
  }

  private erc20At(address: string): Erc20Contract {
    return new Contract(address, ERC20_ABI, this.signer) as unknown as Erc20Contract;
  }

  private erc2612At(address: string): Erc2612Contract {
    return new Contract(address, ERC2612_ABI, this.signer) as unknown as Erc2612Contract;
  }

  private swapAdapterAt(address: string): SwapAdapterContract {
    return new Contract(address, SWAP_ADAPTER_ABI, this.signer) as unknown as SwapAdapterContract;
  }
}

function isBusinessError(error: unknown): boolean {
  return (
    error instanceof ExecutionBusinessError ||
    (error instanceof Error && isError(error, "CALL_EXCEPTION"))
  );
}

/**
 * Creates an ExecutionRuntime bound to the Coston2 backend wallet from .env.
 */
export function createExecutionRuntime(): ExecutionRuntime {
  const rpcUrl = process.env.COSTON2_RPC_URL;
  if (rpcUrl === undefined) {
    throw new Error("COSTON2_RPC_URL is not set in .env");
  }
  const privateKey = process.env.BACKEND_PRIVATE_KEY;
  if (privateKey === undefined) {
    throw new Error("BACKEND_PRIVATE_KEY is not set in .env");
  }
  const provider = new JsonRpcProvider(rpcUrl, COSTON2_CHAIN_ID);
  const signer = new Wallet(privateKey, provider);
  return new ExecutionRuntime({ provider, signer, adapters: ADAPTERS, tokens: TOKENS });
}

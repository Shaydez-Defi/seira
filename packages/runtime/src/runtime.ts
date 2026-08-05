import {
  Contract,
  isError,
  JsonRpcProvider,
  MaxUint256,
  Wallet,
  formatUnits,
  parseUnits,
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
] as const;

const SWAP_ADAPTER_ABI = [
  "function quote(address tokenIn, address tokenOut, uint256 amountIn) external view returns (uint256 amountOut)",
  "function swap(address tokenIn, address tokenOut, uint256 amountIn) external",
  "event Swap(address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, address sender)",
] as const;

/** Scale factor used to express a slippage fraction as whole parts per million. */
const SLIPPAGE_PPM_SCALE = 1_000_000n;

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
}

interface SwapAdapterContract {
  quote(tokenIn: string, tokenOut: string, amountIn: bigint): Promise<bigint>;
  swap(tokenIn: string, tokenOut: string, amountIn: bigint): Promise<ContractTransactionResponse>;
  interface: Interface;
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

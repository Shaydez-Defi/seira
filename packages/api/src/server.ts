import cors from "cors";
import express from "express";
import type {
  Express,
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from "express";
import { isError } from "ethers";
import type {
  ExecutionPlan,
  ExecutionStep,
  PaymentIntent,
  QuoteResponse,
} from "../../core/src/types";
import { ExecutionPlanner, NoFeasibleRouteError } from "../../planner/src/planner";
import { CapabilityRegistry } from "../../registry/src/registry";
import { seedRegistry } from "../../registry/src/seed";
import { createExecutionRuntime } from "../../runtime/src/runtime";
import type { ExecutionReceipt, RelayPermit } from "../../runtime/src/runtime";
export type { ExecutionReceipt, RelayPermit } from "../../runtime/src/runtime";

const STEP_ACTIONS = [
  "AcquireAsset",
  "ConvertAsset",
  "Transfer",
  "VerifySettlement",
] as const;

const PRIORITIES = ["cost", "speed", "safety"] as const;

/** Matches a forwarded-port origin, e.g. https://<name>--5173.app.github.dev. */
const GITHUB_APP_SUBDOMAIN_ORIGIN = /^https:\/\/[a-z0-9-]+\.app\.github\.dev$/;

/** Origins allowed by CORS: local frontend dev servers and GitHub Codespaces forwarded ports. */
function isAllowedOrigin(origin: string): boolean {
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return true;
  }
  return GITHUB_APP_SUBDOMAIN_ORIGIN.test(origin);
}

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/** Default logger that writes structured lines to the process console. */
export const consoleLogger: Logger = {
  info: (message) => console.info(`[api] ${message}`),
  warn: (message) => console.warn(`[api] ${message}`),
  error: (message) => console.error(`[api] ${message}`),
};

/** The subset of the ExecutionRuntime the API depends on, so tests can stub it. */
export interface RuntimeLike {
  execute(plan: ExecutionPlan): Promise<ExecutionReceipt>;
  executeRelayed(plan: ExecutionPlan, permit: RelayPermit): Promise<ExecutionReceipt>;
  relayerAddress(): Promise<string>;
  quotePreview(
    fromAsset: string,
    toAsset: string,
    amountIn: string,
    adapterName: string
  ): Promise<QuoteResponse>;
}

/**
 * Feeds the measured settlement wall-clock time back into the registry so
 * future estimates track observed reality instead of static seed values.
 * The total is distributed evenly across the plan's convert edges so the sum
 * of per-edge latencyMs matches the measured end-to-end settlement time.
 */
function observeSettlementLatency(
  registry: CapabilityRegistry,
  plan: ExecutionPlan,
  elapsedMs: number
): void {
  const convertSteps = plan.steps.filter((step) => step.action === "ConvertAsset");
  if (convertSteps.length === 0) {
    return;
  }
  const perStepMs = elapsedMs / convertSteps.length;
  for (const step of convertSteps) {
    if (step.from === undefined || step.to === undefined || step.preferredAdapter === undefined) {
      continue;
    }
    const registered = registry
      .getCapabilities(step.from, step.to)
      .some((candidate) => candidate.adapter === step.preferredAdapter);
    if (registered) {
      registry.updateObserved([step.from, step.to], step.preferredAdapter, {
        latencyMs: perStepMs,
      });
    }
  }
}

export interface ApiDependencies {
  registry: CapabilityRegistry;
  planner: ExecutionPlanner;
  runtime: RuntimeLike;
  logger: Logger;
}

/** Error carrying an HTTP status intended for the client. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Builds the Express app wiring the frontend to the planner and runtime.
 */
export function createApp(deps: ApiDependencies): Express {
  const app = express();
  app.use(cors({ origin: (origin, callback) => callback(null, isAllowedOrigin(origin ?? "")) }));
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.post(
    "/api/plan",
    asyncHandler(async (req, res) => {
      const intent = parsePaymentIntent(req.body);
      let plan: ExecutionPlan;
      try {
        plan = deps.planner.plan(intent, deps.registry);
      } catch (error) {
        if (error instanceof NoFeasibleRouteError) {
          throw new ApiError(400, error.message);
        }
        throw error;
      }
      res.status(200).json(plan);
    })
  );

  app.post(
    "/api/execute",
    asyncHandler(async (req, res) => {
      const { plan, permit } = parseExecuteBody(req.body);
      let receipt: ExecutionReceipt;
      try {
        const startedAt = Date.now();
        receipt =
          permit === undefined
            ? await deps.runtime.execute(plan)
            : await deps.runtime.executeRelayed(plan, permit);
        if (receipt.status === "settled") {
          observeSettlementLatency(deps.registry, plan, Date.now() - startedAt);
        }
      } catch (error) {
        deps.logger.error(
          `execute ${plan.planId} failed with unexpected error: ${toMessage(error)}`
        );
        throw error;
      }
      deps.logger.info(
        `execute ${plan.planId} outcome: ${receipt.status}${permit === undefined ? "" : " (relayed)"}`
      );
      res.status(200).json(receipt);
    })
  );

  app.get(
    "/api/relayer",
    asyncHandler(async (_req, res) => {
      res.status(200).json({ address: await deps.runtime.relayerAddress() });
    })
  );

  app.get(
    "/api/quote",
    asyncHandler(async (req, res) => {
      const { fromAsset, toAsset, amount } = parseQuoteQuery(req.query);
      const capabilities = deps.registry.getCapabilities(fromAsset, toAsset);
      if (capabilities.length === 0) {
        throw new ApiError(400, `no adapter serves pair ${fromAsset} -> ${toAsset}`);
      }
      const adapterName = capabilities[0].adapter;
      let quote: QuoteResponse;
      try {
        quote = await deps.runtime.quotePreview(fromAsset, toAsset, amount, adapterName);
      } catch (error) {
        if (error instanceof Error && isError(error, "CALL_EXCEPTION")) {
          throw new ApiError(400, `quote failed for ${fromAsset} -> ${toAsset}: ${error.message}`);
        }
        throw error;
      }
      res.status(200).json(quote);
    })
  );

  app.use((req, res) => {
    res.status(404).json({ error: `no such endpoint: ${req.method} ${req.path}` });
  });

  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ApiError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    const status = errorStatus(error);
    if (status !== undefined && status >= 400 && status < 500) {
      res.status(status).json({ error: toMessage(error) });
      return;
    }
    deps.logger.error(`unhandled error on ${req.method} ${req.path}: ${toMessage(error)}`);
    res.status(500).json({ error: "internal server error" });
  });

  return app;
}

/**
 * Builds the production app bound to the seeded registry and Coston2 runtime.
 */
export function createDefaultApp(): Express {
  const registry = new CapabilityRegistry();
  seedRegistry(registry);
  return createApp({
    registry,
    planner: new ExecutionPlanner(),
    runtime: createExecutionRuntime(),
    logger: consoleLogger,
  });
}

/**
 * Starts the default app listening on the given port for local development.
 */
export function startServer(port: number): void {
  const app = createDefaultApp();
  const server = app.listen(port, () => {
    consoleLogger.info(`seira api listening on http://localhost:${port}`);
  });
  server.on("error", (error) => {
    consoleLogger.error(`server failed to start on port ${port}: ${toMessage(error)}`);
    process.exitCode = 1;
  });
}

function parsePaymentIntent(body: unknown): PaymentIntent {
  if (!isRecord(body)) {
    throw new ApiError(400, "request body must be a JSON object");
  }
  if (body.intent !== "payment") {
    throw new ApiError(400, 'intent must be "payment"');
  }
  const payerAsset = requireNonEmptyString(body.payerAsset, "payerAsset");
  const receiverAsset = requireNonEmptyString(body.receiverAsset, "receiverAsset");
  const receiverAmount = requireNonEmptyString(body.receiverAmount, "receiverAmount");
  requirePositiveAmount(receiverAmount, "receiverAmount");
  const recipient = requireNonEmptyString(body.recipient, "recipient");

  const constraints: PaymentIntent["constraints"] = {};
  if (body.constraints !== undefined) {
    if (!isRecord(body.constraints)) {
      throw new ApiError(400, "constraints must be an object");
    }
    if (body.constraints.maxFee !== undefined) {
      const maxFee = requireNonEmptyString(body.constraints.maxFee, "constraints.maxFee");
      requirePositiveAmount(maxFee, "constraints.maxFee");
      constraints.maxFee = maxFee;
    }
    if (body.constraints.maxSlippage !== undefined) {
      const maxSlippage = requireNonEmptyString(
        body.constraints.maxSlippage,
        "constraints.maxSlippage"
      );
      requirePositiveAmount(maxSlippage, "constraints.maxSlippage");
      constraints.maxSlippage = maxSlippage;
    }
    if (body.constraints.deadline !== undefined) {
      if (typeof body.constraints.deadline !== "number" || !Number.isFinite(body.constraints.deadline)) {
        throw new ApiError(400, "constraints.deadline must be a finite unix timestamp number");
      }
      constraints.deadline = body.constraints.deadline;
    }
    if (body.constraints.priority !== undefined) {
      constraints.priority = requirePriority(body.constraints.priority, "constraints.priority");
    }
  }

  return { intent: "payment", payerAsset, receiverAsset, receiverAmount, recipient, constraints };
}

function parseExecuteBody(body: unknown): {
  plan: ExecutionPlan;
  intent: PaymentIntent;
  permit?: RelayPermit;
} {
  if (!isRecord(body)) {
    throw new ApiError(400, "request body must be a JSON object");
  }
  if (!isRecord(body.plan)) {
    throw new ApiError(400, "plan is required and must be an object");
  }
  const permit = body.permit === undefined ? undefined : parseRelayPermit(body.permit);
  return { plan: parseExecutionPlan(body.plan), intent: parsePaymentIntent(body.intent), permit };
}

function parseRelayPermit(value: unknown): RelayPermit {
  if (!isRecord(value)) {
    throw new ApiError(400, "permit must be an object");
  }
  const token = requireNonEmptyString(value.token, "permit.token");
  const owner = requireNonEmptyString(value.owner, "permit.owner");
  const spender = requireNonEmptyString(value.spender, "permit.spender");
  requireEthereumAddress(token, "permit.token");
  requireEthereumAddress(owner, "permit.owner");
  requireEthereumAddress(spender, "permit.spender");

  const valueRaw = requireNonEmptyString(value.value, "permit.value");
  if (!/^\d+$/.test(valueRaw)) {
    throw new ApiError(400, "permit.value must be a non-negative integer string in the token's raw units");
  }
  const nonce = requireNonEmptyString(value.nonce, "permit.nonce");
  if (!/^\d+$/.test(nonce)) {
    throw new ApiError(400, "permit.nonce must be a non-negative integer string");
  }
  if (typeof value.deadline !== "number" || !Number.isFinite(value.deadline)) {
    throw new ApiError(400, "permit.deadline must be a finite unix timestamp number");
  }
  const signature = requireNonEmptyString(value.signature, "permit.signature");
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    throw new ApiError(400, "permit.signature must be a 65-byte hex r + s + v compact signature");
  }

  if (!isRecord(value.domain)) {
    throw new ApiError(400, "permit.domain must be an object");
  }
  const domain = value.domain as Record<string, unknown>;
  const name = requireNonEmptyString(domain.name, "permit.domain.name");
  const version = requireNonEmptyString(domain.version, "permit.domain.version");
  if (typeof domain.chainId !== "number" && !/^\d+$/.test(String(domain.chainId ?? ""))) {
    throw new ApiError(400, "permit.domain.chainId must be a number or numeric string");
  }
  const chainId = Number(domain.chainId);
  const verifyingContract = requireNonEmptyString(
    domain.verifyingContract,
    "permit.domain.verifyingContract"
  );
  requireEthereumAddress(verifyingContract, "permit.domain.verifyingContract");

  return {
    token,
    owner,
    spender,
    value: valueRaw,
    nonce,
    deadline: value.deadline,
    signature,
    domain: { name, version, chainId, verifyingContract },
  };
}

function requireEthereumAddress(value: string, label: string): void {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new ApiError(400, `${label} must be a valid Ethereum address`);
  }
}

function parseExecutionPlan(body: unknown): ExecutionPlan {
  if (!isRecord(body)) {
    throw new ApiError(400, "plan must be an object");
  }
  const planId = requireNonEmptyString(body.planId, "plan.planId");
  const estimatedCost = requireNonEmptyString(body.estimatedCost, "plan.estimatedCost");
  const estimatedTime = requireNonEmptyString(body.estimatedTime, "plan.estimatedTime");
  const estimatedOutput = requireNonEmptyString(body.estimatedOutput, "plan.estimatedOutput");
  const estimatedPayerAmount = requireNonEmptyString(
    body.estimatedPayerAmount,
    "plan.estimatedPayerAmount"
  );
  requirePositiveAmount(estimatedPayerAmount, "plan.estimatedPayerAmount");

  if (!Array.isArray(body.steps)) {
    throw new ApiError(400, "plan.steps must be an array");
  }
  if (body.steps.length === 0) {
    throw new ApiError(400, "plan.steps must not be empty");
  }
  const steps = body.steps.map((step, index) => parseExecutionStep(step, index));
  const hasSettleableTransfer = steps.some(
    (step) => step.action === "Transfer" && isNonEmptyString(step.to) && isNonEmptyString(step.asset)
  );
  if (!hasSettleableTransfer) {
    throw new ApiError(400, "plan must contain a Transfer step with a recipient (to) and asset");
  }

  return { planId, estimatedCost, estimatedTime, estimatedOutput, estimatedPayerAmount, steps };
}

function parseExecutionStep(value: unknown, index: number): ExecutionStep {
  const label = `plan.steps[${index}]`;
  if (!isRecord(value)) {
    throw new ApiError(400, `${label} must be an object`);
  }
  if (typeof value.stepId !== "number" || !Number.isInteger(value.stepId)) {
    throw new ApiError(400, `${label}.stepId must be an integer`);
  }
  const action = value.action;
  const normalizedAction = STEP_ACTIONS.find((candidate) => candidate === action);
  if (normalizedAction === undefined) {
    throw new ApiError(400, `${label}.action must be one of ${STEP_ACTIONS.join(", ")}`);
  }

  const step: ExecutionStep = { stepId: value.stepId, action: normalizedAction };
  if (value.from !== undefined) {
    step.from = requireNonEmptyString(value.from, `${label}.from`);
  }
  if (value.to !== undefined) {
    step.to = requireNonEmptyString(value.to, `${label}.to`);
  }
  if (value.asset !== undefined) {
    step.asset = requireNonEmptyString(value.asset, `${label}.asset`);
  }
  if (value.preferredAdapter !== undefined) {
    step.preferredAdapter = requireNonEmptyString(value.preferredAdapter, `${label}.preferredAdapter`);
  }
  if (value.fallbackAdapters !== undefined) {
    if (
      !Array.isArray(value.fallbackAdapters) ||
      !value.fallbackAdapters.every((entry) => isNonEmptyString(entry))
    ) {
      throw new ApiError(400, `${label}.fallbackAdapters must be an array of strings`);
    }
    step.fallbackAdapters = value.fallbackAdapters;
  }
  if (value.properties !== undefined) {
    step.properties = parseStepProperties(value.properties, label);
  }
  return step;
}

function parseStepProperties(value: unknown, label: string): ExecutionStep["properties"] {
  if (!isRecord(value)) {
    throw new ApiError(400, `${label}.properties must be an object`);
  }
  const properties: ExecutionStep["properties"] = {};
  if (value.reversible !== undefined) {
    if (typeof value.reversible !== "boolean") {
      throw new ApiError(400, `${label}.properties.reversible must be a boolean`);
    }
    properties.reversible = value.reversible;
  }
  if (value.estimatedSlippage !== undefined) {
    const estimatedSlippage = requireNonEmptyString(
      value.estimatedSlippage,
      `${label}.properties.estimatedSlippage`
    );
    requireNonNegativeAmount(estimatedSlippage, `${label}.properties.estimatedSlippage`);
    properties.estimatedSlippage = estimatedSlippage;
  }
  return properties;
}

function parseQuoteQuery(query: unknown): { fromAsset: string; toAsset: string; amount: string } {
  if (!isRecord(query)) {
    throw new ApiError(400, "query parameters must be an object");
  }
  const fromAsset = requireNonEmptyString(query.fromAsset, "fromAsset");
  const toAsset = requireNonEmptyString(query.toAsset, "toAsset");
  const amount = requireNonEmptyString(query.amount, "amount");
  requirePositiveAmount(amount, "amount");
  return { fromAsset, toAsset, amount };
}

function requirePriority(value: unknown, label: string): "cost" | "speed" | "safety" {
  const normalized = PRIORITIES.find((candidate) => candidate === value);
  if (normalized === undefined) {
    throw new ApiError(400, `${label} must be one of ${PRIORITIES.join(", ")}`);
  }
  return normalized;
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ApiError(400, `${label} is required and must be a non-empty string`);
  }
  return value;
}

function requirePositiveAmount(value: string, label: string): void {
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new ApiError(400, `${label} must be a positive number`);
  }
}

function requireNonNegativeAmount(value: string, label: string): void {
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new ApiError(400, `${label} must be a non-negative number`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function errorStatus(error: unknown): number | undefined {
  if (error instanceof Error && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") {
      return status;
    }
  }
  return undefined;
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

function asyncHandler(handler: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    void handler(req, res, next).catch(next);
  };
}

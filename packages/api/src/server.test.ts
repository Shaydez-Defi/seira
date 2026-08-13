import { describe, expect, it } from "vitest";
import request from "supertest";
import type {
  ExecutionPlan,
  PaymentIntent,
} from "../../core/src/types";
import { ExecutionPlanner } from "../../planner/src/planner";
import { CapabilityRegistry } from "../../registry/src/registry";
import { seedRegistry } from "../../registry/src/seed";
import { createApp } from "./server";
import type { Logger, RelayPermit, RuntimeLike } from "./server";

function makePermit(owner: string): RelayPermit {
  return {
    token: "0x0000000000000000000000000000000000000001",
    owner,
    spender: "0x0000000000000000000000000000000000000003",
    value: "100",
    nonce: "0",
    deadline: Math.floor(Date.now() / 1000) + 3600,
    signature:
      "0x" + "11".repeat(32) + "22".repeat(32) + "1b",
    domain: {
      name: "FXRP",
      version: "1",
      chainId: 114,
      verifyingContract: "0x0000000000000000000000000000000000000001",
    },
  };
}

function makeIntent(overrides: Partial<PaymentIntent> = {}): PaymentIntent {
  return {
    intent: "payment",
    payerAsset: "FXRP",
    receiverAsset: "USDT0",
    receiverAmount: "100",
    recipient: "0xRecipient",
    constraints: {},
    ...overrides,
  };
}

function makePlan(): ExecutionPlan {
  const registry = new CapabilityRegistry();
  seedRegistry(registry);
  return new ExecutionPlanner().plan(makeIntent(), registry);
}

function stubRuntime(overrides: Partial<RuntimeLike> = {}): RuntimeLike {
  return {
    execute: async (plan) => ({
      planId: plan.planId,
      status: "settled",
      steps: plan.steps.map((step) => ({ stepId: step.stepId, status: "ok" as const })),
    }),
    executeRelayed: async (plan) => ({
      planId: plan.planId,
      status: "settled",
      steps: plan.steps.map((step) => ({ stepId: step.stepId, status: "ok" as const })),
    }),
    relayerAddress: async () => "0x0000000000000000000000000000000000000001",
    quotePreview: async (fromAsset, toAsset, amountIn, adapter) => ({
      fromAsset,
      toAsset,
      amountIn,
      amountOut: "10",
      adapter,
    }),
    ...overrides,
  };
}

interface TestContext {
  app: ReturnType<typeof createApp>;
  logs: string[];
}

function makeTestApp(runtime: RuntimeLike = stubRuntime()): TestContext {
  const registry = new CapabilityRegistry();
  seedRegistry(registry);
  const logs: string[] = [];
  const logger: Logger = {
    info: (message) => logs.push(`info:${message}`),
    warn: (message) => logs.push(`warn:${message}`),
    error: (message) => logs.push(`error:${message}`),
  };
  const app = createApp({ registry, planner: new ExecutionPlanner(), runtime, logger });
  return { app, logs };
}

describe("GET /api/health", () => {
  it("reports ok for basic uptime checking", async () => {
    const { app } = makeTestApp();
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("allows localhost origins via CORS", async () => {
    const { app } = makeTestApp();
    const res = await request(app)
      .get("/api/health")
      .set("Origin", "http://localhost:5173");
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  });

  it("allows GitHub Codespaces forwarded-port origins via CORS", async () => {
    const { app } = makeTestApp();
    const res = await request(app)
      .get("/api/health")
      .set("Origin", "https://potential-lamp-69x5j7xg9ggq3rrw7-5173.app.github.dev");
    expect(res.headers["access-control-allow-origin"]).toBe(
      "https://potential-lamp-69x5j7xg9ggq3rrw7-5173.app.github.dev"
    );
  });

  it("answers the OPTIONS preflight for a Codespaces origin with CORS headers", async () => {
    const { app } = makeTestApp();
    const res = await request(app)
      .options("/api/health")
      .set("Origin", "https://potential-lamp-69x5j7xg9ggq3rrw7-5173.app.github.dev")
      .set("Access-Control-Request-Method", "GET");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(
      "https://potential-lamp-69x5j7xg9ggq3rrw7-5173.app.github.dev"
    );
    expect(res.headers["access-control-allow-methods"]).toContain("GET");
  });

  it("does not set CORS headers for non-localhost origins", async () => {
    const { app } = makeTestApp();
    const res = await request(app)
      .get("/api/health")
      .set("Origin", "https://example.com");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("POST /api/plan", () => {
  it("returns an ExecutionPlan for a valid intent", async () => {
    const { app } = makeTestApp();
    const res = await request(app).post("/api/plan").send(makeIntent());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ estimatedOutput: "100", estimatedPayerAmount: "40" });
    expect(res.body.steps).toHaveLength(4);
    expect(res.body.steps[0]).toMatchObject({ stepId: 1, action: "AcquireAsset", asset: "FXRP" });
    expect(res.body.steps[1]).toMatchObject({
      stepId: 2,
      action: "ConvertAsset",
      from: "FXRP",
      to: "USDT0",
      asset: "USDT0",
      preferredAdapter: "TestSwapAdapter",
    });
    expect(res.body.steps[2]).toMatchObject({ action: "Transfer", to: "0xRecipient" });
    expect(res.body.steps[3]).toMatchObject({ action: "VerifySettlement", asset: "USDT0" });
  });

  it("rejects a malformed intent with 400 and a specific message", async () => {
    const { app } = makeTestApp();
    const res = await request(app)
      .post("/api/plan")
      .send({ intent: "payment", payerAsset: "FXRP" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/receiverAsset/);
  });

  it("rejects an invalid priority with 400", async () => {
    const { app } = makeTestApp();
    const res = await request(app)
      .post("/api/plan")
      .send({
        intent: "payment",
        payerAsset: "FXRP",
        receiverAsset: "USDT0",
        receiverAmount: "100",
        recipient: "0xRecipient",
        constraints: { priority: "fastest" },
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/constraints\.priority/);
  });

  it("rejects a non-positive receiverAmount with 400", async () => {
    const { app } = makeTestApp();
    const res = await request(app)
      .post("/api/plan")
      .send(makeIntent({ receiverAmount: "-5" }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/receiverAmount/);
  });

  it("rejects an unparseable JSON body with 400", async () => {
    const { app } = makeTestApp();
    const res = await request(app)
      .post("/api/plan")
      .set("Content-Type", "application/json")
      .send("{not valid json");

    expect(res.status).toBe(400);
  });

  it("returns 400 rather than 500 when no feasible route exists", async () => {
    const { app } = makeTestApp();
    const res = await request(app).post("/api/plan").send(makeIntent({ receiverAsset: "BTC" }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No feasible route from FXRP to BTC/);
  });

  it("returns 404 for an unknown endpoint", async () => {
    const { app } = makeTestApp();
    const res = await request(app).get("/api/nope");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/execute", () => {
  it("returns the ExecutionReceipt with 200 on settlement and logs the outcome", async () => {
    const { app, logs } = makeTestApp();
    const plan = makePlan();

    const res = await request(app).post("/api/execute").send({ plan, intent: makeIntent() });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ planId: plan.planId, status: "settled" });
    expect(res.body.steps).toHaveLength(4);
    expect(logs).toContain(`info:execute ${plan.planId} outcome: settled`);
  });

  it("returns 200 with a rolled_back receipt when execution rolled back", async () => {
    const { app } = makeTestApp(
      stubRuntime({
        execute: async (plan) => ({
          planId: plan.planId,
          status: "rolled_back",
          steps: [{ stepId: 1, status: "ok" }, { stepId: 2, status: "failed" }],
          error: "rate not set",
        }),
      })
    );
    const plan = makePlan();

    const res = await request(app).post("/api/execute").send({ plan, intent: makeIntent() });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "rolled_back", error: "rate not set" });
  });

  it("returns 500 only for genuine unexpected failures and logs the error", async () => {
    const { app, logs } = makeTestApp(
      stubRuntime({
        execute: async () => {
          throw new Error("RPC unreachable");
        },
      })
    );
    const plan = makePlan();

    const res = await request(app).post("/api/execute").send({ plan, intent: makeIntent() });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("internal server error");
    expect(logs.some((entry) => entry.startsWith("error:execute "))).toBe(true);
  });

  it("rejects a body without a plan with 400", async () => {
    const { app } = makeTestApp();
    const res = await request(app).post("/api/execute").send({ intent: makeIntent() });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/plan/);
  });

  it("rejects a plan missing a Transfer step with 400", async () => {
    const { app } = makeTestApp();
    const plan = makePlan();
    const badPlan = { ...plan, steps: plan.steps.filter((step) => step.action !== "Transfer") };

    const res = await request(app)
      .post("/api/execute")
      .send({ plan: badPlan, intent: makeIntent() });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Transfer step/);
  });

  it("rejects a malformed intent in the body with 400", async () => {
    const { app } = makeTestApp();
    const plan = makePlan();
    const res = await request(app)
      .post("/api/execute")
      .send({ plan, intent: { intent: "payment", payerAsset: "FXRP" } });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/receiverAsset/);
  });

  it("routes a permit-bearing execution to the relayed runtime path", async () => {
    const plan = makePlan();
    const calls: string[] = [];
    const { app } = makeTestApp(
      stubRuntime({
        executeRelayed: async (receivedPlan, permit) => {
          calls.push(`relayed:${receivedPlan.planId}:${permit.owner}`);
          return {
            planId: receivedPlan.planId,
            status: "settled",
            steps: receivedPlan.steps.map((step) => ({
              stepId: step.stepId,
              status: "ok" as const,
            })),
          };
        },
      })
    );
    const permit = makePermit("0x0000000000000000000000000000000000000002");

    const res = await request(app)
      .post("/api/execute")
      .send({ plan, intent: makeIntent(), permit });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "settled" });
    expect(calls).toEqual([`relayed:${plan.planId}:0x0000000000000000000000000000000000000002`]);
  });

  it("rejects a malformed relay permit signature with 400", async () => {
    const { app } = makeTestApp();
    const plan = makePlan();
    const permit = makePermit("0x0000000000000000000000000000000000000002");
    permit.signature = "0xdeadbeef";

    const res = await request(app)
      .post("/api/execute")
      .send({ plan, intent: makeIntent(), permit });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/signature/);
  });
});

describe("GET /api/relayer", () => {
  it("returns the backend relayer address from the runtime", async () => {
    const { app } = makeTestApp(
      stubRuntime({ relayerAddress: async () => "0x0000000000000000000000000000000000000009" })
    );

    const res = await request(app).get("/api/relayer");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ address: "0x0000000000000000000000000000000000000009" });
  });
});

describe("GET /api/quote", () => {
  it("returns a quote for a pair served by the registry", async () => {
    const { app } = makeTestApp();
    const res = await request(app).get("/api/quote?fromAsset=FXRP&toAsset=USDT0&amount=2");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      fromAsset: "FXRP",
      toAsset: "USDT0",
      amountIn: "2",
      amountOut: "10",
      adapter: "TestSwapAdapter",
    });
  });

  it("returns 400 when no adapter serves the pair", async () => {
    const { app } = makeTestApp();
    const res = await request(app).get("/api/quote?fromAsset=BTC&toAsset=USDT0&amount=1");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no adapter serves pair BTC -> USDT0/);
  });

  it("returns 400 for a missing asset parameter", async () => {
    const { app } = makeTestApp();
    const res = await request(app).get("/api/quote?toAsset=USDT0&amount=1");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/fromAsset/);
  });

  it("returns 400 for a non-numeric amount", async () => {
    const { app } = makeTestApp();
    const res = await request(app).get("/api/quote?fromAsset=FXRP&toAsset=USDT0&amount=abc");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/amount/);
  });

  it("returns 400 when the adapter rejects the quote as a business condition", async () => {
    const { app } = makeTestApp(
      stubRuntime({
        quotePreview: async () => {
          const error = new Error("rate not set");
          Object.assign(error, { code: "CALL_EXCEPTION" });
          throw error;
        },
      })
    );
    const res = await request(app).get("/api/quote?fromAsset=FXRP&toAsset=USDT0&amount=1");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/quote failed for FXRP -> USDT0: rate not set/);
  });
});

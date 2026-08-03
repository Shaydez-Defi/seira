import { describe, expect, it } from "vitest";
import type { PaymentIntent } from "../../core/src/types";
import { CapabilityRegistry } from "../../registry/src/registry";
import { seedRegistry } from "../../registry/src/seed";
import { ExecutionPlanner } from "./planner";

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

function makeSeededRegistry(): CapabilityRegistry {
  const registry = new CapabilityRegistry();
  seedRegistry(registry);
  return registry;
}

describe("ExecutionPlanner", () => {
  it("plans the direct FXRP -> USDT0 route", () => {
    const planner = new ExecutionPlanner();
    const plan = planner.plan(makeIntent({ receiverAsset: "USDT0" }), makeSeededRegistry());

    expect(plan.planId).not.toBe("");
    expect(plan.estimatedCost).toBe("0.003");
    expect(plan.estimatedTime).toBe("2500");
    expect(plan.estimatedOutput).toBe("100");
    expect(plan.steps).toHaveLength(4);
    expect(plan.steps[0]).toMatchObject({ stepId: 1, action: "AcquireAsset", asset: "FXRP" });
    expect(plan.steps[1]).toMatchObject({
      stepId: 2,
      action: "ConvertAsset",
      from: "FXRP",
      to: "USDT0",
      asset: "USDT0",
      preferredAdapter: "SparkDEX",
      fallbackAdapters: [],
    });
    expect(plan.steps[2]).toMatchObject({
      stepId: 3,
      action: "Transfer",
      asset: "USDT0",
      to: "0xRecipient",
    });
    expect(plan.steps[3]).toMatchObject({ stepId: 4, action: "VerifySettlement", asset: "USDT0" });
  });

  it("plans the direct FXRP -> FLR route", () => {
    const planner = new ExecutionPlanner();
    const plan = planner.plan(makeIntent({ receiverAsset: "FLR" }), makeSeededRegistry());

    expect(plan.estimatedCost).toBe("0.002");
    expect(plan.estimatedTime).toBe("3200");
    expect(plan.steps[1]).toMatchObject({ to: "FLR", preferredAdapter: "SparkDEX" });
  });

  it("throws when no route exists to the receiver asset", () => {
    const planner = new ExecutionPlanner();

    expect(() =>
      planner.plan(makeIntent({ receiverAsset: "BTC" }), makeSeededRegistry())
    ).toThrow(/No feasible route from FXRP to BTC/);
  });

  it("rejects a route whose cost exceeds maxFee", () => {
    const planner = new ExecutionPlanner();

    expect(() =>
      planner.plan(
        makeIntent({ constraints: { maxFee: "0.002" } }),
        makeSeededRegistry()
      )
    ).toThrow(/No feasible route from FXRP to USDT0/);
  });

  it("rejects a route that misses the deadline", () => {
    const planner = new ExecutionPlanner();

    expect(() =>
      planner.plan(
        makeIntent({ constraints: { deadline: 2 } }),
        makeSeededRegistry()
      )
    ).toThrow(/No feasible route from FXRP to USDT0/);
  });

  it("rejects a route whose only edge has below-minimum liquidity", () => {
    const registry = makeSeededRegistry();
    registry.register({
      pair: ["FXRP", "USDX"],
      adapter: "RiskyDEX",
      action: "ConvertAsset",
      cost: 0.001,
      latencyMs: 1000,
      reliability: 0.9,
      reversible: true,
      liquidityScore: 0.4,
    });
    const planner = new ExecutionPlanner();

    expect(() =>
      planner.plan(makeIntent({ receiverAsset: "USDX" }), registry)
    ).toThrow(/No feasible route from FXRP to USDX/);
  });

  it("selects different routes for cost vs speed priority with multiple adapters", () => {
    const registry = makeSeededRegistry();
    registry.register({
      pair: ["FXRP", "USDT0"],
      adapter: "Kinetic",
      action: "ConvertAsset",
      cost: 0.05,
      latencyMs: 2400,
      reliability: 0.98,
      reversible: true,
      liquidityScore: 0.9,
    });
    const planner = new ExecutionPlanner();

    const costPlan = planner.plan(
      makeIntent({ constraints: { priority: "cost", maxFee: "0.06" } }),
      registry
    );
    const speedPlan = planner.plan(
      makeIntent({ constraints: { priority: "speed", maxFee: "0.06" } }),
      registry
    );

    expect(costPlan.steps[1].preferredAdapter).toBe("SparkDEX");
    expect(costPlan.steps[1].fallbackAdapters).toEqual(["Kinetic"]);
    expect(speedPlan.steps[1].preferredAdapter).toBe("Kinetic");
    expect(speedPlan.steps[1].fallbackAdapters).toEqual(["SparkDEX"]);
  });
});

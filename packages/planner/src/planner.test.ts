import { describe, expect, it } from "vitest";
import type { CapabilityEntry, PaymentIntent } from "../../core/src/types";
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

function makeCapability(overrides: Partial<CapabilityEntry> = {}): CapabilityEntry {
  return {
    pair: ["FXRP", "USDT0"],
    rate: 2.5,
    adapter: "TestSwapAdapter",
    action: "ConvertAsset",
    cost: 0.003,
    latencyMs: 2500,
    reliability: 0.97,
    reversible: true,
    liquidityScore: 0.85,
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
    expect(plan.estimatedPayerAmount).toBe("40");
    expect(plan.steps).toHaveLength(4);
    expect(plan.steps[0]).toMatchObject({ stepId: 1, action: "AcquireAsset", asset: "FXRP" });
    expect(plan.steps[1]).toMatchObject({
      stepId: 2,
      action: "ConvertAsset",
      from: "FXRP",
      to: "USDT0",
      asset: "USDT0",
      preferredAdapter: "TestSwapAdapter",
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

  it("plans the direct FXRP -> WFLR route", () => {
    const planner = new ExecutionPlanner();
    const plan = planner.plan(makeIntent({ receiverAsset: "WFLR" }), makeSeededRegistry());

    expect(plan.estimatedCost).toBe("0.002");
    expect(plan.estimatedTime).toBe("3200");
    expect(plan.estimatedPayerAmount).toBe("10");
    expect(plan.steps[1]).toMatchObject({ to: "WFLR", preferredAdapter: "TestSwapAdapter" });
  });

  it("estimates the exact payer amount for the seeded FXRP -> USDT0 rate", () => {
    const planner = new ExecutionPlanner();

    const plan = planner.plan(makeIntent({ receiverAmount: "5" }), makeSeededRegistry());

    expect(plan.estimatedPayerAmount).toBe("2");
    expect(plan.estimatedOutput).toBe("5");
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
    const deadline = Math.floor(Date.now() / 1000) + 2;

    expect(() =>
      planner.plan(
        makeIntent({ constraints: { deadline } }),
        makeSeededRegistry()
      )
    ).toThrow(/No feasible route from FXRP to USDT0/);
  });

  it("rejects a route when the deadline is already in the past", () => {
    const planner = new ExecutionPlanner();
    const deadline = Math.floor(Date.now() / 1000) - 5;

    expect(() =>
      planner.plan(
        makeIntent({ constraints: { deadline } }),
        makeSeededRegistry()
      )
    ).toThrow(/No feasible route from FXRP to USDT0/);
  });

  it("accepts a route when the deadline is far enough in the future", () => {
    const planner = new ExecutionPlanner();
    const deadline = Math.floor(Date.now() / 1000) + 60;

    const plan = planner.plan(
      makeIntent({ constraints: { deadline } }),
      makeSeededRegistry()
    );

    expect(plan.steps).toHaveLength(4);
  });

  it("rejects a route whose only edge has below-minimum liquidity", () => {
    const registry = makeSeededRegistry();
    registry.register(
      makeCapability({
        pair: ["FXRP", "USDX"],
        adapter: "RiskyDEX",
        cost: 0.001,
        latencyMs: 1000,
        reliability: 0.9,
        liquidityScore: 0.4,
      })
    );
    const planner = new ExecutionPlanner();

    expect(() =>
      planner.plan(makeIntent({ receiverAsset: "USDX" }), registry)
    ).toThrow(/No feasible route from FXRP to USDX/);
  });

  it("selects different routes for cost vs speed priority with multiple adapters", () => {
    const registry = makeSeededRegistry();
    registry.register(
      makeCapability({
        adapter: "Kinetic",
        rate: 1.2,
        cost: 0.05,
        latencyMs: 2400,
        reliability: 0.98,
        liquidityScore: 0.9,
      })
    );
    const planner = new ExecutionPlanner();

    const costPlan = planner.plan(
      makeIntent({ constraints: { priority: "cost", maxFee: "0.06" } }),
      registry
    );
    const speedPlan = planner.plan(
      makeIntent({ constraints: { priority: "speed", maxFee: "0.06" } }),
      registry
    );

    expect(costPlan.steps[1].preferredAdapter).toBe("TestSwapAdapter");
    expect(costPlan.steps[1].fallbackAdapters).toEqual(["Kinetic"]);
    expect(speedPlan.steps[1].preferredAdapter).toBe("Kinetic");
    expect(speedPlan.steps[1].fallbackAdapters).toEqual(["TestSwapAdapter"]);
  });

  it("computes estimatedPayerAmount across a 2-hop path", () => {
    const registry = new CapabilityRegistry();
    registry.register(
      makeCapability({
        pair: ["FXRP", "FLR"],
        rate: 2500,
        cost: 0.002,
        latencyMs: 3200,
        reliability: 0.96,
        liquidityScore: 0.78,
      })
    );
    registry.register(
      makeCapability({
        pair: ["FLR", "USDT0"],
        rate: 0.5,
        cost: 0.001,
        latencyMs: 1500,
        reliability: 0.97,
        liquidityScore: 0.85,
      })
    );
    const planner = new ExecutionPlanner();

    const plan = planner.plan(makeIntent({ receiverAsset: "USDT0" }), registry);

    expect(plan.steps.filter((step) => step.action === "ConvertAsset")).toHaveLength(2);
    expect(plan.estimatedPayerAmount).toBe("0.08");
  });
});

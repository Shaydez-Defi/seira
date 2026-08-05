import { describe, expect, it } from "vitest";
import type { CapabilityEntry } from "../../core/src/types";
import { CapabilityRegistry } from "./registry";

function makeEntry(overrides: Partial<CapabilityEntry> = {}): CapabilityEntry {
  return {
    pair: ["FXRP", "USDT0"],
    rate: 1.25,
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

describe("CapabilityRegistry", () => {
  it("registers an entry retrievable by its pair", () => {
    const registry = new CapabilityRegistry();
    registry.register(makeEntry());

    const result = registry.getCapabilities("FXRP", "USDT0");

    expect(result).toHaveLength(1);
    expect(result[0].adapter).toBe("TestSwapAdapter");
  });

  it("returns all entries for an existing pair", () => {
    const registry = new CapabilityRegistry();
    registry.register(makeEntry({ adapter: "TestSwapAdapter" }));
    registry.register(makeEntry({ adapter: "Kinetic" }));

    const result = registry.getCapabilities("FXRP", "USDT0");

    expect(result).toHaveLength(2);
    expect(result.map((entry) => entry.adapter).sort()).toEqual([
      "Kinetic",
      "TestSwapAdapter",
    ]);
  });

  it("returns an empty array for a pair with no entries", () => {
    const registry = new CapabilityRegistry();
    registry.register(makeEntry());

    const result = registry.getCapabilities("FXRP", "BTC");

    expect(result).toEqual([]);
  });

  it("updateObserved mutates an existing entry", () => {
    const registry = new CapabilityRegistry();
    registry.register(makeEntry());

    registry.updateObserved(["FXRP", "USDT0"], "TestSwapAdapter", {
      reliability: 0.99,
      latencyMs: 1800,
      liquidityScore: 0.9,
    });

    const [updated] = registry.getCapabilities("FXRP", "USDT0");
    expect(updated.reliability).toBe(0.99);
    expect(updated.latencyMs).toBe(1800);
    expect(updated.liquidityScore).toBe(0.9);
    expect(updated.cost).toBe(0.003);
  });

  it("updateObserved throws when no matching entry exists", () => {
    const registry = new CapabilityRegistry();

    expect(() =>
      registry.updateObserved(["FXRP", "USDT0"], "TestSwapAdapter", { reliability: 0.99 })
    ).toThrow(/no capability registered for FXRP -> USDT0 via TestSwapAdapter/);
  });
});

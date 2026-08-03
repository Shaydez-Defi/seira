import { test } from "node:test";
import assert from "node:assert/strict";
import type { CapabilityEntry } from "../../core/src/types";
import { CapabilityRegistry } from "../src/registry";
import { seedRegistry } from "../src/seed";

function makeEntry(overrides: Partial<CapabilityEntry> = {}): CapabilityEntry {
  return {
    pair: ["FXRP", "USDT0"],
    adapter: "SparkDEX",
    action: "ConvertAsset",
    cost: 0.003,
    latencyMs: 2500,
    reliability: 0.97,
    reversible: true,
    liquidityScore: 0.85,
    ...overrides,
  };
}

test("register stores an entry retrievable by its pair", () => {
  const registry = new CapabilityRegistry();
  registry.register(makeEntry());

  const result = registry.getCapabilities("FXRP", "USDT0");

  assert.equal(result.length, 1);
  assert.equal(result[0].adapter, "SparkDEX");
});

test("getCapabilities returns all entries for a pair", () => {
  const registry = new CapabilityRegistry();
  registry.register(makeEntry({ adapter: "SparkDEX" }));
  registry.register(makeEntry({ adapter: "Kinetic" }));

  const result = registry.getCapabilities("FXRP", "USDT0");

  assert.equal(result.length, 2);
  assert.deepEqual(
    result.map((entry) => entry.adapter).sort(),
    ["Kinetic", "SparkDEX"]
  );
});

test("getCapabilities returns an empty array for an unknown pair", () => {
  const registry = new CapabilityRegistry();
  registry.register(makeEntry());

  const result = registry.getCapabilities("FXRP", "BTC");

  assert.deepEqual(result, []);
});

test("getAllPairs returns each unique pair once", () => {
  const registry = new CapabilityRegistry();
  registry.register(makeEntry());
  registry.register(makeEntry({ adapter: "Kinetic" }));
  registry.register(makeEntry({ pair: ["FXRP", "FLR"] }));

  const pairs = registry.getAllPairs();

  assert.deepEqual(pairs, [
    ["FXRP", "USDT0"],
    ["FXRP", "FLR"],
  ]);
});

test("updateObserved mutates reliability, latencyMs, and liquidityScore", () => {
  const registry = new CapabilityRegistry();
  registry.register(makeEntry());

  registry.updateObserved(["FXRP", "USDT0"], "SparkDEX", {
    reliability: 0.99,
    latencyMs: 1800,
    liquidityScore: 0.9,
  });

  const [updated] = registry.getCapabilities("FXRP", "USDT0");
  assert.equal(updated.reliability, 0.99);
  assert.equal(updated.latencyMs, 1800);
  assert.equal(updated.liquidityScore, 0.9);
  assert.equal(updated.cost, 0.003);
});

test("updateObserved throws when the pair and adapter are not registered", () => {
  const registry = new CapabilityRegistry();

  assert.throws(
    () => registry.updateObserved(["FXRP", "USDT0"], "SparkDEX", { reliability: 0.99 }),
    /no capability registered for FXRP -> USDT0 via SparkDEX/
  );
});

test("seedRegistry registers the two seeded SparkDEX routes", () => {
  const registry = new CapabilityRegistry();

  seedRegistry(registry);

  assert.equal(registry.getCapabilities("FXRP", "USDT0").length, 1);
  assert.equal(registry.getCapabilities("FXRP", "FLR").length, 1);
  assert.deepEqual(registry.getAllPairs(), [
    ["FXRP", "USDT0"],
    ["FXRP", "FLR"],
  ]);
});

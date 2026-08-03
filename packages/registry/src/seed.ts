import type { CapabilityEntry } from "../../core/src/types";
import { CapabilityRegistry } from "./registry";

const SEED_ROUTES: CapabilityEntry[] = [
  {
    pair: ["FXRP", "USDT0"],
    rate: 1.25,
    adapter: "SparkDEX",
    action: "ConvertAsset",
    cost: 0.003,
    latencyMs: 2500,
    reliability: 0.97,
    reversible: true,
    liquidityScore: 0.85,
  },
  {
    pair: ["FXRP", "FLR"],
    rate: 2500,
    adapter: "SparkDEX",
    action: "ConvertAsset",
    cost: 0.002,
    latencyMs: 3200,
    reliability: 0.96,
    reversible: true,
    liquidityScore: 0.78,
  },
];

/**
 * Registers the two seeded SparkDEX routes into the given registry.
 */
export function seedRegistry(registry: CapabilityRegistry): void {
  for (const entry of SEED_ROUTES) {
    registry.register(entry);
  }
}

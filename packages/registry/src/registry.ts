import type { CapabilityEntry } from "../../core/src/types";

export class CapabilityRegistry {
  private readonly entries: CapabilityEntry[] = [];

  /**
   * Records a capability entry so it can be discovered by asset pair.
   */
  register(entry: CapabilityEntry): void {
    this.entries.push(entry);
  }

  /**
   * Returns every capability registered for the given asset pair.
   */
  getCapabilities(fromAsset: string, toAsset: string): CapabilityEntry[] {
    return this.entries.filter(
      (entry) => entry.pair[0] === fromAsset && entry.pair[1] === toAsset
    );
  }

  /**
   * Returns each unique asset pair currently registered, in registration order.
   */
  getAllPairs(): [string, string][] {
    const seen = new Set<string>();
    const pairs: [string, string][] = [];
    for (const entry of this.entries) {
      const key = `${entry.pair[0]}\u0000${entry.pair[1]}`;
      if (!seen.has(key)) {
        seen.add(key);
        pairs.push([entry.pair[0], entry.pair[1]]);
      }
    }
    return pairs;
  }

  /**
   * Merges observed metrics into the entry matching the pair and adapter.
   */
  updateObserved(
    pair: [string, string],
    adapter: string,
    updates: Partial<Pick<CapabilityEntry, "reliability" | "latencyMs" | "liquidityScore">>
  ): void {
    const entry = this.entries.find(
      (candidate) =>
        candidate.pair[0] === pair[0] &&
        candidate.pair[1] === pair[1] &&
        candidate.adapter === adapter
    );
    if (entry === undefined) {
      throw new Error(
        `updateObserved failed: no capability registered for ${pair[0]} -> ${pair[1]} via ${adapter}`
      );
    }
    if (updates.reliability !== undefined) {
      entry.reliability = updates.reliability;
    }
    if (updates.latencyMs !== undefined) {
      entry.latencyMs = updates.latencyMs;
    }
    if (updates.liquidityScore !== undefined) {
      entry.liquidityScore = updates.liquidityScore;
    }
  }
}

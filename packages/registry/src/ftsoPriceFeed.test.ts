import { describe, expect, it } from "vitest";
import { CapabilityRegistry } from "./registry";
import { seedRegistry } from "./seed";
import {
  FLR_USD_FEED_ID,
  MAX_FEED_AGE_SECONDS,
  XRP_USD_FEED_ID,
  fetchLivePrices,
  refreshRegistryRates,
} from "./ftsoPriceFeed";
import type { FtsoV2FeedData, FtsoV2FeedReader } from "./ftsoPriceFeed";

// Known scenario: XRP/USD = 2500000 with 6 decimals (2.50 USD),
// FLR/USD = 50000 with 6 decimals (0.05 USD).
const XRP_VALUE = 2_500_000n;
const FLR_VALUE = 50_000n;
const FEED_DECIMALS = 6;

function makeFakeReader(data: Partial<FtsoV2FeedData> = {}): FtsoV2FeedReader {
  const feedData: FtsoV2FeedData = {
    values: [XRP_VALUE, FLR_VALUE],
    decimals: [FEED_DECIMALS, FEED_DECIMALS],
    timestamp: Math.floor(Date.now() / 1000),
    ...data,
  };
  return {
    async getFeedsById(feedIds) {
      if (
        feedIds.length !== 2 ||
        feedIds[0] !== XRP_USD_FEED_ID ||
        feedIds[1] !== FLR_USD_FEED_ID
      ) {
        throw new Error(`unexpected feed ids: ${feedIds.join(", ")}`);
      }
      return feedData;
    },
  };
}

function getRate(registry: CapabilityRegistry, from: string, to: string): number {
  const [entry] = registry.getCapabilities(from, to);
  if (entry === undefined) {
    throw new Error(`no capability registered for ${from} -> ${to}`);
  }
  return entry.rate;
}

describe("fetchLivePrices", () => {
  it("applies each feed's decimals to produce real float prices", async () => {
    const reader = makeFakeReader();

    const prices = await fetchLivePrices(reader);

    expect(prices.xrpUsd).toBeCloseTo(2.5, 10);
    expect(prices.flrUsd).toBeCloseTo(0.05, 10);
    expect(prices.timestamp).toBeTypeOf("number");
  });

  it("throws on a zero feed value", async () => {
    await expect(
      fetchLivePrices(makeFakeReader({ values: [0n, FLR_VALUE] }))
    ).rejects.toThrow(/zero values or non-positive decimals/);
  });

  it("throws on a zero feed timestamp", async () => {
    await expect(
      fetchLivePrices(makeFakeReader({ timestamp: 0 }))
    ).rejects.toThrow(/stale timestamp/);
  });

  it("throws on a stale feed timestamp", async () => {
    const staleTimestamp =
      Math.floor(Date.now() / 1000) - MAX_FEED_AGE_SECONDS - 1;

    await expect(
      fetchLivePrices(makeFakeReader({ timestamp: staleTimestamp }))
    ).rejects.toThrow(/stale timestamp/);
  });

  it("throws when the feed result has the wrong shape", async () => {
    await expect(
      fetchLivePrices(makeFakeReader({ values: [XRP_VALUE] }))
    ).rejects.toThrow(/expected 2 of each/);
  });
});

describe("refreshRegistryRates", () => {
  it("updates all four rates and leaves non-rate fields untouched", async () => {
    const registry = new CapabilityRegistry();
    seedRegistry(registry);
    const before = registry.getCapabilities("FXRP", "USDT0")[0];

    await refreshRegistryRates(registry, makeFakeReader());

    expect(getRate(registry, "FXRP", "USDT0")).toBeCloseTo(2.5, 10);
    expect(getRate(registry, "USDT0", "FXRP")).toBeCloseTo(0.4, 10);
    expect(getRate(registry, "FXRP", "WFLR")).toBeCloseTo(50, 10);
    expect(getRate(registry, "WFLR", "FXRP")).toBeCloseTo(0.02, 10);

    const after = registry.getCapabilities("FXRP", "USDT0")[0];
    expect(after.adapter).toBe(before.adapter);
    expect(after.cost).toBe(before.cost);
    expect(after.latencyMs).toBe(before.latencyMs);
    expect(after.reliability).toBe(before.reliability);
    expect(after.liquidityScore).toBe(before.liquidityScore);
  });

  it("throws without touching registry rates when FTSO data is invalid", async () => {
    const registry = new CapabilityRegistry();
    seedRegistry(registry);

    await expect(
      refreshRegistryRates(
        registry,
        makeFakeReader({ values: [XRP_VALUE, 0n] })
      )
    ).rejects.toThrow(/zero values or non-positive decimals/);

    expect(getRate(registry, "FXRP", "USDT0")).toBe(2.5);
    expect(getRate(registry, "FXRP", "WFLR")).toBe(10);
  });

  it("rethrows reader failures instead of keeping old rates", async () => {
    const failingReader: FtsoV2FeedReader = {
      async getFeedsById() {
        throw new Error("RPC unreachable");
      },
    };
    const registry = new CapabilityRegistry();
    seedRegistry(registry);

    await expect(
      refreshRegistryRates(registry, failingReader)
    ).rejects.toThrow(/RPC unreachable/);

    expect(getRate(registry, "FXRP", "USDT0")).toBe(2.5);
  });
});

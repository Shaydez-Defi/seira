import { Contract, JsonRpcProvider } from "ethers";
import type { Provider } from "ethers";
import { CapabilityRegistry } from "./registry";

/**
 * FlareContractRegistry is deployed at the same address on every Flare network,
 * including Coston2. It is the only trusted way to resolve the live FtsoV2
 * contract address, which can change over time.
 */
export const FLARE_CONTRACT_REGISTRY_ADDRESS =
  "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";
/** Case-sensitive registry name used to resolve the FtsoV2 contract address. */
export const FTSO_V2_CONTRACT_NAME = "FtsoV2";
/**
 * bytes21 feed IDs (category 0x01 + ASCII feed name + zero padding), verified
 * against https://dev.flare.network/ftso/feeds.
 */
export const XRP_USD_FEED_ID = "0x015852502f55534400000000000000000000000000";
export const FLR_USD_FEED_ID = "0x01464c522f55534400000000000000000000000000";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const FEED_COUNT = 2;
/** Max age of a feed timestamp (seconds) before it is treated as stale. */
export const MAX_FEED_AGE_SECONDS = 300;
const UPDATE_ADAPTER = "TestSwapAdapter";

const CONTRACT_REGISTRY_ABI = [
  "function getContractAddressByName(string name) external view returns (address)",
] as const;

const FTSO_V2_ABI = [
  "function getFeedsById(bytes21[] feedIds) external view returns (uint256[] values, int8[] decimals, uint64 timestamp)",
] as const;

/** Real float prices computed from the raw FTSOv2 feed values. */
export interface FtsoPrices {
  xrpUsd: number;
  flrUsd: number;
  timestamp: number;
}

/** Raw data returned by a single FtsoV2 getFeedsById call. */
export interface FtsoV2FeedData {
  values: readonly bigint[];
  decimals: readonly number[];
  timestamp: number;
}

/** Minimal surface of the FtsoV2 contract used by the price feed module. */
export interface FtsoV2FeedReader {
  getFeedsById(feedIds: readonly string[]): Promise<FtsoV2FeedData>;
}

interface ContractRegistryLike {
  getContractAddressByName(name: string): Promise<string>;
}

// ethers v6 decodes integer array elements as bigint (even for int8[]), and the
// named Result field "values" collides with Array.prototype.values, so the
// contract call is typed and read positionally.
interface FtsoV2ContractLike {
  getFeedsById(feedIds: string[]): Promise<
    readonly [readonly bigint[], readonly bigint[], bigint]
  >;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Builds an FtsoV2FeedReader backed by the live FlareContractRegistry and
 * FtsoV2 contracts on the given provider.
 */
export function createFtsoV2FeedReader(provider: Provider): FtsoV2FeedReader {
  const contractRegistry = new Contract(
    FLARE_CONTRACT_REGISTRY_ADDRESS,
    CONTRACT_REGISTRY_ABI,
    provider
  ) as unknown as ContractRegistryLike;

  return {
    async getFeedsById(feedIds) {
      let ftsoV2Address: string;
      try {
        ftsoV2Address = await contractRegistry.getContractAddressByName(
          FTSO_V2_CONTRACT_NAME
        );
      } catch (error) {
        throw new Error(
          `failed to resolve FtsoV2 address from FlareContractRegistry: ${toErrorMessage(error)}`,
          { cause: error }
        );
      }
      if (ftsoV2Address === ZERO_ADDRESS) {
        throw new Error(
          `FlareContractRegistry resolved no contract for "${FTSO_V2_CONTRACT_NAME}"`
        );
      }

      let result: Awaited<ReturnType<FtsoV2ContractLike["getFeedsById"]>>;
      try {
        const ftsoV2 = new Contract(
          ftsoV2Address,
          FTSO_V2_ABI,
          provider
        ) as unknown as FtsoV2ContractLike;
        result = await ftsoV2.getFeedsById([...feedIds]);
      } catch (error) {
        throw new Error(
          `failed to fetch FTSOv2 feeds: ${toErrorMessage(error)}`,
          { cause: error }
        );
      }

      return {
        values: result[0],
        decimals: result[1].map((decimals) => Number(decimals)),
        timestamp: Number(result[2]),
      };
    },
  };
}

/**
 * Creates an FtsoV2FeedReader using the Coston2 RPC URL from .env.
 */
export function createDefaultFtsoV2FeedReader(): FtsoV2FeedReader {
  const rpcUrl = process.env.COSTON2_RPC_URL;
  if (rpcUrl === undefined) {
    throw new Error("COSTON2_RPC_URL is not set in .env");
  }
  return createFtsoV2FeedReader(new JsonRpcProvider(rpcUrl));
}

/** Converts a raw feed value to a real float price using the feed's decimals. */
export function toFloatPrice(value: bigint, decimals: number): number {
  return Number(value) / 10 ** decimals;
}

function validateFeedData(data: FtsoV2FeedData): void {
  if (
    data.values.length !== FEED_COUNT ||
    data.decimals.length !== FEED_COUNT
  ) {
    throw new Error(
      `FtsoV2 getFeedsById returned ${data.values.length} values and ${data.decimals.length} decimals; expected ${FEED_COUNT} of each`
    );
  }
  if (
    data.values.some((value) => value === 0n) ||
    data.decimals.some((decimals) => decimals <= 0)
  ) {
    throw new Error(
      "FtsoV2 getFeedsById returned zero values or non-positive decimals"
    );
  }
  const ageSeconds = Math.floor(Date.now() / 1000) - data.timestamp;
  if (data.timestamp === 0 || ageSeconds < 0 || ageSeconds > MAX_FEED_AGE_SECONDS) {
    throw new Error(
      `FtsoV2 getFeedsById returned a stale timestamp (${data.timestamp}, age ${ageSeconds}s, max ${MAX_FEED_AGE_SECONDS}s)`
    );
  }
}

/**
 * Fetches live XRP/USD and FLR/USD prices from FTSOv2, validated against
 * zero/stale data and correctly scaled by each feed's decimals.
 */
export async function fetchLivePrices(
  reader: FtsoV2FeedReader = createDefaultFtsoV2FeedReader()
): Promise<FtsoPrices> {
  const data = await reader.getFeedsById([XRP_USD_FEED_ID, FLR_USD_FEED_ID]);
  validateFeedData(data);

  const xrpUsd = toFloatPrice(data.values[0], data.decimals[0]);
  const flrUsd = toFloatPrice(data.values[1], data.decimals[1]);
  if (
    !Number.isFinite(xrpUsd) ||
    xrpUsd <= 0 ||
    !Number.isFinite(flrUsd) ||
    flrUsd <= 0
  ) {
    throw new Error("FtsoV2 returned a non-finite or non-positive price");
  }

  return { xrpUsd, flrUsd, timestamp: data.timestamp };
}

/**
 * Refreshes all four seeded registry rates from live FTSOv2 prices. Only the
 * rate field is changed; adapter, cost, latencyMs, reliability, and
 * liquidityScore are left untouched.
 */
export async function refreshRegistryRates(
  registry: CapabilityRegistry,
  reader: FtsoV2FeedReader = createDefaultFtsoV2FeedReader()
): Promise<FtsoPrices> {
  const prices = await fetchLivePrices(reader);

  // USDT0 is assumed to trade at ~1 USD. This is a stablecoin-peg approximation
  // (there is no USDT0/USD feed), not a real observed price.
  const fxrpToUsdt0 = prices.xrpUsd;
  const fxrpToWflr = prices.xrpUsd / prices.flrUsd;

  const rateUpdates: Array<{ pair: [string, string]; rate: number }> = [
    { pair: ["FXRP", "USDT0"], rate: fxrpToUsdt0 },
    { pair: ["USDT0", "FXRP"], rate: 1 / fxrpToUsdt0 },
    { pair: ["FXRP", "WFLR"], rate: fxrpToWflr },
    { pair: ["WFLR", "FXRP"], rate: 1 / fxrpToWflr },
  ];

  for (const update of rateUpdates) {
    registry.updateObserved(update.pair, UPDATE_ADAPTER, { rate: update.rate });
  }

  return prices;
}

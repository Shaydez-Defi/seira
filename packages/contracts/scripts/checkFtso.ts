import { fetchLivePrices } from "../../registry/src/ftsoPriceFeed.js";

/**
 * Live verification script: fetches XRP/USD and FLR/USD prices from the real
 * Coston2 FtsoV2 contract and logs them with the feed timestamp.
 */
async function main(): Promise<void> {
  const prices = await fetchLivePrices();
  const timestampUtc = new Date(prices.timestamp * 1000).toISOString();

  console.log(`XRP/USD: ${prices.xrpUsd}`);
  console.log(`FLR/USD: ${prices.flrUsd}`);
  console.log(`timestamp: ${prices.timestamp} (${timestampUtc})`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

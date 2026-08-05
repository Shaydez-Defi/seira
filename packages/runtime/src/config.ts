/** Coston2 chain id. */
export const COSTON2_CHAIN_ID = 114;

export const TEST_SWAP_ADAPTER_ADDRESS =
  "0x1A9e28052f54b300adC845AD244b2D17E8ECc947";
export const FXRP_ADDRESS = "0x0b6A3645c240605887a5532109323A3E12273dc7";
export const USDT0_ADDRESS = "0xC1A5B41512496B80903D1f32d6dEa3a73212E71F";
export const WFLR_ADDRESS = "0xaB6FaD89389B73dBC887d31206A26Fd88d719d1F";

/** Asset symbol to deployed token address on Coston2. */
export const TOKENS: Readonly<Record<string, string>> = {
  FXRP: FXRP_ADDRESS,
  USDT0: USDT0_ADDRESS,
  WFLR: WFLR_ADDRESS,
};

/** Adapter name to deployed contract address on Coston2. */
export const ADAPTERS: Readonly<Record<string, string>> = {
  TestSwapAdapter: TEST_SWAP_ADAPTER_ADDRESS,
};

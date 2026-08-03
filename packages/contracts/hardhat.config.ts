import { defineConfig } from "hardhat/config";
import type { HardhatUserConfig } from "hardhat/config";
import "dotenv/config";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatTypechain from "@nomicfoundation/hardhat-typechain";
import hardhatMocha from "@nomicfoundation/hardhat-mocha";
import hardhatEthersChaiMatchers from "@nomicfoundation/hardhat-ethers-chai-matchers";
import hardhatNetworkHelpers from "@nomicfoundation/hardhat-network-helpers";

const coston2RpcUrl = process.env.COSTON2_RPC_URL;
const backendPrivateKey = process.env.BACKEND_PRIVATE_KEY;

const config: HardhatUserConfig = {
  plugins: [
    hardhatEthers,
    hardhatTypechain,
    hardhatMocha,
    hardhatEthersChaiMatchers,
    hardhatNetworkHelpers,
  ],
  solidity: "0.8.24",
  paths: {
    sources: "./contracts",
    tests: { mocha: "./test" },
  },
};

if (coston2RpcUrl !== undefined && backendPrivateKey !== undefined) {
  config.networks = {
    coston2: {
      type: "http",
      chainType: "l1",
      url: coston2RpcUrl,
      accounts: [backendPrivateKey],
    },
  };
}

export default defineConfig(config);

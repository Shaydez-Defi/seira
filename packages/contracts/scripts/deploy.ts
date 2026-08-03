import { network } from "hardhat";

async function main(): Promise<void> {
  if (process.env.COSTON2_RPC_URL === undefined) {
    throw new Error("COSTON2_RPC_URL is not set in .env");
  }
  if (process.env.BACKEND_PRIVATE_KEY === undefined) {
    throw new Error("BACKEND_PRIVATE_KEY is not set in .env");
  }

  const { ethers } = await network.create();

  const adapter = await ethers.deployContract("TestSwapAdapter");
  await adapter.waitForDeployment();

  console.log(`TestSwapAdapter deployed to ${await adapter.getAddress()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

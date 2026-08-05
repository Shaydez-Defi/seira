import { network } from "hardhat";

const TEST_SWAP_ADAPTER_ADDRESS = "0x1A9e28052f54b300adC845AD244b2D17E8ECc947";
const FXRP_ADDRESS = "0x0b6A3645c240605887a5532109323A3E12273dc7";
const WFLR_ADDRESS = "0xaB6FaD89389B73dBC887d31206A26Fd88d719d1F";

const AMOUNT_IN_ONE_FXRP = 10n ** 6n;
const EXPECTED_OUT_ONE_FXRP = 10n ** 19n;

async function main(): Promise<void> {
  const privateKey = process.env.BACKEND_PRIVATE_KEY;
  if (privateKey === undefined) {
    throw new Error("BACKEND_PRIVATE_KEY is not set in .env");
  }

  const { ethers } = await network.create();
  const signer = await ethers.getSigner(new ethers.Wallet(privateKey).address);

  const adapter = await ethers.getContractAt("TestSwapAdapter", TEST_SWAP_ADAPTER_ADDRESS, signer);

  const amountOut = await adapter.quote(FXRP_ADDRESS, WFLR_ADDRESS, AMOUNT_IN_ONE_FXRP);
  console.log(`quote(1 FXRP -> WFLR) = ${amountOut} raw = ${ethers.formatEther(amountOut)} WFLR`);
  console.log(`expected:                 ${EXPECTED_OUT_ONE_FXRP} raw = 10 WFLR`);

  if (amountOut !== EXPECTED_OUT_ONE_FXRP) {
    throw new Error(`unexpected quote result: ${amountOut}`);
  }
  console.log("OK: quote returned 10 WFLR for 1 FXRP without reverting");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

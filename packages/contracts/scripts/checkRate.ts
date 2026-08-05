import { network } from "hardhat";

async function main() {
  const { ethers } = await network.connect();
  const adapter = await ethers.getContractAt(
    "TestSwapAdapter",
    "0x1A9e28052f54b300adC845AD244b2D17E8ECc947"
  );
  const amountOut = await adapter.quote(
    "0x0b6A3645c240605887a5532109323A3E12273dc7",
    "0xaB6FaD89389B73dBC887d31206A26Fd88d719d1F",
    1000000
  );
  console.log("1 FXRP ->", amountOut.toString(), "WFLR (raw)");
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exitCode = 1;
});

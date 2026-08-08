import { Contract } from "ethers";
import type { Signer, TransactionResponse } from "ethers";
import { network } from "hardhat";

const TEST_SWAP_ADAPTER_ADDRESS = "0x1A9e28052f54b300adC845AD244b2D17E8ECc947";
const FXRP_ADDRESS = "0x0b6A3645c240605887a5532109323A3E12273dc7";
const USDT0_ADDRESS = "0xC1A5B41512496B80903D1f32d6dEa3a73212E71F";
const WFLR_ADDRESS = "0xaB6FaD89389B73dBC887d31206A26Fd88d719d1F";

const CHAIN_ID_COSTON2 = 114n;

/** C2FLR wrapped into WFLR so there is WFLR to spare for the adapter pool. */
const WFLR_WRAP_AMOUNT = 20n;
/** Wallet FXRP kept back: enough for a few more 25-USDT0 demo AcquireAsset checks. */
const RESERVE_FXRP_FOR_DEMO = 30n;
/** Wallet USDT0 kept back so the signer is never drained to zero. */
const RESERVE_USDT0 = 1n;
/** Wallet WFLR kept back so the alternative payer asset stays spendable. */
const RESERVE_WFLR = 2n;

const ERC20_ABI = [
  "function decimals() external view returns (uint8)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address owner) external view returns (uint256)",
] as const;

const WFLR_ABI = [
  "function deposit() external payable",
  ...ERC20_ABI,
] as const;

interface Erc20Contract {
  decimals(): Promise<bigint>;
  approve(spender: string, amount: bigint): Promise<TransactionResponse>;
  balanceOf(owner: string): Promise<bigint>;
}

interface WflrContract extends Erc20Contract {
  deposit(overrides?: { value: bigint }): Promise<TransactionResponse>;
}

interface TokenState {
  name: string;
  address: string;
  decimals: bigint;
  walletBalance: bigint;
  adapterLiquidity: bigint;
}

function erc20At(address: string, signer: Signer): Erc20Contract {
  return new Contract(address, ERC20_ABI, signer) as unknown as Erc20Contract;
}

function wflrAt(address: string, signer: Signer): WflrContract {
  return new Contract(address, WFLR_ABI, signer) as unknown as WflrContract;
}

async function main(): Promise<void> {
  const rpcUrl = process.env.COSTON2_RPC_URL;
  if (rpcUrl === undefined) {
    throw new Error("COSTON2_RPC_URL is not set in .env");
  }
  const privateKey = process.env.BACKEND_PRIVATE_KEY;
  if (privateKey === undefined) {
    throw new Error("BACKEND_PRIVATE_KEY is not set in .env");
  }

  const { ethers } = await network.create();

  const chainId = (await ethers.provider.getNetwork()).chainId;
  if (chainId !== CHAIN_ID_COSTON2) {
    throw new Error(`expected Coston2 (chain id ${CHAIN_ID_COSTON2}), got chain id ${chainId}`);
  }

  const backendAddress = new ethers.Wallet(privateKey).address;
  const signer = await ethers.getSigner(backendAddress);
  const adapter = await ethers.getContractAt("TestSwapAdapter", TEST_SWAP_ADAPTER_ADDRESS, signer);
  const wflr = wflrAt(WFLR_ADDRESS, signer);

  const tokenStates: TokenState[] = [];
  for (const [name, address, decimals] of [
    ["FXRP", FXRP_ADDRESS, 18n],
    ["USDT0", USDT0_ADDRESS, 6n],
    ["WFLR", WFLR_ADDRESS, 18n],
  ] as const) {
    const contract = erc20At(address, signer);
    tokenStates.push({
      name,
      address,
      decimals,
      walletBalance: await contract.balanceOf(backendAddress),
      adapterLiquidity: await adapter.liquidity(address),
    });
  }

  console.log("=== Backend wallet balances (before) ===");
  for (const token of tokenStates) {
    console.log(
      `${token.name}: ${ethers.formatUnits(token.walletBalance, token.decimals)} ` +
        `(adapter liquidity ${ethers.formatUnits(token.adapterLiquidity, token.decimals)})`
    );
  }
  const c2flrBefore = await ethers.provider.getBalance(backendAddress);
  console.log(`C2FLR: ${ethers.formatEther(c2flrBefore)} (adapter n/a)`);

  const wrapAmountRaw = WFLR_WRAP_AMOUNT * 10n ** 18n;
  const wrapTx = await wflr.deposit({ value: wrapAmountRaw });
  const wrapReceipt = await wrapTx.wait();
  if (wrapReceipt === null || wrapReceipt.status !== 1) {
    throw new Error(`WFLR deposit failed (tx ${wrapTx.hash})`);
  }
  const wflrState = tokenStates.find((token) => token.name === "WFLR");
  if (wflrState === undefined) {
    throw new Error("WFLR token state missing");
  }
  wflrState.walletBalance += wrapAmountRaw;
  console.log(
    `Wrapped ${WFLR_WRAP_AMOUNT} C2FLR into WFLR (tx ${wrapTx.hash}); ` +
      `wallet WFLR now ${ethers.formatUnits(wflrState.walletBalance, wflrState.decimals)}`
  );

  const funding: Array<{ name: string; address: string; decimals: bigint; amount: bigint }> = [];
  for (const token of tokenStates) {
    const reserve = token.name === "FXRP" ? RESERVE_FXRP_FOR_DEMO : token.name === "USDT0" ? RESERVE_USDT0 : RESERVE_WFLR;
    const rawReserve = reserve * 10n ** token.decimals;
    const spare = token.walletBalance > rawReserve ? token.walletBalance - rawReserve : 0n;
    funding.push({ name: token.name, address: token.address, decimals: token.decimals, amount: spare });
  }

  console.log("=== Funding amounts ===");
  for (const entry of funding) {
    console.log(`${entry.name}: ${ethers.formatUnits(entry.amount, entry.decimals)}`);
  }

  for (const entry of funding) {
    if (entry.amount === 0n) {
      console.log(`Skipping ${entry.name}: nothing to spare above reserve`);
      continue;
    }
    const contract = erc20At(entry.address, signer);
    const approveTx = await contract.approve(TEST_SWAP_ADAPTER_ADDRESS, entry.amount);
    const approveReceipt = await approveTx.wait();
    if (approveReceipt === null || approveReceipt.status !== 1) {
      throw new Error(`approve failed for ${entry.name} (tx ${approveTx.hash})`);
    }

    const fundTx = await adapter.fundLiquidity(entry.address, entry.amount);
    const fundReceipt = await fundTx.wait();
    if (fundReceipt === null || fundReceipt.status !== 1) {
      throw new Error(`fundLiquidity failed for ${entry.name} (tx ${fundTx.hash})`);
    }
    console.log(
      `Funded ${ethers.formatUnits(entry.amount, entry.decimals)} ${entry.name} ` +
        `(approve ${approveTx.hash}, fundLiquidity ${fundTx.hash})`
    );
  }

  console.log("=== Backend wallet balances + adapter liquidity (after) ===");
  for (const token of tokenStates) {
    const walletAfter = await erc20At(token.address, signer).balanceOf(backendAddress);
    const liquidityAfter = await adapter.liquidity(token.address);
    console.log(
      `${token.name}: wallet ${ethers.formatUnits(walletAfter, token.decimals)} | ` +
        `adapter liquidity ${ethers.formatUnits(liquidityAfter, token.decimals)}`
    );
  }
  const c2flrAfter = await ethers.provider.getBalance(backendAddress);
  console.log(`C2FLR: ${ethers.formatEther(c2flrAfter)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import { Contract } from "ethers";
import type { Signer, TransactionResponse } from "ethers";
import { network } from "hardhat";

const TEST_SWAP_ADAPTER_ADDRESS = "0x685295399c0CA7FA0C18bF7ABBc902C90B781559";
const FXRP_ADDRESS = "0x0b6A3645c240605887a5532109323A3E12273dc7";
const USDT0_ADDRESS = "0xC1A5B41512496B80903D1f32d6dEa3a73212E71F";
const WFLR_ADDRESS = "0xaB6FaD89389B73dBC887d31206A26Fd88d719d1F";

const CHAIN_ID_COTSON2 = 114n;
const WRAP_AMOUNT_FLR = 5n;
const DECIMALS_SCALE = 18n;

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

interface DemoToken {
  name: string;
  address: string;
  amount: bigint;
  contract: Erc20Contract;
}

interface Price {
  numerator: bigint;
  denominator: bigint;
}

interface RateSetup {
  tokenIn: string;
  tokenOut: string;
  price: Price;
}

const FXRP_TO_USDT0_PRICE: Price = { numerator: 5n, denominator: 2n };
const FXRP_TO_WFLR_PRICE: Price = { numerator: 10n, denominator: 1n };

function erc20At(address: string, signer: Signer): Erc20Contract {
  return new Contract(address, ERC20_ABI, signer) as unknown as Erc20Contract;
}

function inverse(price: Price): Price {
  return { numerator: price.denominator, denominator: price.numerator };
}

function computeRate(
  decimalsIn: number,
  decimalsOut: number,
  price: Price
): bigint {
  const numerator = 10n ** DECIMALS_SCALE * price.numerator * 10n ** BigInt(decimalsOut);
  const denominator = price.denominator * 10n ** BigInt(decimalsIn);
  if (numerator % denominator !== 0n) {
    throw new Error(
      `rate not exactly representable: ${numerator} / ${denominator} (in=${decimalsIn} out=${decimalsOut} decimals)`
    );
  }
  return numerator / denominator;
}

function formatPrice(price: Price): string {
  const integer = price.numerator / price.denominator;
  const remainder = price.numerator % price.denominator;
  if (remainder === 0n) {
    return integer.toString();
  }
  const fractional = (remainder * 10n ** DECIMALS_SCALE) / price.denominator;
  const fractionalString = fractional.toString().padStart(18, "0").replace(/0+$/, "");
  return `${integer}.${fractionalString}`;
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
  if (chainId !== CHAIN_ID_COTSON2) {
    throw new Error(`expected Coston2 (chain id ${CHAIN_ID_COTSON2}), got chain id ${chainId}`);
  }
  console.log(`Connected to Coston2 (chain id ${chainId})`);

  const backendAddress = new ethers.Wallet(privateKey).address;
  const signer = await ethers.getSigner(backendAddress);
  console.log(`Backend address: ${backendAddress}`);

  const adapter = await ethers.getContractAt("TestSwapAdapter", TEST_SWAP_ADAPTER_ADDRESS, signer);
  const wflr = erc20At(WFLR_ADDRESS, signer) as unknown as WflrContract;
  const tokens: DemoToken[] = [
    { name: "FXRP", address: FXRP_ADDRESS, amount: 3n, contract: erc20At(FXRP_ADDRESS, signer) },
    { name: "USDT0", address: USDT0_ADDRESS, amount: 3n, contract: erc20At(USDT0_ADDRESS, signer) },
    { name: "WFLR", address: WFLR_ADDRESS, amount: 3n, contract: wflr },
  ];

  const wrapAmount = ethers.parseEther(WRAP_AMOUNT_FLR.toString());
  const wflrBalanceBefore = await wflr.balanceOf(backendAddress);
  const wrapTx = await wflr.deposit({ value: wrapAmount });
  const wrapReceipt = await wrapTx.wait();
  if (wrapReceipt === null || wrapReceipt.status !== 1) {
    throw new Error(`WFLR deposit failed (tx ${wrapTx.hash})`);
  }
  const wflrBalanceAfter = await wflr.balanceOf(backendAddress);
  if (wflrBalanceAfter - wflrBalanceBefore !== wrapAmount) {
    throw new Error(
      `WFLR balance did not increase by ${wrapAmount} after deposit ` +
        `(before=${wflrBalanceBefore}, after=${wflrBalanceAfter})`
    );
  }
  console.log(
    `Wrapped ${WRAP_AMOUNT_FLR} C2FLR into WFLR (tx ${wrapTx.hash}, ` +
      `balance ${ethers.formatEther(wflrBalanceAfter)} WFLR)`
  );

  const decimalsByAddress = new Map<string, number>();
  for (const token of tokens) {
    const tokenDecimals = Number(await token.contract.decimals());
    decimalsByAddress.set(token.address, tokenDecimals);
    console.log(`Fetched decimals for ${token.name}: ${tokenDecimals}`);
  }

  for (const token of tokens) {
    const tokenDecimals = decimalsByAddress.get(token.address);
    if (tokenDecimals === undefined) {
      throw new Error(`decimals not fetched for ${token.name}`);
    }
    const rawAmount = token.amount * 10n ** BigInt(tokenDecimals);

    const approveTx = await token.contract.approve(TEST_SWAP_ADAPTER_ADDRESS, rawAmount);
    const approveReceipt = await approveTx.wait();
    if (approveReceipt === null || approveReceipt.status !== 1) {
      throw new Error(`approve failed for ${token.name} (tx ${approveTx.hash})`);
    }

    const fundTx = await adapter.fundLiquidity(token.address, rawAmount);
    const fundReceipt = await fundTx.wait();
    if (fundReceipt === null || fundReceipt.status !== 1) {
      throw new Error(`fundLiquidity failed for ${token.name} (tx ${fundTx.hash})`);
    }

    const liquidity = await adapter.liquidity(token.address);
    console.log(
      `Funded ${token.amount} ${token.name} (${rawAmount} raw units, tx ${fundTx.hash}, ` +
        `adapter liquidity now ${liquidity})`
    );
  }

  const rateSetups: RateSetup[] = [
    { tokenIn: FXRP_ADDRESS, tokenOut: USDT0_ADDRESS, price: FXRP_TO_USDT0_PRICE },
    { tokenIn: USDT0_ADDRESS, tokenOut: FXRP_ADDRESS, price: inverse(FXRP_TO_USDT0_PRICE) },
    { tokenIn: FXRP_ADDRESS, tokenOut: WFLR_ADDRESS, price: FXRP_TO_WFLR_PRICE },
    { tokenIn: WFLR_ADDRESS, tokenOut: FXRP_ADDRESS, price: inverse(FXRP_TO_WFLR_PRICE) },
  ];

  const tokenNameByAddress = new Map(tokens.map((token) => [token.address, token.name]));
  for (const setup of rateSetups) {
    const decimalsIn = decimalsByAddress.get(setup.tokenIn);
    const decimalsOut = decimalsByAddress.get(setup.tokenOut);
    if (decimalsIn === undefined || decimalsOut === undefined) {
      throw new Error(`decimals not fetched for ${setup.tokenIn} or ${setup.tokenOut}`);
    }
    const tokenInName = tokenNameByAddress.get(setup.tokenIn);
    const tokenOutName = tokenNameByAddress.get(setup.tokenOut);
    if (tokenInName === undefined || tokenOutName === undefined) {
      throw new Error(`unknown token address in rate setup ${setup.tokenIn}->${setup.tokenOut}`);
    }

    const rate = computeRate(decimalsIn, decimalsOut, setup.price);
    const setRateTx = await adapter.setRate(setup.tokenIn, setup.tokenOut, rate);
    const setRateReceipt = await setRateTx.wait();
    if (setRateReceipt === null || setRateReceipt.status !== 1) {
      throw new Error(`setRate failed for ${setup.tokenIn}->${setup.tokenOut} (tx ${setRateTx.hash})`);
    }
    console.log(
      `Configured rate ${tokenInName}->${tokenOutName}: 1 ${tokenInName} = ` +
        `${formatPrice(setup.price)} ${tokenOutName} (raw rate ${rate}, tx ${setRateTx.hash})`
    );
  }

  console.log("Demo setup complete.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

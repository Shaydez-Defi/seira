import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

async function deployAdapterFixture() {
  const [owner, user] = await ethers.getSigners();

  const tokenIn = await ethers.deployContract("MockERC20", ["FXRP", "FXRP", 18]);
  const tokenOut = await ethers.deployContract("MockERC20", ["USDT0", "USDT0", 18]);
  const adapter = await ethers.deployContract("TestSwapAdapter");

  const tokenInAddress = await tokenIn.getAddress();
  const tokenOutAddress = await tokenOut.getAddress();
  const adapterAddress = await adapter.getAddress();

  await tokenIn.mint(user.address, ethers.parseEther("10000"));
  await tokenOut.mint(owner.address, ethers.parseEther("1000000"));
  await tokenIn.connect(user).approve(adapterAddress, ethers.MaxUint256);
  await tokenIn.connect(owner).approve(adapterAddress, ethers.MaxUint256);
  await tokenOut.connect(owner).approve(adapterAddress, ethers.MaxUint256);

  return {
    tokenIn,
    tokenOut,
    adapter,
    owner,
    user,
    tokenInAddress,
    tokenOutAddress,
    adapterAddress,
  };
}

describe("TestSwapAdapter", function () {
  it("executes a swap at the configured rate and emits Swap", async function () {
    const { tokenIn, tokenOut, adapter, user, tokenInAddress, tokenOutAddress, adapterAddress } =
      await networkHelpers.loadFixture(deployAdapterFixture);

    await adapter.setRate(tokenInAddress, tokenOutAddress, ethers.parseEther("2"));
    await adapter.fundLiquidity(tokenOutAddress, ethers.parseEther("1000"));

    const amountIn = ethers.parseEther("10");
    const amountOut = ethers.parseEther("20");
    const balanceBefore = await tokenOut.balanceOf(user.address);

    await expect(
      adapter.connect(user).swap(tokenInAddress, tokenOutAddress, amountIn)
    )
      .to.emit(adapter, "Swap")
      .withArgs(tokenInAddress, tokenOutAddress, amountIn, amountOut, user.address);

    const balanceAfter = await tokenOut.balanceOf(user.address);
    expect(balanceAfter - balanceBefore).to.equal(amountOut);
    expect(await tokenIn.balanceOf(adapterAddress)).to.equal(amountIn);
  });

  it("reverts when no rate is configured for the pair", async function () {
    const { adapter, user, tokenInAddress, tokenOutAddress } =
      await networkHelpers.loadFixture(deployAdapterFixture);

    await expect(
      adapter.connect(user).swap(tokenInAddress, tokenOutAddress, ethers.parseEther("1"))
    ).to.be.revertedWith("rate not set");
  });

  it("quote returns the expected amount for a configured rate", async function () {
    const { adapter, tokenInAddress, tokenOutAddress } =
      await networkHelpers.loadFixture(deployAdapterFixture);

    await adapter.setRate(tokenInAddress, tokenOutAddress, ethers.parseEther("2"));

    const amountIn = ethers.parseEther("10");
    expect(await adapter.quote(tokenInAddress, tokenOutAddress, amountIn)).to.equal(
      ethers.parseEther("20")
    );
  });

  it("quote reverts when no rate is configured for the pair", async function () {
    const { adapter, tokenInAddress, tokenOutAddress } =
      await networkHelpers.loadFixture(deployAdapterFixture);

    await expect(
      adapter.quote(tokenInAddress, tokenOutAddress, ethers.parseEther("1"))
    ).to.be.revertedWith("rate not set");
  });

  it("reverts when liquidity is insufficient", async function () {
    const { adapter, user, tokenInAddress, tokenOutAddress } =
      await networkHelpers.loadFixture(deployAdapterFixture);

    await adapter.setRate(tokenInAddress, tokenOutAddress, ethers.parseEther("2"));

    await expect(
      adapter.connect(user).swap(tokenInAddress, tokenOutAddress, ethers.parseEther("10"))
    ).to.be.revertedWith("insufficient liquidity");
  });

  it("restricts setRate to the owner", async function () {
    const { adapter, user, tokenInAddress, tokenOutAddress } =
      await networkHelpers.loadFixture(deployAdapterFixture);

    await expect(
      adapter.connect(user).setRate(tokenInAddress, tokenOutAddress, ethers.parseEther("2"))
    ).to.be.revertedWith("not owner");
  });

  it("restricts fundLiquidity to the owner", async function () {
    const { adapter, user, tokenOutAddress } =
      await networkHelpers.loadFixture(deployAdapterFixture);

    await expect(
      adapter.connect(user).fundLiquidity(tokenOutAddress, ethers.parseEther("100"))
    ).to.be.revertedWith("not owner");
  });
});

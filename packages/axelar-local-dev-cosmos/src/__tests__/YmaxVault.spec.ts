import { expect } from "chai";
import { ethers } from "hardhat";

/**
 * Arrow references in these tests map to:
 * agoric-sdk/packages/portfolio-contract/docs-design/vault-deposit-flow.mmd
 */
describe("YmaxVault + YmaxVaultFactory", () => {
  const MAX_REPORT_AGE = 8 * 60 * 60; // 8h
  const FLOOR = 50n;
  const LOCAL_PCT_BPS = 2000; // 20%
  const HYST_BPS = 500; // 5%

  async function deployFixture() {
    const [creator, tim, reporter, p75, receiver, other] =
      await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const usdc = await MockERC20.deploy("Mock USDC", "USDC", 18);
    await usdc.waitForDeployment();

    await usdc.mint(tim.address, 10_000n);

    const Factory = await ethers.getContractFactory("YmaxVaultFactory");
    const factory = await Factory.deploy(reporter.address);
    await factory.waitForDeployment();

    const createTx = await factory
      .connect(creator)
      .createVault(
        await usdc.getAddress(),
        "Chris Vault Share",
        "CVSH",
        p75.address,
        FLOOR,
        LOCAL_PCT_BPS,
        HYST_BPS,
        MAX_REPORT_AGE,
      );
    const createReceipt = await createTx.wait();

    const created = createReceipt?.logs
      .map((log) => {
        try {
          return factory.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed?.name === "VaultCreated");

    const vaultAddress = created?.args.vault;
    expect(vaultAddress).to.not.equal(undefined);

    const Vault = await ethers.getContractFactory("YmaxVault");
    const vault = Vault.attach(vaultAddress!);

    return {
      creator,
      tim,
      reporter,
      p75,
      receiver,
      other,
      usdc,
      factory,
      vault,
    };
  }

  it("deposit mints shares, transfers excess to owner portfolio account, and preserves totalAssets invariant", async () => {
    const { tim, p75, usdc, vault } = await deployFixture();
    const vaultAddress = await vault.getAddress();

    // Deposit flow arrow: wallet -->> usdc: approve(0xVAU1, 250USDC)
    await usdc.connect(tim).approve(vaultAddress, 250n);

    // Deposit flow arrows:
    // wallet -->> vault: deposit(250USDC, 0xTIM)
    // vault -->> usdc: transferFrom(0xTIM, 0xVAU1, 250USDC)
    // vault -->> usdc: transfer(0xP751, excessUSDC)
    // vault -->> ui: emit Deposit(0xTIM, 0xTIM, 250USDC, 250CVSH)
    await expect(vault.connect(tim).deposit(250n, tim.address))
      .to.emit(vault, "Deposit")
      .withArgs(tim.address, tim.address, 250n, 250n)
      .and.to.emit(usdc, "Transfer")
      .withArgs(tim.address, vaultAddress, 250n)
      .and.to.emit(usdc, "Transfer")
      .withArgs(vaultAddress, p75.address, 200n);

    // target = max(50, 20% of 250 = 50), local=250 => transfer excess 200
    expect(await usdc.balanceOf(await vault.getAddress())).to.equal(50n);
    expect(await usdc.balanceOf(p75.address)).to.equal(200n);
    expect(await vault.managedAssets()).to.equal(200n);

    expect(await vault.balanceOf(tim.address)).to.equal(250n);
    expect(await vault.totalSupply()).to.equal(250n);

    // invariant
    expect(await vault.totalAssets()).to.equal(250n);
  });

  it("enforces reporter -> factory -> vault managed-assets reporting path", async () => {
    const { reporter, other, factory, vault } = await deployFixture();

    const reportId1 = ethers.keccak256(ethers.toUtf8Bytes("report-1"));
    const latestBlock = await ethers.provider.getBlock("latest");
    const asOf = BigInt(latestBlock!.timestamp);

    // Reporting flow arrow: reporter must not call vault directly.
    await expect(
      vault.connect(reporter).reportManagedAssets(123n, asOf, reportId1),
    ).to.be.revertedWithCustomError(vault, "OnlyFactory");

    // Reporting flow arrow: only asset reporter may call factory.reportManagedAssets(...)
    await expect(
      factory.connect(other).reportManagedAssets(await vault.getAddress(), 123n, asOf, reportId1),
    ).to.be.revertedWithCustomError(factory, "NotAssetReporter");

    // Reporting flow arrows:
    // reporter ->> factory: reportManagedAssets(...)
    // factory ->> vault: reportManagedAssets(...)
    await expect(
      factory
        .connect(reporter)
        .reportManagedAssets(await vault.getAddress(), 123n, asOf, reportId1),
    )
      .to.emit(vault, "ManagedAssetsReported")
      .withArgs(123n, asOf, reportId1);

    expect(await vault.managedAssets()).to.equal(123n);

    // replay/monotonicity check
    await expect(
      factory
        .connect(reporter)
        .reportManagedAssets(await vault.getAddress(), 130n, asOf + 1n, reportId1),
    ).to.be.revertedWithCustomError(vault, "InvalidReportId");
  });

  it("gates sync redeem on local liquidity and report freshness (8h)", async () => {
    const { tim, receiver, reporter, usdc, factory, vault } = await deployFixture();

    // Reuses deposit flow arrows (approve + deposit + transferFrom + excess transfer).
    await usdc.connect(tim).approve(await vault.getAddress(), 250n);
    await vault.connect(tim).deposit(250n, tim.address);

    // Withdraw flow arrow: wallet -->> vault: redeem(shares, receiver, owner)
    // Small redeem succeeds while fresh and locally liquid
    await expect(
      vault.connect(tim).redeem(10n, receiver.address, tim.address),
    ).to.emit(vault, "Withdraw");

    // Larger redeem fails because local liquidity is only 50 - 10 = 40
    await expect(
      vault.connect(tim).redeem(100n, receiver.address, tim.address),
    ).to.be.revertedWithCustomError(vault, "InsufficientLocalLiquidity");

    // Age out report freshness
    await ethers.provider.send("evm_increaseTime", [MAX_REPORT_AGE + 1]);
    await ethers.provider.send("evm_mine", []);

    await expect(
      vault.connect(tim).redeem(1n, receiver.address, tim.address),
    ).to.be.revertedWithCustomError(vault, "StaleManagedAssetsReport");

    // Fresh report restores eligibility (liquidity still applies)
    const reportId2 = ethers.keccak256(ethers.toUtf8Bytes("report-2"));
    const latestBlock = await ethers.provider.getBlock("latest");
    await factory
      .connect(reporter)
      .reportManagedAssets(
        await vault.getAddress(),
        await vault.managedAssets(),
        BigInt(latestBlock!.timestamp),
        reportId2,
      );

    await expect(
      vault.connect(tim).redeem(1n, receiver.address, tim.address),
    ).to.emit(vault, "Withdraw");
  });
});

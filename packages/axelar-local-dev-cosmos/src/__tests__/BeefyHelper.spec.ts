import { expect } from "chai";
import { ethers } from "hardhat";

describe("WalletHelper", () => {
  let walletHelper: ethers.Contract;
  let mockVault: ethers.Contract;
  let mockUSDC: ethers.Contract;
  let owner: ethers.SignerWithAddress;
  let user: ethers.SignerWithAddress;

  beforeEach(async () => {
    [owner, user] = await ethers.getSigners();

    // Deploy mock USDC token
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    mockUSDC = await MockERC20Factory.deploy("USDC", "USDC", 6);
    await mockUSDC.waitForDeployment();

    // Deploy mock Beefy vault
    const MockBeefyVaultFactory =
      await ethers.getContractFactory("MockBeefyVault");
    mockVault = await MockBeefyVaultFactory.deploy(mockUSDC.target);
    await mockVault.waitForDeployment();

    // Deploy WalletHelper
    const WalletHelperFactory = await ethers.getContractFactory("WalletHelper");
    walletHelper = await WalletHelperFactory.deploy();
    await walletHelper.waitForDeployment();
  });

  describe("beefyWithdrawUSDC", () => {
    it("should calculate correct mooTokens needed and withdraw USDC", async () => {
      const usdcAmount = ethers.parseUnits("1000", 6); // 1000 USDC

      const balance = 2000_000_000n;
      const totalSupply = 1000_000_000n;

      mockVault.setTotalSupply(totalSupply);
      
      // Setup: Mint USDC to vault
      await mockUSDC.mint(mockVault.target, balance);

      // Setup: Mint mooTokens to user
      const expectedShares =
        (usdcAmount * totalSupply) / balance;
      await mockVault.mint(user.address, expectedShares);

      // User approves WalletHelper to spend mooTokens
      await mockVault
        .connect(user)
        .approve(walletHelper.target, expectedShares);

      const userUSDCBefore = await mockUSDC.balanceOf(user.address);
      const userSharesBefore = await mockVault.balanceOf(user.address);

      // User calls beefyWithdrawUSDC
      await walletHelper
        .connect(user)
        .beefyWithdrawUSDC(mockVault.target, usdcAmount);

      const userUSDCAfter = await mockUSDC.balanceOf(user.address);
      const userSharesAfter = await mockVault.balanceOf(user.address);
      // Verify USDC was transferred to user
      expect(userUSDCAfter - userUSDCBefore).to.equal(usdcAmount);

      // Verify mooTokens were deducted from user
      expect(userSharesBefore - userSharesAfter).to.equal(expectedShares);
    });

    it("should not have a rounding error", async () => {
      const usdcAmount = 1000000n; // 1000 USDC

      // These should simulate a scenario that could cause rounding errors
      // If the division is not handled properly
      const balance = 2942721276721n;
      const totalSupply = 2675589349023n;

      await mockUSDC.mint(mockVault.target, balance);

      // Using the same formula as in WalletHelper which rounds up
      const expectedShares =
        ((usdcAmount * totalSupply) + balance - 1n) / balance;
      await mockVault.mint(user.address, expectedShares);

      await mockVault.setTotalSupply(totalSupply);

      await mockVault
        .connect(user)
        .approve(walletHelper.target, expectedShares);

      const userUSDCBefore = await mockUSDC.balanceOf(user.address);
      const userSharesBefore = await mockVault.balanceOf(user.address);

      await walletHelper
        .connect(user)
        .beefyWithdrawUSDC(mockVault.target, usdcAmount);

      const userUSDCAfter = await mockUSDC.balanceOf(user.address);
      const userSharesAfter = await mockVault.balanceOf(user.address);

      expect(userUSDCAfter - userUSDCBefore).to.equal(usdcAmount);
      expect(userSharesBefore - userSharesAfter).to.equal(expectedShares);
    });

    it("should revert if user has insufficient mooTokens", async () => {
      const usdcAmount = ethers.parseUnits("1000", 6);

      mockVault.setTotalSupply( 10_000_000n);

      // User has 0 mooTokens but tries to withdraw
      await expect(
        walletHelper
          .connect(user)
          .beefyWithdrawUSDC(mockVault.target, usdcAmount),
      ).to.be.reverted;
    });

    it("should revert if user hasn't approved WalletHelper", async () => {
      const usdcAmount = ethers.parseUnits("100", 6);
      const shares = usdcAmount;

      mockVault.setTotalSupply(shares * 10n);

      await mockUSDC.mint(mockVault.target, ethers.parseUnits("1000", 6));
      await mockVault.mint(user.address, shares);

      // Don't approve WalletHelper
      await expect(
        walletHelper
          .connect(user)
          .beefyWithdrawUSDC(mockVault.target, usdcAmount),
      ).to.be.reverted;
    });

    it("should demonstrate formula equivalence: ((a * b) + c - 1) / c vs (a * b + c - 1) / c", async () => {
      // This test demonstrates that the two formulas are mathematically equivalent
      // Formula 1: ((usdcAmount * totalSupply) + balance - 1) / balance
      // Formula 2: (usdcAmount * totalSupply + balance - 1) / balance
      
      const testCases = [
        { usdcAmount: 1000000n, balance: 2942721276721n, totalSupply: 2675589349023n },
        { usdcAmount: 1n, balance: 1000000n, totalSupply: 500000n },
        { usdcAmount: 999999n, balance: 1000000n, totalSupply: 1000000n },
        { usdcAmount: 100000n, balance: 3141592653589n, totalSupply: 2718281828459n },
      ];

      for (const testCase of testCases) {
        const { usdcAmount, balance, totalSupply } = testCase;

        // Formula 1: ((usdcAmount * totalSupply) + balance - 1) / balance
        const formula1 = ((usdcAmount * totalSupply) + balance - 1n) / balance;

        // Formula 2: (usdcAmount * totalSupply + balance - 1) / balance
        const formula2 = (usdcAmount * totalSupply + balance - 1n) / balance;

        // Both formulas should produce the same result
        expect(formula1).to.equal(formula2,
          `Formulas differ for usdcAmount=${usdcAmount}, balance=${balance}, totalSupply=${totalSupply}`);
      }
    });
  });
});

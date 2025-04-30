// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./MockAave.sol";

/**
 * @title TestAaveIntegration
 * @dev A sample contract that integrates with the MockAavePool contract
 * Shows how to integrate with Aave V3 compatible API
 */
contract TestAaveIntegration {
    // MockAavePool contract reference
    MockAavePool public aavePool;
    
    // Events for testing and tracking operations
    event Deposited(address asset, address onBehalfOf, uint256 amount);
    event Withdrawn(address asset, address to, uint256 amount, uint256 received);
    event RewardsClaimed(address asset, address to, uint256 amount);
    event RatesChecked(address asset, uint256 liquidityRate, uint256 variableBorrowRate, uint256 stableBorrowRate);
    event AccountDataChecked(
        uint256 totalCollateralBase,
        uint256 totalDebtBase,
        uint256 availableBorrowsBase,
        uint256 liquidationThreshold,
        uint256 ltv,
        uint256 healthFactor
    );
    
    constructor(address _aavePoolAddress) {
        aavePool = MockAavePool(_aavePoolAddress);
    }
    
    /**
     * @dev Supply tokens to Aave Pool
     * @param asset The asset to supply
     * @param amount The amount to supply
     * @param onBehalfOf The address that will receive the aTokens (usually msg.sender)
     */
    function supplyToAave(address asset, uint256 amount, address onBehalfOf) external {
        // First, ensure this contract has enough tokens
        require(IERC20(asset).balanceOf(address(this)) >= amount, "Insufficient token balance");
        
        // Approve Aave to spend tokens
        IERC20(asset).approve(address(aavePool), amount);
        
        // Supply tokens to Aave (using 0 as the referral code)
        aavePool.supply(asset, amount, onBehalfOf, 0);
        
        emit Deposited(asset, onBehalfOf, amount);
    }
    
    /**
     * @dev Withdraw tokens from Aave Pool
     * @param asset The asset to withdraw
     * @param amount The amount to withdraw (use type(uint256).max for all)
     * @param to The recipient address
     * @return The actual amount received (including interest)
     */
    function withdrawFromAave(address asset, uint256 amount, address to) external returns (uint256) {
        // Withdraw tokens from Aave
        uint256 received = aavePool.withdraw(asset, amount, to);
        
        emit Withdrawn(asset, to, amount, received);
        
        return received;
    }
    
    /**
     * @dev Claim rewards from Aave
     * @param asset The asset to claim rewards for
     * @param to The recipient address
     * @return The amount of rewards claimed
     */
    function claimAaveRewards(address asset, address to) external returns (uint256) {
        // Check if there are any rewards to claim first
        uint256 pendingRewards = aavePool.getPendingRewards(address(this), asset);
        
        // If no rewards, just emit event with zero and return
        if (pendingRewards == 0) {
            emit RewardsClaimed(asset, to, 0);
            return 0;
        }
        
        // Otherwise proceed with claiming rewards
        uint256 rewards = aavePool.claimRewards(asset, to);
        
        emit RewardsClaimed(asset, to, rewards);
        
        return rewards;
    }
    
    /**
     * @dev Get reserve data from Aave
     * @param asset The asset to get data for
     */
    function getAaveReserveData(address asset) external {
        // Get reserve data from Aave
        MockAavePool.ReserveData memory data = aavePool.getReserveData(asset);
        
        // Emit an event with the rates
        emit RatesChecked(
            asset, 
            data.currentLiquidityRate, 
            data.currentVariableBorrowRate, 
            data.currentStableBorrowRate
        );
    }
    
    /**
     * @dev Get user account data from Aave
     * @param user The user to get data for
     */
    function getAaveUserAccountData(address user) external {
        // Get account data from Aave
        (
            uint256 totalCollateralBase,
            uint256 totalDebtBase,
            uint256 availableBorrowsBase,
            uint256 currentLiquidationThreshold,
            uint256 ltv,
            uint256 healthFactor
        ) = aavePool.getUserAccountData(user);
        
        // Emit an event with the account data
        emit AccountDataChecked(
            totalCollateralBase,
            totalDebtBase,
            availableBorrowsBase,
            currentLiquidationThreshold,
            ltv,
            healthFactor
        );
    }
    
    /**
     * @dev Get normalized income for an asset
     * @param asset The asset to check
     * @return The normalized income in ray units
     */
    function getAaveNormalizedIncome(address asset) external view returns (uint256) {
        return aavePool.getReserveNormalizedIncome(asset);
    }
    
    /**
     * @dev Get aToken balance
     * @param aTokenAddress The aToken address (get from reserve data)
     * @param user The user address
     * @return The aToken balance
     */
    function getATokenBalance(address aTokenAddress, address user) external view returns (uint256) {
        return aavePool.balanceOf(aTokenAddress, user);
    }
    
    /**
     * @dev Get pending rewards
     * @param user The user address
     * @param asset The asset address
     * @return The pending rewards
     */
    function getPendingRewards(address user, address asset) external view returns (uint256) {
        return aavePool.getPendingRewards(user, asset);
    }
    
    /**
     * @dev Get accrued interest
     * @param user The user address
     * @param asset The asset address
     * @return The accrued interest
     */
    function getAccruedInterest(address user, address asset) external view returns (uint256) {
        return aavePool.getAccruedInterest(user, asset);
    }
    
    /**
     * @dev Utility function to transfer tokens out of this contract
     * @param token The token to transfer
     * @param to The recipient address
     * @param amount The amount to transfer
     */
    function transferTokens(address token, address to, uint256 amount) external {
        IERC20(token).transfer(to, amount);
    }
}

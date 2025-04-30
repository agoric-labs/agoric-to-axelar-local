import { SigningStargateClient } from '@cosmjs/stargate';
import { defaultAxelarChainInfo, AxelarRelayerService } from './index';
import { ethers } from 'ethers';
import { formatUnits } from "ethers/lib/utils";

import fs from 'fs';
import path from 'path';
import { encode } from "@metamask/abi-utils";
import {
  evmRelayer,
  createNetwork,
  deployContract,
  relay,
  RelayerType,
} from '@axelar-network/axelar-local-dev';
import { time } from 'console';

export const relayBasic = async () => {
  const axelarRelayer = await AxelarRelayerService.create(defaultAxelarChainInfo);
  const ethereumNetwork = await createNetwork({ name: 'Ethereum' });

  const multiCallContract = await deployContract(
    ethereumNetwork.userWallets[0],
    require('../artifacts/src/__tests__/contracts/Multicall.sol/Multicall.json')
  );
  console.log('MultiCall Contract Address:', multiCallContract.address);

  const factoryContract = await deployContract(
    ethereumNetwork.userWallets[0],
    require('../artifacts/src/__tests__/contracts/Factory.sol/Factory.json'),
    [
      ethereumNetwork.gateway.address,
      ethereumNetwork.gasService.address,
      'Ethereum',
    ]
  );

  const aaveContract = await deployContract(
    ethereumNetwork.userWallets[0],
    require('../artifacts/src/__tests__/contracts/MockAave.sol/MockAavePool.json'),
    []
  );
  console.log('MockAave Contract Address:', aaveContract.address);

  const testIntegration = await deployContract(
    ethereumNetwork.userWallets[0],
    require('../artifacts/src/__tests__/contracts/TestAaveIntegration.sol/TestAaveIntegration.json'),
    [aaveContract.address]
  );
  console.log('TestAaveIntegration Contract Address:', testIntegration.address);

  const provider = ethereumNetwork.provider;
  const deployer = ethereumNetwork.userWallets[0];

  // Load compiled MintableERC20
  const tokenArtifact = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, '../artifacts/src/__tests__/contracts/MintableERC20.sol/MintableERC20.json'),
      'utf8'
    )
  );
  const ERC20 = new ethers.ContractFactory(tokenArtifact.abi, tokenArtifact.bytecode, deployer);

  const token = await ERC20.deploy("Mock DAI", "mDAI");
  await token.deployed();
  console.log("MintableERC20 deployed at:", token.address);
  let balance = await token.balanceOf(testIntegration.address);
  console.log("Token balance before minting:", formatUnits(balance, 18));

  // Mint tokens
  await (await token.mint(testIntegration.address, ethers.utils.parseEther("1000"))).wait();

  balance = await token.balanceOf(testIntegration.address);
  console.log("Token balance after minting:", formatUnits(balance, 18));

  await aaveContract.setReserveData(
    token.address,
    ethers.utils.parseUnits("0.05", 27), // 5% liquidity rate
    ethers.utils.parseUnits("0.07", 27), // 7% variable borrow rate
    ethers.utils.parseUnits("0.06", 27), // 6% stable borrow rate
    100 // 1% reward rate (in basis points)
  );

  // Test supplyToAave
  let amount = ethers.utils.parseEther("500");
  // Supply tokens on behalf of the TestAaveIntegration contract itself, not the deployer
  const tx = await testIntegration.supplyToAave(token.address, amount, testIntegration.address);
  await tx.wait();
  console.log("Supplied tokens to MockAave");
  // Test withdrawFromAave
  
  let aTokenBalance = await aaveContract.getAccruedInterest(testIntegration.address, token.address);
  console.log("Accrued interest before withdrawal:", ethers.utils.formatEther(aTokenBalance));
  aTokenBalance = await aaveContract.getAccruedInterest(deployer.address, token.address);
  console.log("Accrued interest before withdrawal:", ethers.utils.formatEther(aTokenBalance));

  // Get balance before withdrawal
  balance = await token.balanceOf(deployer.address);
  console.log("Token balance before withdrawFromAave:", formatUnits(balance, 18));

  try {
    amount = ethers.utils.parseEther("10");
    const withdrawTx = await testIntegration.withdrawFromAave(token.address, amount, deployer.address);
    const receipt = await withdrawTx.wait();
    
    // Use the contract interface to decode the logs
    const testIntegrationInterface = testIntegration.interface;
    for (const log of receipt.logs) {
      try {
        const parsedLog = testIntegrationInterface.parseLog(log);
        if (parsedLog && parsedLog.name === "Withdrawn") {
          console.log("Withdrawn:", parsedLog.args.received.toString());
          break;
        }
      } catch (error) {
        // Skip logs that can't be parsed by this interface
        continue;
      }
    }
    
    // Check balance after withdrawal
    balance = await token.balanceOf(deployer.address);
    console.log("Token balance after withdrawFromAave:", formatUnits(balance, 18));
  } catch (error) {
    console.error("Error during withdrawal:", error);
  }

  // Wait for 5 seconds to allow accrual of interest
  console.log("------------------------ waiting 5 seconds ------------------------");
  await new Promise(resolve => setTimeout(resolve, 5000));
  const rpcProvider = provider as ethers.providers.JsonRpcProvider;
  await rpcProvider.send("evm_mine", []);




  console.log("------------------------ finished waiting ------------------------");

//   console.log("\n---- Debug Reward Calculation ----");
// const [
//   depositAmount,
//   depositTime,
//   timeElapsed,
//   rewardRate,
//   ratePerSecond,
//   rewards
// ] = await aaveContract.debugRewardComponents(testIntegration.address, token.address);

// console.log("depositAmount:", ethers.utils.formatEther(depositAmount));
// console.log("depositTime (unix):", depositTime.toString());
// console.log("timeElapsed (seconds):", timeElapsed.toString());
// console.log("rewardRate (bps):", rewardRate.toString());
// console.log("ratePerSecond (scaled):", ratePerSecond.toString());
// console.log("rewards (raw wei):", rewards.toString());
// console.log("rewards (formatted):", ethers.utils.formatEther(rewards));


  // Check accrued interest after waiting
  const aTokenBalanceAfterWait = await aaveContract.getAccruedInterest(testIntegration.address, token.address);
  console.log("Accrued interest after waiting:", ethers.utils.formatEther(aTokenBalanceAfterWait));


  
  // Check accrued interest after waiting
  const pendingRewards = await aaveContract.getPendingRewards(testIntegration.address, token.address);
  console.log("Pending rewards after waiting:", ethers.utils.formatEther(pendingRewards));

  
  try {
    const claimTx = await testIntegration.claimAaveRewards(token.address, deployer.address);
    const claimReceipt = await claimTx.wait();
    
    // Use the contract interface to decode the logs
    const testIntegrationInterface = testIntegration.interface;
    for (const log of claimReceipt.logs) {
      try {
        const parsedLog = testIntegrationInterface.parseLog(log);
        if (parsedLog && parsedLog.name === "RewardsClaimed") {
          console.log("Rewards claimed:", parsedLog.args.amount.toString());
          break;
        }
      } catch (error) {
        // Skip logs that can't be parsed by this interface
        continue;
      }
    }
  } catch (error) {
    console.error("Error claiming rewards:", error);
  }

  // Check reserve data
  // console.log("------------------------ starting getAaveReserveData ------------------------");
  // try {
  //   const reserveData = await testIntegration.getAaveReserveData(token.address);
  //   console.log("Reserve data retrieved successfully");
    
  //   // Format and print important information from ReserveData structure
  //   console.log("\n==== RESERVE DATA DETAILS ====");
    
  //   // Get the raw reserve data directly from the MockAave contract for more detailed info
  //   const rawReserveData = await aaveContract.getReserveData(token.address);
    
  //   // Convert ray values (1e27) to percentages for easier reading
  //   const liquidityRatePercent = ethers.utils.formatUnits(rawReserveData.currentLiquidityRate, 25); // 27 - 2 decimals
  //   const variableBorrowRatePercent = ethers.utils.formatUnits(rawReserveData.currentVariableBorrowRate, 25);
  //   const stableBorrowRatePercent = ethers.utils.formatUnits(rawReserveData.currentStableBorrowRate, 25);
    
  //   console.log(`Liquidity Index: ${ethers.utils.formatUnits(rawReserveData.liquidityIndex, 27)}`);
  //   console.log(`Current Liquidity Rate: ${liquidityRatePercent}% APY`);
  //   console.log(`Variable Borrow Index: ${ethers.utils.formatUnits(rawReserveData.variableBorrowIndex, 27)}`);
  //   console.log(`Current Variable Borrow Rate: ${variableBorrowRatePercent}% APY`);
  //   console.log(`Current Stable Borrow Rate: ${stableBorrowRatePercent}% APY`);
  //   console.log(`Last Update Timestamp: ${new Date(rawReserveData.lastUpdateTimestamp.toNumber() * 1000).toISOString()}`);
  //   console.log(`aToken Address: ${rawReserveData.aTokenAddress}`);
  //   console.log(`Stable Debt Token Address: ${rawReserveData.stableDebtTokenAddress}`);
  //   console.log(`Variable Debt Token Address: ${rawReserveData.variableDebtTokenAddress}`);
  //   console.log(`Interest Rate Strategy Address: ${rawReserveData.interestRateStrategyAddress}`);
    
  //   // Get additional reserve information
  //   const normalizedIncome = await aaveContract.getReserveNormalizedIncome(token.address);
  //   console.log(`Normalized Income: ${ethers.utils.formatUnits(normalizedIncome, 27)}`);
    
  //   // Calculate current rewards for the test integration contract
  //   const pendingRewards = await aaveContract.getPendingRewards(testIntegration.address, token.address);
  //   console.log(`Pending Rewards: ${ethers.utils.formatEther(pendingRewards)} tokens`);
    

  //   const rewardPeriod = await provider.getBlock('latest');
  //   console.log(`Current Block Timestamp: ${new Date(rewardPeriod.timestamp * 1000).toISOString()}`);
    
  // } catch (error) {
  //   console.error("Error getting reserve data:", error);
  // }

  // try {
  //   const userData = await testIntegration.getAaveUserAccountData(testIntegration.address);
  //   console.log("User account data retrieved successfully");
    
  //   // Format and print important information from UserAccountData
  //   console.log("\n==== USER ACCOUNT DATA DETAILS ====");
  //   const userAccountData = await aaveContract.getUserAccountData(testIntegration.address);
    
  //   console.log(`Total Collateral: ${ethers.utils.formatEther(userAccountData[0])} tokens`);
  //   console.log(`Total Debt: ${ethers.utils.formatEther(userAccountData[1])} tokens`);
  //   console.log(`Available Borrowing Capacity: ${ethers.utils.formatEther(userAccountData[2])} tokens`);
  //   console.log(`Liquidation Threshold: ${userAccountData[3].toNumber() / 100}%`);
  //   console.log(`Loan to Value: ${userAccountData[4].toNumber() / 100}%`);
  //   console.log(`Health Factor: ${ethers.utils.formatEther(userAccountData[5])}`);
    
  // } catch (error) {
  //   console.error("Error getting user account data:", error);
  // }
  
  evmRelayer.setRelayer(RelayerType.Agoric, axelarRelayer);
};


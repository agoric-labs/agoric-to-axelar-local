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
    ethers.utils.parseUnits("5", 27), // 5% liquidity rate
    ethers.utils.parseUnits("7", 27), // 7% variable borrow rate
    ethers.utils.parseUnits("6", 27), // 6% stable borrow rate
    100 // 1% reward rate (in basis points)
  );

  console.log("------------------------ starting supplyToAave ------------------------");
  // Test supplyToAave
  let amount = ethers.utils.parseEther("50");
  // Supply tokens on behalf of the TestAaveIntegration contract itself, not the deployer
  const tx = await testIntegration.supplyToAave(token.address, amount, testIntegration.address);
  await tx.wait();
  console.log("Supplied tokens to MockAave");
  console.log("------------------------ completed supplyToAave ------------------------");
  // Test withdrawFromAave
  console.log("------------------------ starting withdrawFromAave ------------------------");
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
  console.log("------------------------ finished waiting ------------------------");

  // Check accrued interest after waiting
  const aTokenBalanceAfterWait = await aaveContract.getAccruedInterest(testIntegration.address, token.address);
  console.log("Accrued interest after waiting:", ethers.utils.formatEther(aTokenBalanceAfterWait));

  // Test rewards
  console.log("------------------------ starting claimAaveRewards ------------------------");
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
  console.log("------------------------ starting getAaveReserveData ------------------------");
  try {
    const reserveData = await testIntegration.getAaveReserveData(token.address);
    console.log("Reserve data retrieved successfully");
  } catch (error) {
    console.error("Error getting reserve data:", error);
  }

  // Check user data
  console.log("------------------------ starting getAaveUserAccountData ------------------------");
  try {
    const userData = await testIntegration.getAaveUserAccountData(deployer.address);
    console.log("User account data retrieved successfully");
  } catch (error) {
    console.error("Error getting user account data:", error);
  }

  evmRelayer.setRelayer(RelayerType.Agoric, axelarRelayer);
};


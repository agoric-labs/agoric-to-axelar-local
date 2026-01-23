#!/usr/bin/env ts-node

import { ethers } from "ethers";
import { config } from "dotenv";

config();

const { INFURA_KEY } = process.env;

const checkGasPrice = async () => {
  if (!INFURA_KEY) {
    console.error("❌ Error: INFURA_KEY not found in environment");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(
    `https://mainnet.infura.io/v3/${INFURA_KEY}`,
  );

  try {
    console.log("\n🔍 Fetching current Ethereum gas prices...\n");
    const feeData = await provider.getFeeData();

    console.log("═══════════════════════════════════════");
    console.log("📊 Current Ethereum Gas Prices");
    console.log("═══════════════════════════════════════");

    if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
      const maxFeeGwei = Number(feeData.maxFeePerGas) / 1e9;
      const priorityFeeGwei = Number(feeData.maxPriorityFeePerGas) / 1e9;

      console.log(`\nCurrent Network Prices:`);
      console.log(`  Max Fee Per Gas:      ${maxFeeGwei.toFixed(2)} gwei`);
      console.log(`  Priority Fee Per Gas: ${priorityFeeGwei.toFixed(2)} gwei`);

      const recommendedMaxFee = Math.ceil(maxFeeGwei * 1.5);
      const recommendedPriorityFee = Math.ceil(priorityFeeGwei * 1.2);

      console.log(`\n💡 Recommended Settings (with buffer):`);
      console.log(
        `  Max Fee Per Gas:      ${recommendedMaxFee} gwei (50% buffer)`,
      );
      console.log(
        `  Priority Fee Per Gas: ${recommendedPriorityFee} gwei (20% buffer)`,
      );

      console.log(`\n📝 For hardhat.config.ts:`);
      console.log(`  maxFeePerGas: ${recommendedMaxFee}_000_000_000,`);
      console.log(
        `  maxPriorityFeePerGas: ${recommendedPriorityFee}_000_000_000,`,
      );
    } else if (feeData.gasPrice) {
      const gasPriceGwei = Number(feeData.gasPrice) / 1e9;
      console.log(`\nGas Price (legacy): ${gasPriceGwei.toFixed(2)} gwei`);

      const recommendedGasPrice = Math.ceil(gasPriceGwei * 1.2);
      console.log(
        `\n💡 Recommended (with 20% buffer): ${recommendedGasPrice} gwei`,
      );
      console.log(`\n📝 For hardhat.config.ts:`);
      console.log(`  gasPrice: ${recommendedGasPrice}_000_000_000,`);
    }

    console.log("\n═══════════════════════════════════════\n");
  } catch (error: any) {
    console.error("❌ Error fetching gas prices:", error.message);
    process.exit(1);
  }
};

checkGasPrice();

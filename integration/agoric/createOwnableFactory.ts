/**
 * Create an Ownable Factory via FactoryFactory contract on Arbitrum Sepolia.
 * This script sends a GMP message from Agoric to FactoryFactory which will
 * deploy a new Factory contract owned by the Agoric sender address.
 */

import { config } from "dotenv";
import { createOwnableFactory } from "./flows.js";
import { FACTORY_FACTORY_ADDRESS } from "./config.js";

config();

const DEFAULT_GAS_AMOUNT = 20_000_000; // 20 BLD
const DEFAULT_FACTORY_FACTORY_ADDRESS = (process.env.FACTORY_FACTORY_ADDRESS ||
  FACTORY_FACTORY_ADDRESS.Arbitrum) as `0x${string}`;

const printUsage = () => {
  console.log(`
Usage: yarn create-ownable-factory [options]

This script creates a new Ownable Factory on Arbitrum Sepolia by sending
a GMP message from Agoric to the FactoryFactory contract.

Options:
  --factory-factory-address <address>  FactoryFactory contract address (default: ${DEFAULT_FACTORY_FACTORY_ADDRESS})
  --gas-amount <amount>                Gas amount in ubld (default: ${DEFAULT_GAS_AMOUNT})
  --help                               Show this help message

Example:
  yarn create-ownable-factory
  yarn create-ownable-factory -- --gas-amount 25000000
  yarn create-ownable-factory -- --factory-factory-address 0x123...abc
`);
};

const parseArgs = () => {
  const args = process.argv.slice(2);

  const options = {
    factoryFactoryAddress: DEFAULT_FACTORY_FACTORY_ADDRESS,
    gasAmount: DEFAULT_GAS_AMOUNT,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case "--factory-factory-address":
        if (nextArg) options.factoryFactoryAddress = nextArg as `0x${string}`;
        i++;
        break;
      case "--gas-amount":
        if (nextArg) options.gasAmount = parseInt(nextArg);
        i++;
        break;
      case "--help":
        printUsage();
        process.exit(0);
    }
  }

  return options;
};

const main = async () => {
  try {
    const options = parseArgs();

    if (process.argv.includes("--help")) {
      printUsage();
      process.exit(0);
    }

    console.log("Creating Ownable Factory on Arbitrum Sepolia...");
    console.log("Options:", options);

    await createOwnableFactory({
      factoryFactoryAddress: options.factoryFactoryAddress,
      destinationEVMChain: "Arbitrum",
      gasAmount: options.gasAmount,
    });

    console.log("✅ GMP message sent successfully!");
    console.log(
      "The FactoryFactory contract will create a new Factory owned by your Agoric address.",
    );
    console.log(
      "Monitor the transaction on Arbitrum Sepolia: https://sepolia.arbiscan.io/address/" +
        options.factoryFactoryAddress,
    );
  } catch (error) {
    console.error("❌ Error during execution:", error);
    process.exit(1);
  }
};

main();

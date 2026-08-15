#!/usr/bin/env vite-node

import { spawn } from "child_process";
import * as path from "path";
import { config } from "dotenv";
import {
  ChainConfig,
  MAINNET_CHAINS,
  TESTNET_CHAINS,
  CHAIN_ALIASES,
} from "./chain-config.js";

config();

const { REMOTE_ACCOUNT_FACTORY } = process.env;

const resolveChain = (
  alias: string,
  isTestnet: boolean,
): ChainConfig | undefined => {
  const chains = isTestnet ? TESTNET_CHAINS : MAINNET_CHAINS;
  const normalized = CHAIN_ALIASES[alias.toLowerCase()] ?? alias.toLowerCase();
  return chains.find((c) => c.name.toLowerCase() === normalized);
};

type ContractType =
  | "factory"
  | "depositFactory"
  | "remoteAccountFactory"
  | "portfolioRouter";

/**
 * Build constructor args for `hardhat verify` based on contract type and chain config.
 * Mirrors the env vars set by deploy.sh + ignition modules.
 */
const getConstructorArgs = (
  contractType: ContractType,
  chain: ChainConfig,
): string[] => {
  switch (contractType) {
    case "factory":
      // Factory(gateway, gasService)
      return [chain.gateway, chain.gasService];

    case "depositFactory":
      // DepositFactory(gateway, gasService, permit2, factory, owner)
      // owner is set per-deployment, must be passed via env or arg
      throw new Error(
        "depositFactory verification requires FACTORY and owner address — use manual args",
      );

    case "remoteAccountFactory":
      // RemoteAccountFactory(principalCaip2, principalAccount, implementationAddress, vettingAuthority)
      // These are all deployment-specific — use manual args
      throw new Error(
        "remoteAccountFactory verification requires deployment-specific args — use manual args",
      );

    case "portfolioRouter":
      // RemoteAccountAxelarRouter(gateway, axelarSourceChain, factory, permit2)
      if (!REMOTE_ACCOUNT_FACTORY) {
        throw new Error(
          "REMOTE_ACCOUNT_FACTORY env var required for portfolioRouter verification",
        );
      }
      return [chain.gateway, "agoric", REMOTE_ACCOUNT_FACTORY, chain.permit2];

    default:
      throw new Error(`Unknown contract type: ${contractType}`);
  }
};

const runHardhat = (args: string[], cwd: string): Promise<number> =>
  new Promise((resolve) => {
    const child = spawn("npx", ["hardhat", ...args], {
      cwd,
      stdio: "inherit",
    });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", (error) => {
      console.error(`Failed to run hardhat: ${error.message}`);
      resolve(1);
    });
  });

const main = async () => {
  const args = process.argv.slice(2);

  if (args.length < 3) {
    console.error(`
Usage: vite-node verify-contract.ts <chain> <contract-type> <contract-address> [--testnet]

Verifies a deployed contract on a block explorer using \`hardhat verify\`.
Constructor args are resolved automatically from chain config and env vars.

Arguments:
  chain             - Target chain (e.g., base, eth, arb, opt, avax)
  contract-type     - Contract type: factory, portfolioRouter
  contract-address  - The deployed contract address
  --testnet         - Use testnet chain config

Environment Variables:
  REMOTE_ACCOUNT_FACTORY  - Required for portfolioRouter

Examples:
  # Verify RemoteAccountAxelarRouter on Base
  REMOTE_ACCOUNT_FACTORY=0x3B46...23A6 yarn verify-contract base portfolioRouter 0x2cB3...dA2c

  # Verify Factory on Eth Sepolia
  yarn verify-contract eth-sepolia factory 0x1234...abcd --testnet
`);
    process.exit(1);
  }

  const chainAlias = args[0];
  const contractType = args[1] as ContractType;
  const contractAddress = args[2];
  const isTestnet = args.includes("--testnet");

  const chainConfig = resolveChain(chainAlias, isTestnet);
  if (!chainConfig) {
    console.error(`Error: Unknown chain "${chainAlias}"`);
    process.exit(1);
  }

  const constructorArgs = getConstructorArgs(contractType, chainConfig);

  const cosmosDir = path.resolve(
    __dirname,
    "../packages/axelar-local-dev-cosmos",
  );

  console.log(`\n🔍 Verifying ${contractType} on ${chainConfig.name}...`);
  console.log(`   Address: ${contractAddress}`);
  console.log(`   Constructor args: ${constructorArgs.join(" ")}`);
  console.log();

  const hardhatArgs = [
    "verify",
    "--network",
    chainConfig.hardhatNetwork,
    contractAddress,
    ...constructorArgs,
  ];

  const exitCode = await runHardhat(hardhatArgs, cosmosDir);

  if (exitCode === 0) {
    console.log(`\n✅ Verification succeeded on ${chainConfig.name}\n`);
  } else {
    console.error(
      `\n❌ Verification failed on ${chainConfig.name} (exit code: ${exitCode})\n`,
    );
    process.exit(exitCode);
  }
};

main().catch((error) => {
  console.error("\n❌ Error:", error.message || error);
  process.exit(1);
});

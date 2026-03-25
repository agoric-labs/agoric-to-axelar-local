#!/usr/bin/env vite-node

import { ethers } from "ethers";
import { config } from "dotenv";
import {
  MAINNET_CHAINS,
  TESTNET_CHAINS,
  CHAIN_ALIASES,
} from "./chain-config.js";

config();

const { PRIVATE_KEY } = process.env;

const FACTORY_ABI = [
  "function vetInitialRouter(address router) external",
  "function vetRouter(address router) external",
  "function getRouterStatus(address router) external view returns (uint8)",
  "function numberOfAuthorizedRouters() external view returns (uint256)",
  "function vettingAuthority() external view returns (address)",
];

const ROUTER_STATUS = ["Unknown", "Vetted", "Authorized"] as const;

const resolveChain = (alias: string, isTestnet: boolean) => {
  const chains = isTestnet ? TESTNET_CHAINS : MAINNET_CHAINS;
  const normalized = CHAIN_ALIASES[alias.toLowerCase()] ?? alias.toLowerCase();
  return chains.find((c) => c.name.toLowerCase() === normalized);
};

const main = async () => {
  const args = process.argv.slice(2);

  if (args.length < 3) {
    console.error(`
Usage: vite-node vet-router.ts <chain> <factory-address> <router-address> [--testnet]

Examples:
  vite-node vet-router.ts base 0x3B46...23A6 0x2cB3...dA2c
  vite-node vet-router.ts base-sepolia 0x3B46...23A6 0x2cB3...dA2c --testnet
`);
    process.exit(1);
  }

  if (!PRIVATE_KEY) {
    console.error("Error: PRIVATE_KEY environment variable not set");
    process.exit(1);
  }

  const chainAlias = args[0];
  const factoryAddress = args[1];
  const routerAddress = args[2];
  const isTestnet = args.includes("--testnet");

  const chainConfig = resolveChain(chainAlias, isTestnet);
  if (!chainConfig) {
    console.error(`Error: Unknown chain "${chainAlias}"`);
    process.exit(1);
  }

  if (!ethers.isAddress(factoryAddress) || !ethers.isAddress(routerAddress)) {
    console.error("Error: Invalid address provided");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, wallet);

  console.log(`\n🔍 Checking router status on ${chainConfig.name}...\n`);

  const [status, numberOfRouters, vettingAuthority] = await Promise.all([
    factory.getRouterStatus(routerAddress),
    factory.numberOfAuthorizedRouters(),
    factory.vettingAuthority(),
  ]);

  const statusName = ROUTER_STATUS[Number(status)] ?? `Unknown(${status})`;

  console.log(`  Router:             ${routerAddress}`);
  console.log(`  Factory:            ${factoryAddress}`);
  console.log(`  Status:             ${statusName}`);
  console.log(`  Authorized Routers: ${numberOfRouters}`);
  console.log(`  Vetting Authority:  ${vettingAuthority}`);
  console.log(`  Wallet:             ${wallet.address}`);

  if (vettingAuthority !== wallet.address) {
    console.error("\n❌ Wallet is not the vetting authority. Cannot vet.");
    process.exit(1);
  }

  if (status !== 0n) {
    console.log(
      `\n✅ Router already has status "${statusName}", no action needed.`,
    );
    process.exit(0);
  }

  if (numberOfRouters > 0n) {
    console.log(
      "\n⚠️  Other routers already authorized. Using vetRouter (two-factor flow).",
    );
    console.log("   Submitting vetRouter transaction...");
    const tx = await factory.vetRouter(routerAddress);
    const receipt = await tx.wait();
    console.log(
      `\n✅ vetRouter tx: ${receipt.hash} (status: ${receipt.status})`,
    );
    console.log(
      "   Router is now Vetted. It must be authorized through an existing router.",
    );
  } else {
    console.log("\n🚀 Submitting vetInitialRouter transaction...");
    const tx = await factory.vetInitialRouter(routerAddress);
    const receipt = await tx.wait();
    console.log(
      `\n✅ vetInitialRouter tx: ${receipt.hash} (status: ${receipt.status})`,
    );
  }

  // Verify final state
  const finalStatus = await factory.getRouterStatus(routerAddress);
  console.log(
    `   Final router status: ${ROUTER_STATUS[Number(finalStatus)] ?? finalStatus}\n`,
  );
};

main().catch((error) => {
  console.error("\n❌ Error:", error.message || error);
  process.exit(1);
});

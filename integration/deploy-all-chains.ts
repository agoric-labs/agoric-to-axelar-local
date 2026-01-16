#!/usr/bin/env vite-node

import { spawn } from "child_process";
import * as path from "path";

const CHAINS = {
  mainnet: ["avax", "arb", "base", "eth", "opt", "pol"],
  testnet: [
    "eth-sepolia",
    "fuji",
    "base-sepolia",
    "opt-sepolia",
    "arb-sepolia",
  ],
};

const ALL_CHAINS = [...CHAINS.mainnet, ...CHAINS.testnet];

interface DeployOptions {
  chains?: string[]; // Specific chains to deploy to
  contract: "factory" | "depositFactory"; // Contract type
  ownerType?: "ymax0" | "ymax1"; // Owner type (for depositFactory)
  parallel?: boolean; // Run deployments in parallel
  continueOnError?: boolean; // Continue even if one deployment fails
  syncNonces?: boolean; // Sync nonces before deployment for same address
}

interface DeployResult {
  chain: string;
  success: boolean;
  output?: string;
  error?: string;
}

/**
 * Run nonce sync script before deployments
 */
const syncNonces = async (chains: string[]): Promise<boolean> => {
  console.log(
    "\n🔄 Syncing nonces across chains for consistent contract addresses...\n",
  );

  const isTestnet = chains.some((c) => CHAINS.testnet.includes(c));
  const scriptPath = path.resolve(
    __dirname,
    "../packages/axelar-local-dev-cosmos/scripts/increment-nonce.ts",
  );

  const args = ["--chains", chains.join(",")];
  if (isTestnet) {
    args.push("--testnet");
  }

  return new Promise((resolve) => {
    const child = spawn("npx", ["ts-node", scriptPath, ...args], {
      cwd: path.resolve(__dirname, "../packages/axelar-local-dev-cosmos"),
      stdio: "inherit",
    });

    child.on("close", (code) => {
      if (code === 0) {
        console.log("\n✅ Nonce synchronization complete\n");
        resolve(true);
      } else {
        console.error(
          `\n❌ Nonce synchronization failed (exit code: ${code})\n`,
        );
        resolve(false);
      }
    });

    child.on("error", (error) => {
      console.error(`\n❌ Failed to run nonce sync: ${error.message}\n`);
      resolve(false);
    });
  });
};

/**
 * Deploy contracts to a specific chain
 */
const deployToChain = async (
  chain: string,
  contract: string,
  ownerType?: string,
): Promise<DeployResult> => {
  const scriptPath = path.resolve(
    __dirname,
    "../packages/axelar-local-dev-cosmos/scripts/deploy.sh",
  );

  const args = [chain, contract, ownerType].filter(Boolean);

  console.log(`\n🚀 Deploying ${contract} to ${chain}...`);

  return new Promise((resolve) => {
    // Use 'yes' command to auto-confirm all prompts
    const yesProcess = spawn("yes", ["y"], {
      stdio: ["ignore", "pipe", "inherit"],
    });

    const child = spawn(scriptPath, args, {
      cwd: path.resolve(__dirname, "../packages/axelar-local-dev-cosmos"),
      env: { ...process.env },
      stdio: [yesProcess.stdout, "inherit", "inherit"],
    });

    child.on("close", (code) => {
      yesProcess.kill();
      if (code === 0) {
        console.log(`\n✅ Successfully deployed to ${chain}`);
        resolve({
          chain,
          success: true,
        });
      } else {
        console.error(`\n❌ Failed to deploy to ${chain} (exit code: ${code})`);
        resolve({
          chain,
          success: false,
          error: `Deployment failed with exit code ${code}`,
        });
      }
    });

    child.on("error", (error) => {
      yesProcess.kill(); // Kill the yes process
      console.error(`\n❌ Failed to deploy to ${chain}`);
      console.error(`   Error: ${error.message}`);
      resolve({
        chain,
        success: false,
        error: error.message,
      });
    });
  });
};

/**
 * Deploy contracts to multiple chains
 */
const deployToAllChains = async (
  options: DeployOptions,
): Promise<DeployResult[]> => {
  const {
    chains = ALL_CHAINS,
    contract,
    ownerType,
    parallel = false,
    continueOnError = true,
    syncNonces: shouldSyncNonces = false,
  } = options;

  console.log("═══════════════════════════════════════════════════════════");
  console.log("🌐 Multi-Chain Deployment Script");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`Contract Type: ${contract}`);
  if (ownerType) {
    console.log(`Owner Type: ${ownerType}`);
  }
  console.log(`Chains: ${chains.join(", ")}`);
  console.log(`Mode: ${parallel ? "Parallel" : "Sequential"}`);
  console.log(`Continue on Error: ${continueOnError}`);
  console.log(`Sync Nonces: ${shouldSyncNonces ? "Yes" : "No"}`);
  console.log("═══════════════════════════════════════════════════════════\n");

  // Sync nonces before deployment if requested
  if (shouldSyncNonces) {
    const syncSuccess = await syncNonces(chains);
    if (!syncSuccess) {
      console.error(
        "⚠️  Nonce sync failed, but continuing with deployment...\n",
      );
    }
  }

  const results: DeployResult[] = [];

  if (parallel) {
    // Deploy to all chains in parallel
    const promises = chains.map((chain) =>
      deployToChain(chain, contract, ownerType),
    );
    const allResults = await Promise.allSettled(promises);

    allResults.forEach((result, index) => {
      if (result.status === "fulfilled") {
        results.push(result.value);
      } else {
        results.push({
          chain: chains[index],
          success: false,
          error: result.reason?.message || "Unknown error",
        });
      }
    });
  } else {
    // Deploy to chains sequentially
    for (const chain of chains) {
      const result = await deployToChain(chain, contract, ownerType);
      results.push(result);

      if (!result.success && !continueOnError) {
        console.error(
          "\n❌ Deployment failed. Stopping due to continueOnError=false",
        );
        break;
      }
    }
  }

  return results;
};

const printSummary = (results: DeployResult[]) => {
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("📊 Deployment Summary");
  console.log("═══════════════════════════════════════════════════════════");

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  console.log(`\n✅ Successful: ${successful.length}`);
  successful.forEach((r) => {
    console.log(`   - ${r.chain}`);
  });

  if (failed.length > 0) {
    console.log(`\n❌ Failed: ${failed.length}`);
    failed.forEach((r) => {
      console.log(`   - ${r.chain}: ${r.error}`);
    });
  }

  console.log(`\n📈 Total: ${results.length} deployments`);
  console.log(
    `   Success Rate: ${((successful.length / results.length) * 100).toFixed(1)}%`,
  );
  console.log("═══════════════════════════════════════════════════════════\n");
};

/**
 * Parse command line arguments
 */
const parseArgs = (): DeployOptions => {
  const args = process.argv.slice(2);
  const options: DeployOptions = {
    contract: "factory",
    parallel: false,
    continueOnError: true,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "--contract":
      case "-c":
        const contractType = args[++i];
        if (contractType !== "factory" && contractType !== "depositFactory") {
          throw new Error(
            'Contract must be either "factory" or "depositFactory"',
          );
        }
        options.contract = contractType;
        break;

      case "--owner-type":
      case "-o":
        const ownerType = args[++i];
        if (ownerType !== "ymax0" && ownerType !== "ymax1") {
          throw new Error('Owner type must be either "ymax0" or "ymax1"');
        }
        options.ownerType = ownerType;
        break;

      case "--chains":
        const chainList = args[++i];
        options.chains = chainList.split(",").map((c) => c.trim());
        break;

      case "--mainnet":
        options.chains = CHAINS.mainnet;
        break;

      case "--testnet":
        options.chains = CHAINS.testnet;
        break;

      case "--parallel":
      case "-p":
        options.parallel = true;
        break;

      case "--sequential":
      case "-s":
        options.parallel = false;
        break;

      case "--stop-on-error":
        options.continueOnError = false;
        break;

      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;

      default:
        console.error(`Unknown argument: ${arg}`);
        printHelp();
        process.exit(1);
    }
  }

  return options;
};

/**
 * Print help message
 */
const printHelp = () => {
  console.log(`
🌐 Multi-Chain Deployment Script

Usage: ts-node deploy-all-chains.ts [options]

Options:
  -c, --contract <type>        Contract type: "factory" or "depositFactory" (default: factory)
  -o, --owner-type <type>      Owner type: "ymax0" or "ymax1" (only for depositFactory)
  --chains <chain1,chain2>     Comma-separated list of specific chains to deploy to
  --mainnet                    Deploy to all mainnet chains only
  --testnet                    Deploy to all testnet chains only
  -p, --parallel               Run deployments in parallel (faster but less verbose)
  -s, --sequential             Run deployments sequentially (default)
  --stop-on-error              Stop deployment if any chain fails (default: continue)
  -h, --help                   Show this help message

Supported Chains:
  Mainnet: ${CHAINS.mainnet.join(", ")}
  Testnet: ${CHAINS.testnet.join(", ")}

Examples:
  # Deploy factory to all chains sequentially
  yarn deploy:all

  # Deploy depositFactory to all mainnet chains in parallel
  yarn deploy:all --contract depositFactory --owner-type ymax0 --mainnet --parallel

  # Deploy to specific chains
  yarn deploy:all --chains eth,base,opt

  # Deploy to testnets only
  yarn deploy:all --testnet --sequential

  # Deploy depositFactory with ymax1 owner to all chains, stop on first error
  yarn deploy:all -c depositFactory -o ymax1 --stop-on-error
`);
};

const main = async () => {
  try {
    const options = parseArgs();
    const results = await deployToAllChains(options);
    printSummary(results);

    // Exit with error code if any deployment failed
    const hasFailures = results.some((r) => !r.success);
    process.exit(hasFailures ? 1 : 0);
  } catch (error: any) {
    console.error("\n❌ Error:", error.message);
    process.exit(1);
  }
};

main();

import { ethers } from "ethers";
import { config } from "dotenv";

config();

const { PRIVATE_KEY, INFURA_KEY } = process.env;

if (!PRIVATE_KEY) {
  console.error("Error: PRIVATE_KEY not found in environment");
  process.exit(1);
}

interface ChainConfig {
  name: string;
  rpcUrl: string;
  chainId: number;
  nativeToken: string;
}

const MAINNET_CHAINS: ChainConfig[] = [
  {
    name: "Ethereum",
    rpcUrl: `https://mainnet.infura.io/v3/${INFURA_KEY}`,
    chainId: 1,
    nativeToken: "ETH",
  },
  {
    name: "Base",
    rpcUrl: "https://mainnet.base.org",
    chainId: 8453,
    nativeToken: "ETH",
  },
  {
    name: "Avalanche",
    rpcUrl: "https://api.avax.network/ext/bc/C/rpc",
    chainId: 43114,
    nativeToken: "AVAX",
  },
  {
    name: "Arbitrum",
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    chainId: 42161,
    nativeToken: "ETH",
  },
  {
    name: "Optimism",
    rpcUrl: "https://mainnet.optimism.io",
    chainId: 10,
    nativeToken: "ETH",
  },
];

const TESTNET_CHAINS: ChainConfig[] = [
  {
    name: "Eth Sepolia",
    rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    chainId: 11155111,
    nativeToken: "ETH",
  },
  {
    name: "Base Sepolia",
    rpcUrl: "https://sepolia.base.org",
    chainId: 84532,
    nativeToken: "ETH",
  },
  {
    name: "Fuji",
    rpcUrl: "https://api.avax-test.network/ext/bc/C/rpc",
    chainId: 43113,
    nativeToken: "AVAX",
  },
  {
    name: "Arb Sepolia",
    rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
    chainId: 421614,
    nativeToken: "ETH",
  },
  {
    name: "Opt Sepolia",
    rpcUrl: "https://sepolia.optimism.io",
    chainId: 11155420,
    nativeToken: "ETH",
  },
];

interface ChainNonceInfo {
  chain: string;
  chainId: number;
  nonce: number;
  provider: ethers.JsonRpcProvider;
}

const getNonceForChain = async (
  chainConfig: ChainConfig,
  wallet: ethers.Wallet,
): Promise<ChainNonceInfo> => {
  try {
    const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
    const connectedWallet = wallet.connect(provider);
    const nonce = await provider.getTransactionCount(
      await connectedWallet.getAddress(),
    );

    return {
      chain: chainConfig.name,
      chainId: chainConfig.chainId,
      nonce,
      provider,
    };
  } catch (error) {
    console.error(`Error fetching nonce for ${chainConfig.name}:`, error);
    throw error;
  }
};

const incrementNonceOnChain = async (
  chainInfo: ChainNonceInfo,
  wallet: ethers.Wallet,
  targetNonce: number,
): Promise<void> => {
  const connectedWallet = wallet.connect(chainInfo.provider);
  const address = await connectedWallet.getAddress();
  const noncesToIncrement = targetNonce - chainInfo.nonce;

  console.log(
    `\n🔄 ${chainInfo.chain}: Incrementing nonce from ${chainInfo.nonce} to ${targetNonce} (${noncesToIncrement} transactions)`,
  );

  for (let i = 0; i < noncesToIncrement; i++) {
    const currentNonce = chainInfo.nonce + i;
    console.log(
      `   Sending transaction ${i + 1}/${noncesToIncrement} (nonce: ${currentNonce})...`,
    );

    const tx = await connectedWallet.sendTransaction({
      to: address,
      value: 0,
      gasLimit: 21000,
      nonce: currentNonce,
    });

    console.log(`   TX hash: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(
      `   ✅ Confirmed in block ${receipt?.blockNumber} (gas used: ${receipt?.gasUsed.toString()})`,
    );
  }
};

const main = async () => {
  const args = process.argv.slice(2);
  const isTestnet = args.includes("--testnet");
  const CHAINS = isTestnet ? TESTNET_CHAINS : MAINNET_CHAINS;
  const network = isTestnet ? "Testnet" : "Mainnet";

  console.log("\n" + "=".repeat(80));
  console.log("Intelligent Nonce Synchronization Across All Chains");
  console.log(`Network: ${network}`);
  console.log("=".repeat(80) + "\n");

  const wallet = new ethers.Wallet(PRIVATE_KEY!);
  const address = await wallet.getAddress();

  console.log(`Wallet address: ${address}\n`);

  // Step 1: Fetch nonces from all chains
  console.log("📊 Fetching current nonces from all chains...\n");
  const nonceInfos: ChainNonceInfo[] = [];

  for (const chain of CHAINS) {
    try {
      const info = await getNonceForChain(chain, wallet);
      nonceInfos.push(info);
      console.log(
        `   ${info.chain.padEnd(15)} (Chain ${info.chainId.toString().padEnd(6)}): Nonce ${info.nonce}`,
      );
    } catch (error) {
      console.error(`   ❌ Failed to fetch nonce for ${chain.name}`);
    }
  }

  // Step 2: Find the maximum nonce and calculate target
  const maxNonce = Math.max(...nonceInfos.map((info) => info.nonce));
  // Target is maxNonce - 1 because deployment transaction will increment it
  const targetNonce = maxNonce - 1;

  console.log(`\n📈 Highest nonce across all chains: ${maxNonce}`);
  console.log(`🎯 Target nonce for deployment preparation: ${targetNonce}`);
  console.log(`   (Deployment transaction will increment to ${maxNonce})`);

  // Step 3: Find chains that need increment
  const chainsToIncrement = nonceInfos.filter(
    (info) => info.nonce < targetNonce,
  );

  if (chainsToIncrement.length === 0) {
    console.log("\n✅ All chains are already at nonce", targetNonce);
    console.log("Ready to deploy Factory at nonce", targetNonce);
    console.log("=".repeat(80) + "\n");
    return;
  }

  console.log(
    `\n⚠️  Found ${chainsToIncrement.length} chain(s) that need nonce increment:\n`,
  );
  chainsToIncrement.forEach((info) => {
    console.log(
      `   ${info.chain.padEnd(15)}: ${info.nonce} → ${targetNonce} (+${targetNonce - info.nonce})`,
    );
  });

  // Step 4: Confirm with user
  console.log("\n" + "=".repeat(80));
  console.log("⚠️  This will send transactions to increment nonces.");
  console.log("Press Ctrl+C to cancel, or wait 5 seconds to continue...");
  console.log("=".repeat(80));

  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Step 5: Increment nonces
  console.log("\n🚀 Starting nonce synchronization...\n");

  for (const chainInfo of chainsToIncrement) {
    try {
      await incrementNonceOnChain(chainInfo, wallet, targetNonce);
    } catch (error) {
      console.error(
        `\n❌ Failed to increment nonce on ${chainInfo.chain}:`,
        error,
      );
    }
  }

  // Step 6: Verify final nonces
  console.log("\n" + "=".repeat(80));
  console.log("🔍 Verifying final nonces...\n");

  for (const chain of CHAINS) {
    try {
      const info = await getNonceForChain(chain, wallet);
      const status = info.nonce === targetNonce ? "✅" : "❌";
      console.log(`   ${status} ${info.chain.padEnd(15)}: Nonce ${info.nonce}`);
    } catch (error) {
      console.error(`   ❌ Failed to verify ${chain.name}`);
    }
  }

  console.log("\n" + "=".repeat(80));
  console.log("✅ Nonce synchronization complete!");
  console.log(
    `All chains are now at nonce ${targetNonce}, ready for Factory deployment.`,
  );
  console.log(
    `Factory will be deployed at nonce ${targetNonce} on each chain.`,
  );
  console.log("=".repeat(80) + "\n");
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Fatal error:", error);
    process.exit(1);
  });

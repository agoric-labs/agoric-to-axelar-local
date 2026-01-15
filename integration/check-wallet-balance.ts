import { ethers } from "ethers";

interface ChainConfig {
  name: string;
  rpcUrl: string;
  chainId: number;
  nativeToken: string;
}

const MAINNET_CHAINS: ChainConfig[] = [
  {
    name: "Ethereum",
    rpcUrl: "https://eth.llamarpc.com",
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

const checkWalletBalance = async (
  address: string,
  chainConfig: ChainConfig,
) => {
  try {
    const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);

    const balance = await provider.getBalance(address);
    const nonce = await provider.getTransactionCount(address);

    const balanceInEther = ethers.formatEther(balance);

    return {
      chain: chainConfig.name,
      chainId: chainConfig.chainId,
      balance: balanceInEther,
      nonce,
      nativeToken: chainConfig.nativeToken,
      success: true,
    };
  } catch (error) {
    return {
      chain: chainConfig.name,
      chainId: chainConfig.chainId,
      error: error instanceof Error ? error.message : "Unknown error",
      success: false,
    };
  }
};

const main = async () => {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error(
      "Usage: vite-node check-wallet-balance.ts <wallet-address> [--testnet]",
    );
    console.error(
      "Example: vite-node check-wallet-balance.ts 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
    );
    console.error(
      "Example: vite-node check-wallet-balance.ts 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb --testnet",
    );
    process.exit(1);
  }

  const walletAddress = args[0];
  const isTestnet = args.includes("--testnet");
  const CHAINS = isTestnet ? TESTNET_CHAINS : MAINNET_CHAINS;
  const network = isTestnet ? "Testnet" : "Mainnet";

  if (!ethers.isAddress(walletAddress)) {
    console.error("Error: Invalid Ethereum address");
    process.exit(1);
  }

  console.log(`\n🔍 Checking wallet balance for: ${walletAddress}`);
  console.log(`Network: ${network}\n`);
  console.log("=".repeat(80));

  const results = await Promise.all(
    CHAINS.map((chain) => checkWalletBalance(walletAddress, chain)),
  );

  results.forEach((result) => {
    console.log(`\n📊 ${result.chain} (Chain ID: ${result.chainId})`);
    console.log("-".repeat(80));

    if (result.success) {
      console.log(`   Balance: ${result.balance} ${result.nativeToken}`);
      console.log(`   Nonce:   ${result.nonce}`);
    } else {
      console.log(`   ❌ Error: ${result.error}`);
    }
  });

  console.log("\n" + "=".repeat(80) + "\n");
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });

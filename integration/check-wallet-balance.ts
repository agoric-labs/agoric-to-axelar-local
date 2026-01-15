import { ethers } from "ethers";

interface ChainConfig {
  name: string;
  rpcUrl: string;
  chainId: number;
  nativeToken: string;
}

const CHAINS: ChainConfig[] = [
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
    console.error("Usage: ts-node check-wallet-balance.ts <wallet-address>");
    console.error(
      "Example: ts-node check-wallet-balance.ts 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
    );
    process.exit(1);
  }

  const walletAddress = args[0];

  if (!ethers.isAddress(walletAddress)) {
    console.error("Error: Invalid Ethereum address");
    process.exit(1);
  }

  console.log(`\n🔍 Checking wallet balance for: ${walletAddress}\n`);
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

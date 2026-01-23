import { config } from "dotenv";

config();

const { INFURA_KEY } = process.env;

export interface ChainConfig {
  name: string;
  rpcUrl: string;
  chainId: number;
  nativeToken: string;
}

export const MAINNET_CHAINS: ChainConfig[] = [
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

export const TESTNET_CHAINS: ChainConfig[] = [
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

// Chain name aliases matching network-config.sh
export const CHAIN_ALIASES: Record<string, string> = {
  eth: "ethereum",
  avax: "avalanche",
  arb: "arbitrum",
  opt: "optimism",
  base: "base",
  "eth-sepolia": "eth sepolia",
  fuji: "fuji",
  "base-sepolia": "base sepolia",
  "arb-sepolia": "arb sepolia",
  "opt-sepolia": "opt sepolia",
};

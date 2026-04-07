import { config } from "dotenv";

config();

const { INFURA_KEY } = process.env;

export interface ChainConfig {
  name: string;
  rpcUrl: string;
  chainId: number;
  nativeToken: string;
  /** Axelar Gateway contract address */
  gateway: string;
  /** Axelar Gas Service contract address */
  gasService: string;
  /** Uniswap Permit2 contract address */
  permit2: string;
  /** Hardhat network name (used for --network flag) */
  hardhatNetwork: string;
}

// Sources:
// Axelar mainnet: https://docs.axelar.dev/dev/reference/mainnet-contract-addresses/
// Axelar testnet: https://docs.axelar.dev/dev/reference/testnet-contract-addresses/
// Permit2: https://docs.uniswap.org/contracts/v4/deployments

export const MAINNET_CHAINS: ChainConfig[] = [
  {
    name: "Ethereum",
    rpcUrl: `https://mainnet.infura.io/v3/${INFURA_KEY}`,
    chainId: 1,
    nativeToken: "ETH",
    gateway: "0x4F4495243837681061C4743b74B3eEdf548D56A5",
    gasService: "0x2d5d7d31F671F86C782533cc367F14109a082712",
    permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    hardhatNetwork: "eth",
  },
  {
    name: "Base",
    rpcUrl: "https://mainnet.base.org",
    chainId: 8453,
    nativeToken: "ETH",
    gateway: "0xe432150cce91c13a887f7D836923d5597adD8E31",
    gasService: "0x2d5d7d31F671F86C782533cc367F14109a082712",
    permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    hardhatNetwork: "base",
  },
  {
    name: "Avalanche",
    rpcUrl: "https://api.avax.network/ext/bc/C/rpc",
    chainId: 43114,
    nativeToken: "AVAX",
    gateway: "0x5029C0EFf6C34351a0CEc334542cDb22c7928f78",
    gasService: "0x2d5d7d31F671F86C782533cc367F14109a082712",
    permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    hardhatNetwork: "avax",
  },
  {
    name: "Arbitrum",
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    chainId: 42161,
    nativeToken: "ETH",
    gateway: "0xe432150cce91c13a887f7D836923d5597adD8E31",
    gasService: "0x2d5d7d31F671F86C782533cc367F14109a082712",
    permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    hardhatNetwork: "arb",
  },
  {
    name: "Optimism",
    rpcUrl: "https://mainnet.optimism.io",
    chainId: 10,
    nativeToken: "ETH",
    gateway: "0xe432150cce91c13a887f7D836923d5597adD8E31",
    gasService: "0x2d5d7d31F671F86C782533cc367F14109a082712",
    permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    hardhatNetwork: "opt",
  },
];

export const TESTNET_CHAINS: ChainConfig[] = [
  {
    name: "Eth Sepolia",
    rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    chainId: 11155111,
    nativeToken: "ETH",
    gateway: "0xe432150cce91c13a887f7D836923d5597adD8E31",
    gasService: "0xbE406F0189A0B4cf3A05C286473D23791Dd44Cc6",
    permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    hardhatNetwork: "eth-sepolia",
  },
  {
    name: "Base Sepolia",
    rpcUrl: "https://sepolia.base.org",
    chainId: 84532,
    nativeToken: "ETH",
    gateway: "0xe432150cce91c13a887f7D836923d5597adD8E31",
    gasService: "0xbE406F0189A0B4cf3A05C286473D23791Dd44Cc6",
    permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    hardhatNetwork: "base-sepolia",
  },
  {
    name: "Fuji",
    rpcUrl: "https://api.avax-test.network/ext/bc/C/rpc",
    chainId: 43113,
    nativeToken: "AVAX",
    gateway: "0xC249632c2D40b9001FE907806902f63038B737Ab",
    gasService: "0xbE406F0189A0B4cf3A05C286473D23791Dd44Cc6",
    permit2: "",
    hardhatNetwork: "fuji",
  },
  {
    name: "Arb Sepolia",
    rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
    chainId: 421614,
    nativeToken: "ETH",
    gateway: "0xe1cE95479C84e9809269227C7F8524aE051Ae77a",
    gasService: "0xbE406F0189A0B4cf3A05C286473D23791Dd44Cc6",
    permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    hardhatNetwork: "arb-sepolia",
  },
  {
    name: "Opt Sepolia",
    rpcUrl: "https://sepolia.optimism.io",
    chainId: 11155420,
    nativeToken: "ETH",
    gateway: "0xe432150cce91c13a887f7D836923d5597adD8E31",
    gasService: "0xbE406F0189A0B4cf3A05C286473D23791Dd44Cc6",
    permit2: "",
    hardhatNetwork: "opt-sepolia",
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

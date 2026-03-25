# Contract Deployment Guide

This guide covers deploying `RemoteAccountFactory` and `RemoteAccountAxelarRouter` contracts across multiple EVM chains.

## Overview

| Contract                    | Purpose                                                     | Dependencies         |
| --------------------------- | ----------------------------------------------------------- | -------------------- |
| `RemoteAccountFactory`      | Creates deterministic RemoteAccount contracts using CREATE2 | None                 |
| `RemoteAccountAxelarRouter` | Single Axelar GMP entry point for remote account operations | RemoteAccountFactory |

## Prerequisites

1. **Environment Setup**

    Create a `.env` file in `packages/axelar-local-dev-cosmos/`:

    ```bash
    PRIVATE_KEY=<your-deployer-private-key>
    INFURA_KEY=<infura-api-key>           # Required for Ethereum mainnet
    ETHERSCAN_API_KEY=<etherscan-api-key> # For contract verification
    ```

2. **Funded Wallet**

    Ensure the deployer wallet has native tokens on all target chains.

3. **Install Dependencies**

    ```bash
    npm install
    ```

## Supported Networks

| EVM Chain | Mainnet | Testnet        |
| --------- | ------- | -------------- |
| Arbitrum  | `arb`   | `arb-sepolia`  |
| Avalanche | `avax`  | `fuji`         |
| Base      | `base`  | `base-sepolia` |
| Ethereum  | `eth`   | `eth-sepolia`  |
| Optimism  | `opt`   | `opt-sepolia`  |

## Deployment Order

Deploy contracts in this order due to dependencies:

```
1. RemoteAccountFactory        (no dependencies)
         ↓
2. RemoteAccountAxelarRouter   (requires RemoteAccountFactory address)
                               (automatically transfers factory ownership)
```

## Deploying RemoteAccountFactory

`RemoteAccountFactory` requires principal CAIP2 and account constructor arguments to identify the controlling portfolio contract, as well as the address for a vetting authority

The following environment variables are required:

| Variable            | Required | Description                           |
| ------------------- | -------- | ------------------------------------- |
| `VETTING_AUTHORITY` | Yes      | Address authorized to vet new routers |

### Single Chain

```bash
cd packages/axelar-local-dev-cosmos
VETTING_AUTHORITY=0x... ./scripts/deploy.sh <network> remoteAccountFactory [owner_type]
```

Example:

```bash
# Deploy with ymax0 principal (default)
VETTING_AUTHORITY=0xabcd1234567890abcdef1234567890abcdef5678 \
./scripts/deploy.sh eth-sepolia remoteAccountFactory

# Deploy with ymax1 principal
VETTING_AUTHORITY=0xabcd1234567890abcdef1234567890abcdef5678 \
./scripts/deploy.sh eth-sepolia remoteAccountFactory ymax1
```

### Multi-Chain (from repo root)

```bash
# All testnets
VETTING_AUTHORITY=0x... \
npm run deploy:all -- -c remoteAccountFactory --testnet

# All mainnets
VETTING_AUTHORITY=0x... \
npm run deploy:all -- -c remoteAccountFactory --mainnet

# Specific chains
VETTING_AUTHORITY=0x... \
npm run deploy:all -- -c remoteAccountFactory --chains eth-sepolia,fuji,base-sepolia
```

## Deploying RemoteAccountAxelarRouter

`RemoteAccountAxelarRouter` requires the following environment variables:

| Variable                 | Required | Description                                           |
| ------------------------ | -------- | ----------------------------------------------------- |
| `REMOTE_ACCOUNT_FACTORY` | Yes      | Address of the deployed RemoteAccountFactory contract |

**Note:** If the deployer is the same as the factory vetting authority, the new router is
automatically vetted during deployment (and enabled if the initial router).

### Single Chain

```bash
cd packages/axelar-local-dev-cosmos

REMOTE_ACCOUNT_FACTORY=0x... ./scripts/deploy.sh <network> portfolioRouter
```

Example:

```bash
REMOTE_ACCOUNT_FACTORY=0x1234567890abcdef1234567890abcdef12345678 \
./scripts/deploy.sh eth-sepolia portfolioRouter
```

### Multi-Chain (from repo root)

```bash
# All testnets
REMOTE_ACCOUNT_FACTORY=0x... \
npm run deploy:all -- -c portfolioRouter --testnet

# All mainnets
REMOTE_ACCOUNT_FACTORY=0x... \
npm run deploy:all -- -c portfolioRouter --mainnet

# Specific chains
REMOTE_ACCOUNT_FACTORY=0x... \
npm run deploy:all -- -c portfolioRouter --chains eth-sepolia,fuji
```

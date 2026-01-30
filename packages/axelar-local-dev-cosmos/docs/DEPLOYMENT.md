# Contract Deployment Guide

This guide covers deploying `RemoteAccountFactory` and `PortfolioRouter` contracts across multiple EVM chains.

## Overview

| Contract               | Purpose                                                     | Dependencies                     |
| ---------------------- | ----------------------------------------------------------- | -------------------------------- |
| `RemoteAccountFactory` | Creates deterministic RemoteAccount contracts using CREATE2 | None                             |
| `PortfolioRouter`      | Single Axelar GMP entry point for remote account operations | RemoteAccountFactory, AGORIC_LCA |

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

| Type    | Networks                                                            |
| ------- | ------------------------------------------------------------------- |
| Mainnet | `avax`, `arb`, `base`, `eth`, `opt`                                 |
| Testnet | `eth-sepolia`, `fuji`, `base-sepolia`, `opt-sepolia`, `arb-sepolia` |

## Deployment Order

Deploy contracts in this order due to dependencies:

```
1. RemoteAccountFactory  (no dependencies)
         ↓
2. PortfolioRouter       (requires RemoteAccountFactory address + AGORIC_LCA)
```

## Deploying RemoteAccountFactory

`RemoteAccountFactory` has no constructor arguments and can be deployed directly.

### Single Chain

```bash
cd packages/axelar-local-dev-cosmos
./scripts/deploy.sh <network> remoteAccountFactory
```

Example:

```bash
./scripts/deploy.sh eth-sepolia remoteAccountFactory
```

### Multi-Chain (from repo root)

```bash
# All testnets
npm run deploy:all -- -c remoteAccountFactory --testnet

# All mainnets
npm run deploy:all -- -c remoteAccountFactory --mainnet

# Specific chains
npm run deploy:all -- -c remoteAccountFactory --chains eth-sepolia,fuji,base-sepolia
```

## Deploying PortfolioRouter

`PortfolioRouter` requires the `REMOTE_ACCOUNT_FACTORY` environment variable. The `AGORIC_LCA` is optional and defaults to ymax0/ymax1 addresses based on network and owner type.

| Variable                 | Required | Description                                                    |
| ------------------------ | -------- | -------------------------------------------------------------- |
| `REMOTE_ACCOUNT_FACTORY` | Yes      | Address of the deployed RemoteAccountFactory contract          |
| `AGORIC_LCA`             | No       | Authorized Agoric LCA address (defaults to ymax0/ymax1 values) |

### Default AGORIC_LCA Values

| Network  | Owner Type | AGORIC_LCA                                                           |
| -------- | ---------- | -------------------------------------------------------------------- |
| Mainnet  | ymax0      | `agoric1wl2529tfdlfvure7mw6zteam02prgaz88p0jru4tlzuxdawrdyys6jlmnq`   |
| Mainnet  | ymax1      | `agoric13ecz27mm2ug5kv96jyal2k6z8874mxzs4m4yuet36s4nqdl0ey6qr09p74`   |
| Testnet  | ymax0      | `agoric18ek5td2h397cmejnlndes50k84ywx82kau7aff80t74fcxmjnzqstjclj0`   |
| Testnet  | ymax1      | `agoric1ps63986jnululzkmg7h3nhs5at6vkatcgsjy9ttgztykuaepwpxsrw2sus`   |

### Single Chain

```bash
cd packages/axelar-local-dev-cosmos

# Using default AGORIC_LCA (ymax0)
REMOTE_ACCOUNT_FACTORY=0x... ./scripts/deploy.sh <network> portfolioRouter

# Using ymax1 AGORIC_LCA
REMOTE_ACCOUNT_FACTORY=0x... ./scripts/deploy.sh <network> portfolioRouter ymax1

# Using custom AGORIC_LCA
REMOTE_ACCOUNT_FACTORY=0x... AGORIC_LCA=agoric1custom... ./scripts/deploy.sh <network> portfolioRouter
```

Example:

```bash
# Deploy with default ymax0 AGORIC_LCA
REMOTE_ACCOUNT_FACTORY=0x1234567890abcdef1234567890abcdef12345678 \
./scripts/deploy.sh eth-sepolia portfolioRouter

# Deploy with ymax1 AGORIC_LCA
REMOTE_ACCOUNT_FACTORY=0x1234567890abcdef1234567890abcdef12345678 \
./scripts/deploy.sh eth-sepolia portfolioRouter ymax1
```

### Multi-Chain (from repo root)

```bash
# All testnets with default ymax0 AGORIC_LCA
REMOTE_ACCOUNT_FACTORY=0x... npm run deploy:all -- -c portfolioRouter --testnet

# All testnets with ymax1 AGORIC_LCA
REMOTE_ACCOUNT_FACTORY=0x... npm run deploy:all -- -c portfolioRouter -o ymax1 --testnet

# All mainnets with default ymax0 AGORIC_LCA
REMOTE_ACCOUNT_FACTORY=0x... npm run deploy:all -- -c portfolioRouter --mainnet

# Specific chains with custom AGORIC_LCA
REMOTE_ACCOUNT_FACTORY=0x... AGORIC_LCA=agoric1custom... \
npm run deploy:all -- -c portfolioRouter --chains eth-sepolia,fuji
```

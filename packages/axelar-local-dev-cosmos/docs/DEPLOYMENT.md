# Contract Deployment Guide

This guide covers deploying `RemoteAccount`, `RemoteAccountFactory` and `RemoteAccountAxelarRouter` contracts across multiple EVM chains.

## Overview

| Contract                    | Purpose                                                     | Deploy Method   | Dependencies         |
| --------------------------- | ----------------------------------------------------------- | --------------- | -------------------- |
| `RemoteAccount` (impl)      | Minimal-clone implementation for remote accounts            | CreateX CREATE2 | None                 |
| `RemoteAccountFactory`      | Creates deterministic RemoteAccount contracts using CREATE2 | CreateX CREATE3 | RemoteAccount (impl) |
| `RemoteAccountAxelarRouter` | Single Axelar GMP entry point for remote account operations | CreateX CREATE3 | RemoteAccountFactory |

## Deployment Methods

All contracts are deployed via the [CreateX](https://github.com/pcaversaccio/createx) deployer, which is available at a canonical address on all supported chains. Using a deployer contract enables more reliable and retryable cross-chain deployments.

### ⚠️ Validation of contracts post-deploy

While the deployment method and script ensure that the bytecode deployed at the address matches, in the case of Create3 it cannot guarantee that the constructor arguments of a previously deployed contract match. The deployer should manually verify the state of the on-chain contract before using it.

### RemoteAccount (implementation) — CREATE2

The implementation contract is stateless and has no constructor arguments, so its bytecode is identical across chains. **CREATE2** produces a deterministic address from `keccak256(deployer, salt, initCodeHash)`, which naturally yields the same address on every chain without requiring a specific deployer key. The salt is unpermissioned and derived from the principal account identifier.

### RemoteAccountFactory — CREATE3

The factory accepts requires constructor arguments (principal identifiers, implementation address, vetting authority). Because CREATE2 addresses depend on init code (bytecode + constructor args), any change to these arguments — such as a different vetting authority smart account address — would produce a different factory address. This would break the cross-chain address consistency that remote accounts depend on.

**CREATE3** addresses depend only on the deployer address and salt, not on bytecode or constructor arguments. This guarantees the factory lands at the same address on every chain, including chains added after the initial deployment, regardless of whether constructor arguments change.

However, the factory also holds mutable state, which can only be modified from interactions of the vetting authority. As such we must prevent unauthorized deployments of the contract with an unexpected vetting authority address.

The deployment uses **permissioned salts** (deployer address embedded in the salt prefix) so that only the original deployer can create a contract at that address. This prevents a front-running attack where an adversary deploys a factory with a different vetting authority on a new chain. The salt input also includes the factory bytecode, implementation address, and principal account, so the address changes intentionally when any of these are modified.

The residual risk is loss of the deployer private key combined with a front-running attack on a not-yet-deployed chain. In that scenario, a new factory address would be required for future chains only — all existing deployments remain unaffected.

### RemoteAccountAxelarRouter — CREATE3

The router similarly uses **permissioned CREATE3** for the same cross-chain consistency reasons. The router address is visible to users when they sign operations. The contract does not have mutable state, but some of its constructor arguments are chain dependent. The deployment salt input includes the router bytecode and arguments under our control (source chain, factory address), omitting external per-chain arguments (gateway, permit2) that vary.

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
1. RemoteAccountFactory        (deploys RemoteAccount impl via CREATE2,
                                then factory via CREATE3)
         ↓
2. RemoteAccountAxelarRouter   (requires RemoteAccountFactory address,
                                deployed via CREATE3,
                                subsequently vetted with factory)
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

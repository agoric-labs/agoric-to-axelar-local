# Agoric <=> EVM Remote Account Contracts

Solidity contracts and deployment tooling for the ymax remote-account system: an Agoric
portfolio manager controls accounts and executes operations on EVM chains through
[Axelar General Message Passing (GMP)](https://docs.axelar.dev/dev/general-message-passing/overview/).

This repo started as a fork of [`axelar-local-dev`](https://github.com/axelarnetwork/axelar-local-dev)
(hence the `upstream` git remote) but is now scoped to building, testing, and deploying the
contracts below.

See [`src/contracts/design.md`](src/contracts/design.md) for the system architecture and
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for deployment details.

## Contracts

| Contract                   | Purpose                                                     |
| --------------------------- | ------------------------------------------------------------ |
| `RemoteAccount`              | Minimal-clone implementation for a remote EVM account         |
| `RemoteAccountFactory`        | Deploys deterministic `RemoteAccount` clones                  |
| `RemoteAccountAxelarRouter`   | Single Axelar GMP entry point for remote account operations   |
| `Factory` / `Wallet`         | Legacy smart-wallet factory                                   |
| `DepositFactory`              | Deposit-only wallet factory (with Permit2 support)             |
| `WalletHelper`                | Helper for withdrawing from Beefy vaults                      |

## Getting started

```bash
npm install
npm run build   # type-checks the TS sources and compiles the Solidity contracts
npm test        # runs the Hardhat contract test suite
```

Among the tests is `src/__tests__/BuildArtifacts.spec.ts`, which pins the compiled bytecode
hash of every contract with a deployment script. Since compiler-embedded metadata includes
each contract's relative source path, renaming or moving a contract file changes its
bytecode even when the Solidity itself is untouched — this test exists to catch that.

## Deploying

```bash
./scripts/deploy.sh <network> <factory|depositFactory|remoteAccountFactory|portfolioRouter> [owner_type]
```

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the full deployment guide (CreateX
determinism, environment variables, multi-chain deploys via `npm run deploy:all`).

### Mainnet gas settings

Before deploying to Ethereum mainnet, check current gas prices at
https://etherscan.io/gastracker and compare against `hardhat.config.ts`'s `eth` network
config (`maxFeePerGas`/`maxPriorityFeePerGas`). Increase them if the network is congested
(base fee > 80 gwei) to avoid dropped transactions.

## Repo layout

- `src/contracts/` — Solidity sources
- `src/deploy/`, `scripts/`, `ignition/` — deployment scripts (CreateX-based deterministic
  deploys for the remote-account system, Hardhat Ignition modules for the legacy
  factory/deposit-factory/wallet-helper contracts)
- `src/__tests__/` — Hardhat contract tests
- `integration/` — scripts and an Agoric-side CLI (`integration/agoric/`) for exercising the
  deployed contracts end-to-end (creating remote accounts, supply/withdraw flows)
- `agoric-docs/` — Agoric-authored design notes and audit reports

# Axelar Local Dev Cosmos

Axelar Local Dev Cosmos offers a comprehensive suite of tools for local development involving Cosmos chains. With this package, developers can easily deploy WebAssembly (Wasm) contracts on a Wasm chain and seamlessly send cross-chain messages to the Ethereum Virtual Machine (EVM) chain.

> **Note:** This package is currently under development. Some functionalities might be unstable.

## Prerequisite

- Docker installed and running on your local machine.

## Quick Start

### Start Wasm and Axelar Chain

Run the following command to pull the Docker image, set up the chains, and establish IBC connections:

```bash
npm run start
```

Alternatively, you can start the chains programmatically:

```ts
import { startChains } from "@axelar-network/axelar-local-dev-cosmos";

startChains();
```

## Running IBC Relayer and Axelar Event Listener

After setting up the chains, follow these steps to run the IBC Relayer and Axelar Event Listener:

**Create Axelar Relayer Service** for initailizing the IBC channels and keep listening to incoming events:

```ts
import {
  defaultAxelarChainInfo,
  AxelarRelayerService,
} from "@axelar-network/axelar-local-dev-cosmos";

const axelarRelayerService = await AxelarRelayerService.create(
  defaultAxelarChainInfo,
);
```

## Relaying Messages

To relay messages after they have been submitted on the Ethereum or Wasm chains, use the following method:

```ts
import {
  evmRelayer,
  createNetwork,
  relay,
  RelayerType,
} from "@axelar-network/axelar-local-dev";
import {
  defaultAxelarChainInfo,
  AxelarRelayerService,
} from "@axelar-network/axelar-local-dev-cosmos";

// Setup for Ethereum Network and Wasm chain relayer
const evmNetwork = await createNetwork({ name: "Ethereum" });
const wasmRelayer = await AxelarRelayerService.create(defaultAxelarChainInfo);

// Deploy contracts, send messages, and call the relay function
// ...

evmRelayer.setRelayer(RelayerType.Wasm, wasmRelayer);
await relay({
  wasm: wasmRelayer,
  evm: evmRelayer,
});

// Verify results on the destination chain
// ...
```

### Examples

- We currently support `Ethereum` as the destination chain for messages originating from the Wasm chain.
- For implementation details, see our [Local Example](docs/example.md) and [Axelar Example](https://github.com/axelarnetwork/axelar-examples/tree/feat/add-cosmos-examples/examples/cosmos/call-contract).

> The Local Example utilizes the same contracts as in the Axelar Examples.

## Mainnet Deployment

### Ethereum Mainnet Gas Settings

**IMPORTANT:** Before deploying to Ethereum mainnet, always check current gas prices to avoid dropped transactions.

Ethereum mainnet is prone to gas spikes, and transactions can be dropped from the mempool if gas settings are too low. The default configuration uses EIP-1559 gas settings:

- `maxFeePerGas`: 100 gwei (maximum fee you're willing to pay)
- `maxPriorityFeePerGas`: 2 gwei (tip to validators)

**Before deployment:**

1. Check current gas prices at https://etherscan.io/gastracker
2. Compare the current base fee and priority fee with the configured values in `hardhat.config.ts:71-72`
3. If network is congested (base fee > 80 gwei), increase `maxFeePerGas` to 150-200 gwei
4. Adjust the values in the configuration file if needed before running deployment scripts

**Example adjustment for high congestion:**

```typescript
eth: {
  // ...
  maxFeePerGas: 150_000_000_000, // 150 gwei for congested periods
  maxPriorityFeePerGas: 3_000_000_000, // 3 gwei priority fee
}
```

These settings ensure your transactions will be processed even during network congestion, preventing deployment failures and wasted gas fees.

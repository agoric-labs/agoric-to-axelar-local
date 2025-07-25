import {
  createNetwork,
  deployContract,
  evmRelayer,
  relay,
  RelayerType,
} from "@axelar-network/axelar-local-dev";
import { AxelarRelayerService, defaultAxelarChainInfo } from "./index";

export const relayBasic = async () => {
  const axelarRelayer = await AxelarRelayerService.create(
    defaultAxelarChainInfo,
  );

  const ethereumNetwork = await createNetwork({ name: "Ethereum" });
  await ethereumNetwork.deployToken("USDC", "aUSDC", 6, BigInt(100_000e6));

  const multiCallContract = await deployContract(
    ethereumNetwork.userWallets[0],
    require("../artifacts/src/__tests__/contracts/Multicall.sol/Multicall.json"),
  );
  console.log("MultiCall Contract Address:", multiCallContract.address);

  const factoryContract = await deployContract(
    ethereumNetwork.userWallets[0],
    require("../artifacts/src/__tests__/contracts/Factory.sol/Factory.json"),
    [ethereumNetwork.gateway.address, ethereumNetwork.gasService.address],
  );
  console.log("Factory Contract Address:", factoryContract.address);

  evmRelayer.setRelayer(RelayerType.Agoric, axelarRelayer);

  const expected = {
    wallet: "0xd8E896691A0FCE4641D44d9E461A6d746A5c91dB",
    nonce: 1,
    sourceChain: "agoric",
  };

  const timeoutMs = 4 * 60 * 1000; // 4 minutes
  const pollInterval = 1000; // 1 second
  const startTime = Date.now();
  let found = false;

  while (Date.now() - startTime < timeoutMs) {
    await relay({
      agoric: axelarRelayer,
      evm: evmRelayer,
    });

    const logs = await factoryContract.queryFilter("NewWalletCreated");
    const match = logs.find((log) => {
      if (!log.args) return false;
      const [wallet, nonce, _, sourceChain] = log.args;
      return (
        parseInt(nonce.toHexString(), 16) === expected.nonce &&
        wallet === expected.wallet &&
        sourceChain === expected.sourceChain
      );
    });

    if (match) {
      console.log("✅ Matching NewWalletCreated event found:");
      console.log(JSON.stringify(match, null, 2));
      found = true;
      process.exit(0);
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  if (!found) {
    throw new Error(
      "❌ Timed out: Expected NewWalletCreated event was not found within 4 minutes.",
    );
  }
};

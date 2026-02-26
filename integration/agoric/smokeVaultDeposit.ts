/**
 * Smoke test for vault deposit flow (direct EVM path).
 *
 * Style mirrors integration/agoric/createAndDeposit.ts:
 * - makeUI() defines user intent
 * - makeEVMHandler() handles intent routing
 * - invokeVaultDepositDirectly() performs direct chain call + assertions
 */

import { config as loadEnv } from "dotenv";
import { ethers } from "ethers";

loadEnv();

const DEFAULT_RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";
const DEFAULT_USDC =
  "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as const;
const DEFAULT_AMOUNT = 1_000_000n; // 1 USDC at 6 decimals

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];

const VAULT_ABI = [
  "function deposit(uint256 assets, address receiver) returns (uint256 shares)",
  "function ownerPortfolioAccount() view returns (address)",
  "function managedAssets() view returns (uint256)",
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "event Deposit(address indexed caller, address indexed owner, uint256 assets, uint256 shares)",
];

const requiredEnv = (env: Record<string, string | undefined>, name: string) => {
  const value = env[name];
  if (!value) throw Error(`${name} is required`);
  return value;
};

const assertEq = (
  label: string,
  actual: bigint,
  expected: bigint,
): void => {
  if (actual !== expected) {
    throw Error(`${label} mismatch: expected=${expected} actual=${actual}`);
  }
};

const logStep = (
  step: string,
  details: Record<string, string | number | bigint | boolean>,
) => {
  const normalized = Object.fromEntries(
    Object.entries(details).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]),
  );
  console.log(JSON.stringify({ step, ...normalized }));
};

const makeWalletSigner = (provider: ethers.Provider, signer: ethers.Wallet) => {
  return {
    getAddress: async () => (await signer.getAddress()) as `0x${string}`,
    withContract: async <T>(
      addr: `0x${string}`,
      abi: string[],
      callback: (it: ethers.Contract) => T,
    ) => {
      const contract = new ethers.Contract(addr, abi, signer);
      return await callback(contract);
    },
    provider,
  };
};
type Signer = ReturnType<typeof makeWalletSigner>;

const makeUI = (
  {
    usdc,
    vault,
  }: {
    usdc: `0x${string}`;
    vault: `0x${string}`;
  },
  { signer, ems }: { signer: Signer; ems: EVMMessageService },
) => {
  const self = {
    async deposit(amount: bigint) {
      await self.ensureVaultAllowance(amount);
      const receiver = await signer.getAddress();
      await ems.handleIntent("DepositToVault", { amount, receiver });
    },
    async ensureVaultAllowance(amount: bigint) {
      await signer.withContract(usdc, ERC20_ABI, async (token) => {
        const owner = await signer.getAddress();
        const allowance = (await token.allowance(owner, vault)) as bigint;
        if (allowance >= amount) {
          logStep("allowance.check", {
            owner,
            spender: vault,
            allowance,
            sufficient: true,
          });
          return;
        }

        logStep("allowance.approve.start", {
          owner,
          spender: vault,
          currentAllowance: allowance,
          targetAmount: amount,
        });
        const tx = await token.approve(vault, amount);
        await tx.wait();
        const allowanceAfter = (await token.allowance(owner, vault)) as bigint;
        logStep("allowance.approve.done", { txHash: tx.hash, allowanceAfter });
      });
    },
  };

  return self;
};

const invokeVaultDepositDirectly = async (
  signer: Signer,
  {
    usdc,
    vault,
    amount,
    receiver,
  }: {
    usdc: `0x${string}`;
    vault: `0x${string}`;
    amount: bigint;
    receiver: `0x${string}`;
  },
) => {
  const token = new ethers.Contract(usdc, ERC20_ABI, signer.provider);
  const vaultRead = new ethers.Contract(vault, VAULT_ABI, signer.provider);
  const vaultWrite = new ethers.Contract(vault, VAULT_ABI, signer.provider).connect(
    new ethers.Wallet(requiredEnv(process.env, "PRIVATE_KEY"), signer.provider),
  );

  const owner = await signer.getAddress();
  const p75 = (await vaultRead.ownerPortfolioAccount()) as `0x${string}`;

  const [ownerBefore, vaultBefore, p75Before, managedBefore, supplyBefore, sharesBefore, totalAssetsBefore] =
    (await Promise.all([
      token.balanceOf(owner),
      token.balanceOf(vault),
      token.balanceOf(p75),
      vaultRead.managedAssets(),
      vaultRead.totalSupply(),
      vaultRead.balanceOf(receiver),
      vaultRead.totalAssets(),
    ])) as bigint[];

  logStep("prestate", {
    owner,
    receiver,
    vault,
    usdc,
    p75,
    amount,
    ownerBefore,
    vaultBefore,
    p75Before,
    managedBefore,
    supplyBefore,
    sharesBefore,
    totalAssetsBefore,
  });

  const tx = await vaultWrite.deposit(amount, receiver);
  const receipt = await tx.wait();
  if (!receipt) throw Error("missing receipt");
  const block = await signer.provider.getBlock(receipt.blockNumber);
  const blockTimestamp = block?.timestamp ?? 0;
  logStep("tx.confirmed", {
    txHash: tx.hash,
    blockNumber: receipt.blockNumber,
    blockTimestamp,
    blockIsoTime: new Date(blockTimestamp * 1000).toISOString(),
    gasUsed: receipt.gasUsed,
  });

  const vaultIface = new ethers.Interface(VAULT_ABI);
  const erc20Iface = new ethers.Interface(ERC20_ABI);

  let depositEvent:
    | { caller: string; owner: string; assets: bigint; shares: bigint }
    | undefined;
  const transferEvents: { from: string; to: string; value: bigint }[] = [];

  for (const log of receipt.logs) {
    try {
      const parsedVault = vaultIface.parseLog(log);
      if (parsedVault && parsedVault.name === "Deposit") {
        depositEvent = {
          caller: parsedVault.args.caller as string,
          owner: parsedVault.args.owner as string,
          assets: parsedVault.args.assets as bigint,
          shares: parsedVault.args.shares as bigint,
        };
      }
    } catch {
      // not a vault log
    }

    try {
      const parsedErc20 = erc20Iface.parseLog(log);
      if (parsedErc20 && parsedErc20.name === "Transfer") {
        transferEvents.push({
          from: parsedErc20.args.from as string,
          to: parsedErc20.args.to as string,
          value: parsedErc20.args.value as bigint,
        });
      }
    } catch {
      // not an ERC20 transfer log
    }
  }

  if (!depositEvent) throw Error("missing Deposit event");

  const [ownerAfter, vaultAfter, p75After, managedAfter, supplyAfter, sharesAfter, totalAssetsAfter] =
    (await Promise.all([
      token.balanceOf(owner),
      token.balanceOf(vault),
      token.balanceOf(p75),
      vaultRead.managedAssets(),
      vaultRead.totalSupply(),
      vaultRead.balanceOf(receiver),
      vaultRead.totalAssets(),
    ])) as bigint[];

  const mintedShares = sharesAfter - sharesBefore;
  const expectedShares =
    supplyBefore === 0n
      ? amount
      : (amount * supplyBefore) / totalAssetsBefore;

  const excess = p75After - p75Before;
  const inboundTransfer = transferEvents.find(
    t =>
      t.from.toLowerCase() === owner.toLowerCase() &&
      t.to.toLowerCase() === vault.toLowerCase() &&
      t.value === amount,
  );
  const outboundTransfer = transferEvents.find(
    t =>
      t.from.toLowerCase() === vault.toLowerCase() &&
      t.to.toLowerCase() === p75.toLowerCase() &&
      t.value === excess,
  );

  if (!inboundTransfer) throw Error("missing USDC owner->vault transfer");
  if (!outboundTransfer && excess > 0n) {
    throw Error("missing USDC vault->p75 transfer for excess");
  }

  assertEq("Deposit.assets", depositEvent.assets, amount);
  assertEq("Deposit.shares", depositEvent.shares, mintedShares);
  assertEq("mintedShares", mintedShares, expectedShares);
  assertEq("owner balance delta", ownerBefore - ownerAfter, amount);
  assertEq("vault balance delta", vaultAfter - vaultBefore, amount - excess);
  assertEq("managedAssets delta", managedAfter - managedBefore, excess);
  assertEq("totalSupply delta", supplyAfter - supplyBefore, mintedShares);
  assertEq("totalAssets invariant", totalAssetsAfter, vaultAfter + managedAfter);

  logStep("events.detail", {
    depositCaller: depositEvent.caller,
    depositOwner: depositEvent.owner,
    depositAssets: depositEvent.assets,
    depositShares: depositEvent.shares,
    transferEventsJson: JSON.stringify(
      transferEvents.map(t => ({
        from: t.from,
        to: t.to,
        value: t.value.toString(),
      })),
    ),
  });

  logStep("assertions.pass", {
    depositCallerMatches: depositEvent.caller.toLowerCase() === owner.toLowerCase(),
    depositOwnerMatches: depositEvent.owner.toLowerCase() === receiver.toLowerCase(),
    mintedShares,
    expectedShares,
    excess,
    ownerAfter,
    vaultAfter,
    p75After,
    managedAfter,
    supplyAfter,
    totalAssetsAfter,
    transferEvents: transferEvents.length,
  });
};

const makeEVMHandler = (
  signer: Signer,
  contracts: { usdc: `0x${string}`; vault: `0x${string}` },
) => {
  return {
    async handleIntent(
      _intent: "DepositToVault",
      { amount, receiver }: { amount: bigint; receiver: `0x${string}` },
    ) {
      await invokeVaultDepositDirectly(signer, {
        usdc: contracts.usdc,
        vault: contracts.vault,
        amount,
        receiver,
      });
    },
  };
};
type EVMMessageService = ReturnType<typeof makeEVMHandler>;

const printUsage = () => {
  console.log(`
Usage: yarn smoke-vault-deposit [--amount <uusdc>] [--vault-address <address>] [--usdc-address <address>] [--rpc-url <url>]

Env:
  PRIVATE_KEY      required signer key
  VAULT_ADDRESS    required unless --vault-address is provided
`);
};

const getArgValue = (argv: string[], name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const main = async ({
  argv = process.argv.slice(2),
  env = process.env,
} = {}) => {
  if (argv.includes("--help")) {
    printUsage();
    return;
  }

  const pk = requiredEnv(env, "PRIVATE_KEY");
  const vaultAddress =
    (getArgValue(argv, "vault-address") || env.VAULT_ADDRESS) as
      | `0x${string}`
      | undefined;
  if (!vaultAddress) {
    throw Error("VAULT_ADDRESS is required (or pass --vault-address)");
  }

  const usdcAddress =
    (getArgValue(argv, "usdc-address") || env.USDC_ADDRESS || DEFAULT_USDC) as `0x${string}`;
  const rpcUrl = getArgValue(argv, "rpc-url") || env.RPC_URL || DEFAULT_RPC_URL;
  const amountRaw = getArgValue(argv, "amount") || env.DEPOSIT_AMOUNT_UUSDC;
  const amount = amountRaw ? BigInt(amountRaw) : DEFAULT_AMOUNT;

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(pk, provider);
  const signer = makeWalletSigner(provider, wallet);
  const ems = makeEVMHandler(signer, {
    usdc: usdcAddress,
    vault: vaultAddress,
  });
  const ui = makeUI(
    { usdc: usdcAddress, vault: vaultAddress },
    { signer, ems },
  );

  logStep("run.start", {
    vault: vaultAddress,
    usdc: usdcAddress,
    amount,
    rpcUrl,
  });
  await ui.deposit(amount);
  logStep("run.done", { ok: true });
};

main().catch(err => {
  console.error(err);
  process.exit(1);
});

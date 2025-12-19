/**
 * Create a Permit2 SignatureTransfer permit,
 * sign it with EIP-712, then encode the signature as EIP-2098 (64-byte compact),
 * then invoke Factory.testExecute(bytes payload).
 */

import { ethers, Wallet } from "ethers";
import { SignatureTransfer, PermitTransferFrom } from "@uniswap/permit2-sdk";
import { encodeAbiParameters, hexToBytes } from "viem";
import { getSigner } from "./axelar-support";
import { AxelarGmpOutgoingMemo } from "./types";
import { SigningStargateClient } from "@cosmjs/stargate";
import { addresses, channels, urls } from "./config";

const AXLEAR_GAS_RECEIVER = "axelar1zl3rxpp70lmte2xr6c4lgske2fyuj3hupcsvcd"; // for testnets
const AXELAR_GAS_AMOUNT = "20000000"; // 20 BLD
const DESTINATION_EVM_CHAIN = "ethereum-sepolia"; // axelar-id for eth testnet
const RPC = "https://ethereum-sepolia-rpc.publicnode.com";
// source: https://docs.uniswap.org/contracts/v4/deployments#sepolia-11155111
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
// source: https://developers.circle.com/stablecoins/usdc-contract-addresses#testnet
const USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";

// Factory address (spender must be Factory) => https://sepolia.etherscan.io/address/0x9F9684d7FA7318698a0030ca16ECC4a01944836b
const FACTORY = "0x9F9684d7FA7318698a0030ca16ECC4a01944836b";
// PRIVATE KEY of EOA
const PK = process.env.PRIVATE_KEY;
if (!PK) throw Error("PRIVATE_KEY is required");

/**
 * Builds an Axelar GMP payload by ABI-encoding contract calls.
 *
 * In Permit2 flows, the encoded call data includes a CreateAndDepositPayload(search in Factory.sol)
 * containing a Permit2 SignatureTransfer permit and signature, which the
 * Factory contract consumes to create and fund a smart wallet.
 */

export const buildCreateAndDepositPayload = ({
  ownerStr,
  tokenOwner,
  permit,
  signature,
  forAxelar = false,
}: {
  ownerStr: string;
  tokenOwner: `0x${string}`;
  permit: {
    permitted: { token: `0x${string}`; amount: bigint };
    nonce: bigint;
    deadline: bigint;
  };
  signature: `0x${string}`;
  forAxelar?: boolean;
}) => {
  const abiEncodedData = encodeAbiParameters(
    [
      {
        type: "tuple",
        name: "p",
        components: [
          { name: "ownerStr", type: "string" },
          { name: "tokenOwner", type: "address" },
          {
            name: "permit",
            type: "tuple",
            components: [
              {
                name: "permitted",
                type: "tuple",
                components: [
                  { name: "token", type: "address" },
                  { name: "amount", type: "uint256" },
                ],
              },
              { name: "nonce", type: "uint256" },
              { name: "deadline", type: "uint256" },
            ],
          },
          { name: "signature", type: "bytes" },
        ],
      },
    ],
    [
      {
        ownerStr,
        tokenOwner,
        permit: {
          permitted: {
            token: permit.permitted.token,
            amount: permit.permitted.amount,
          },
          nonce: permit.nonce,
          deadline: permit.deadline,
        },
        signature,
      },
    ],
  );

  if (forAxelar) return Array.from(hexToBytes(abiEncodedData));
  return abiEncodedData;
};

/**
 * Convert a normal 65-byte ECDSA signature (r,s,v) into EIP-2098 64-byte (r,vs).
 * vs = s with the highest bit set if v == 28 (or == 1 in 0/1 form)
 */
const toEip2098 = (signature65: string): string => {
  const sig = ethers.Signature.from(signature65);

  const sBig = BigInt(sig.s);
  const HIGH_BIT = 1n << 255n;
  const vsBig = sig.v === 28 ? sBig | HIGH_BIT : sBig & ~HIGH_BIT;

  return ethers.concat([sig.r, ethers.toBeHex(vsBig, 32)]);
};

/**
 * Build + sign a Permit2 SignatureTransfer permit, then compact the signature (EIP-2098).
 */
const createPermit2SignatureTransferPermit = async ({
  signer,
  chainId,
  permit2Address,
  token,
  amount,
  nonce,
  deadline,
  spender, // <-- the contract that will call Permit2 to consume this signature
}: {
  signer: ethers.Signer;
  chainId: number;
  permit2Address: string;
  token: string;
  amount: bigint;
  nonce: bigint;
  deadline: bigint;
  spender: string;
}): Promise<{
  permit: PermitTransferFrom;
  signature65: string;
  signature2098: string;
  typedData: { domain: any; types: any; values: any };
}> => {
  const permit: PermitTransferFrom = {
    permitted: { token, amount },
    nonce,
    deadline,
    spender,
  };

  // Uniswap Permit2 SDK generates the correct EIP-712 typed data
  const { domain, types, values } = SignatureTransfer.getPermitData(
    permit,
    permit2Address,
    chainId,
  );

  // Sign EIP-712 (returns normal 65-byte signature)
  const signature65 = await signer.signTypedData(domain as any, types, values);

  // Convert to EIP-2098 compact signature (64 bytes)
  const signature2098 = toEip2098(signature65);

  return {
    permit,
    signature65,
    signature2098,
    typedData: { domain, types, values },
  };
};

/**
 * Approves USDC for spending by the Permit2 contract.
 */

const approveUsdc = async ({
  usdcAddr,
  permit2Addr,
  amount,
  signer,
}: {
  usdcAddr: string;
  permit2Addr: string;
  amount: bigint;
  signer: Wallet;
}) => {
  const ERC20_ABI = [
    "function approve(address spender, uint256 amount) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function balanceOf(address owner) view returns (uint256)",
  ];

  const usdc = new ethers.Contract(usdcAddr, ERC20_ABI, signer);

  await (await usdc.approve(permit2Addr, amount)).wait();
  console.log(
    "USDC allowance to Permit2 (after):",
    (await usdc.allowance(await signer.getAddress(), permit2Addr)).toString(),
  );
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Directly invokes the Factory contract using encoded Permit2 payload.
 *
 * This helper bypasses Axelar GMP and calls `Factory.testExecute(bytes)` directly
 * for testnet debugging. It simulates the post-verification execution
 * path that would normally be triggered by the Axelar Gateway.
 *
 * The function:
 * - ABI-encodes a CreateAndFundPayload containing a Permit2 SignatureTransfer permit
 *   and signature
 * - Calls the Factory contract to create a new smart wallet
 * - Funds the wallet by consuming the Permit2 permit
 *
 * IMPORTANT:
 * - This should only be used for testing.
 * - In production, the Factory is invoked via Axelar GMP, not directly.
 * - The signer must be the token owner and must have approved Permit2 beforehand.
 */

const invokeFactoryContractDirectly = async ({
  signer,
  permit,
  sig65,
  waitBeforeCall,
}: {
  signer: Wallet;
  permit: PermitTransferFrom;
  sig65: `0x${string}`;
  waitBeforeCall: boolean;
}) => {
  const tokenOwner = (await signer.getAddress()) as `0x${string}`;

  // --- invoke Factory.testExecute(bytes) ---
  const FACTORY_ABI = ["function testExecute(bytes payload) external"];
  const factory = new ethers.Contract(FACTORY, FACTORY_ABI, signer);

  const ownerStr = `agoric1${Date.now()}`; // to create a unique create2 addr everytime

  if (waitBeforeCall) {
    console.log("waiting 2min");
    await sleep(2 * 60 * 1000);
  }
  const encodedPayload = buildCreateAndDepositPayload({
    ownerStr,
    tokenOwner,
    permit: {
      permitted: {
        token: permit.permitted.token as `0x${string}`,
        amount: permit.permitted.amount as bigint,
      },
      nonce: permit.nonce as bigint,
      deadline: permit.deadline as bigint,
    },
    signature: sig65,
  });

  const tx = await factory.testExecute(encodedPayload);
  console.log("testExecute tx:", tx.hash);
  await tx.wait();
  console.log("✅ testExecute confirmed");
};

/**
 * Sends a Permit2-based create-and-deposit request to the Factory contract
 * via Axelar GMP from the Agoric chain.
 */
const createAndDepositViaAxelar = async ({
  permit,
  sig65,
  tokenOwner,
}: {
  permit: PermitTransferFrom;
  sig65: `0x${string}`;
  tokenOwner: `0x${string}`;
}) => {
  const agoricSigner = await getSigner();
  const accounts = await agoricSigner.getAccounts();
  const agoricOwner = accounts[0].address;
  console.log("Agoric Address:", agoricOwner);

  const encodedPayload = buildCreateAndDepositPayload({
    ownerStr: agoricOwner,
    tokenOwner,
    permit: {
      permitted: {
        token: permit.permitted.token as `0x${string}`,
        amount: permit.permitted.amount as bigint,
      },
      nonce: permit.nonce as bigint,
      deadline: permit.deadline as bigint,
    },
    signature: sig65,
    forAxelar: true,
  });

  const axelarMemo: AxelarGmpOutgoingMemo = {
    destination_chain: DESTINATION_EVM_CHAIN,
    destination_address: FACTORY,
    payload: encodedPayload as number[],
    type: 1,
    fee: {
      amount: AXELAR_GAS_AMOUNT,
      recipient: AXLEAR_GAS_RECEIVER,
    },
  };

  const ibcPayload = [
    {
      typeUrl: "/ibc.applications.transfer.v1.MsgTransfer",
      value: {
        sender: agoricOwner,
        receiver: addresses.AXELAR_GMP,
        token: {
          denom: "ubld",
          amount: AXELAR_GAS_AMOUNT,
        },
        timeoutTimestamp: (Math.floor(Date.now() / 1000) + 600) * 1e9,
        sourceChannel: channels.AGORIC_DEVNET_TO_AXELAR,
        sourcePort: "transfer",
        memo: JSON.stringify(axelarMemo),
      },
    },
  ];

  console.log("connecting with signer");
  const signingClient = await SigningStargateClient.connectWithSigner(
    urls.RPC_AGORIC_DEVNET,
    agoricSigner,
  );

  const fee = {
    gas: "1000000",
    amount: [{ denom: "ubld", amount: "1000000" }],
  };

  console.log("Sign and Broadcast transaction...");
  const response = await signingClient.signAndBroadcast(
    agoricOwner,
    ibcPayload,
    fee,
  );
  console.log("RESPONSE:", response);
};

const hasFlag = (name: string) => process.argv.includes(`--${name}`);

const main = async () => {
  const provider = new ethers.JsonRpcProvider(RPC);

  const signer = new ethers.Wallet(PK, provider);
  const tokenOwner = (await signer.getAddress()) as `0x${string}`;

  const chainId = Number((await provider.getNetwork()).chainId);
  const spender = FACTORY;

  const { permit, signature65, signature2098 } =
    await createPermit2SignatureTransferPermit({
      signer,
      chainId,
      permit2Address: PERMIT2,
      token: USDC,
      amount: 1n * 1_000_000n,
      nonce: BigInt(Date.now()),
      deadline: BigInt(Math.floor(Date.now() / 1000) + 60 * 7), // valid for 2min
      spender,
    });

  console.log({ permit });
  console.log("sig65 bytes:", (signature65.length - 2) / 2);
  console.log("sig2098 bytes:", (signature2098.length - 2) / 2);

  await approveUsdc({
    usdcAddr: USDC,
    permit2Addr: PERMIT2,
    amount: 1000_000n,
    signer,
  });

  const viaAxelar = hasFlag("viaAxelar"); // yarn permit --viaAxelar

  if (viaAxelar) {
    console.log("invoking via axelar");
    await createAndDepositViaAxelar({
      permit,
      sig65: signature65 as `0x${string}`,
      tokenOwner,
    });
  } else {
    console.log("invoking via directly");
    const waitBeforeCall = hasFlag("wait"); // yarn permit --wait
    await invokeFactoryContractDirectly({
      signer,
      permit,
      sig65: signature65 as `0x${string}`,
      waitBeforeCall,
    });
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

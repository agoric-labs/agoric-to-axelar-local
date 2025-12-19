/**
 * Create a Permit2 SignatureTransfer permit,
 * sign it with EIP-712, then encode the signature as EIP-2098 (64-byte compact),
 * then invoke Factory.testExecute(bytes payload).
 */

import { ethers } from "ethers";
import { SignatureTransfer, PermitTransferFrom } from "@uniswap/permit2-sdk";

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
  const signature65 = await signer.signTypedData(domain, types, values);

  // Convert to EIP-2098 compact signature (64 bytes)
  const signature2098 = toEip2098(signature65);

  return {
    permit,
    signature65,
    signature2098,
    typedData: { domain, types, values },
  };
};

const main = async () => {
  const RPC = "https://ethereum-sepolia-rpc.publicnode.com";
  const PK = process.env.PRIVATE_KEY;
  if (!PK) throw Error("PRIVATE_KEY is required");

  const provider = new ethers.JsonRpcProvider(RPC);
  const signer = new ethers.Wallet(PK, provider);

  const chainId = Number((await provider.getNetwork()).chainId);

  // source: https://docs.uniswap.org/contracts/v4/deployments#sepolia-11155111
  const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
  // source: https://developers.circle.com/stablecoins/usdc-contract-addresses#testnet
  const USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";

  // Factory address (spender must be Factory)
  const FACTORY = "0x9F9684d7FA7318698a0030ca16ECC4a01944836b";
  const spender = FACTORY;

  const { permit, signature65, signature2098 } =
    await createPermit2SignatureTransferPermit({
      signer,
      chainId,
      permit2Address: PERMIT2,
      token: USDC,
      amount: 1n * 1_000_000n,
      nonce: BigInt(Date.now()),
      deadline: BigInt(Math.floor(Date.now() / 1000) + 60 * 2),
      spender,
    });

  console.log({ permit });
  console.log("sig65 bytes:", (signature65.length - 2) / 2);
  console.log("sig2098 bytes:", (signature2098.length - 2) / 2);

  // // ----
  const ERC20_ABI = [
    "function approve(address spender, uint256 amount) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function balanceOf(address owner) view returns (uint256)",
  ];

  const usdc = new ethers.Contract(USDC, ERC20_ABI, signer);
  const tokenOwner = await signer.getAddress();

  // // check balance
  // console.log('USDC balance:', (await usdc.balanceOf(tokenOwner)).toString());

  // // check allowance to Permit2
  // console.log(
  //   'USDC allowance to Permit2:',
  //   (await usdc.allowance(tokenOwner, PERMIT2)).toString()
  // );

  // // approve Permit2 if needed (for USDC 6 decimals: 1_000_000 = 1 USDC)
  // await (await usdc.approve(PERMIT2, 2_000_000n)).wait();
  // console.log(
  //   'USDC allowance to Permit2 (after):',
  //   (await usdc.allowance(await signer.getAddress(), PERMIT2)).toString()
  // );

  // --- invoke Factory.testExecute(bytes) ---
  const FACTORY_ABI = ["function testExecute(bytes payload) external"];
  const factory = new ethers.Contract(FACTORY, FACTORY_ABI, signer);

  const ownerStr = "agoric1u5yhqp20tp58hx3kkg2ktj4d9shpukg2q3cx8nv"; // <-- update

  // Solidity payload:
  // tuple(
  //   string ownerStr,
  //   address tokenOwner,
  //   tuple(address token,uint256 amount,address spender,uint256 nonce,uint256 deadline) permit,
  //   bytes signature
  // )
  const payloadTypes = [
    "tuple(" +
      "string ownerStr," +
      "address tokenOwner," +
      "tuple(" +
      "tuple(address token,uint256 amount) permitted," +
      "uint256 nonce," +
      "uint256 deadline" +
      ") permit," +
      "bytes signature" +
      ")",
  ] as const;

  const payloadValue = {
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
    signature: signature65,
  };

  const encodedPayload = ethers.AbiCoder.defaultAbiCoder().encode(
    payloadTypes,
    [payloadValue],
  );

  const tx = await factory.testExecute(encodedPayload);
  console.log("testExecute tx:", tx.hash);
  await tx.wait();
  console.log("✅ testExecute confirmed");
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

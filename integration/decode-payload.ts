#!/usr/bin/env node
/**
 * Simple script to decode Wallet contract payload
 * Usage: vite-node decode-payload.ts <payload-hex>
 */

import { ethers } from "ethers";

// Get payload from command line
const payloadHex = process.argv[2];

if (!payloadHex) {
  console.error("Usage: vite-node decode-payload.ts <payload-hex>");
  process.exit(1);
}

// Decode the CallMessage struct
const abiCoder = ethers.AbiCoder.defaultAbiCoder();
const decoded = abiCoder.decode(
  ["tuple(string id, tuple(address target, bytes data)[] calls)"],
  payloadHex,
);

const callMessage = decoded[0];

console.log("\n" + "=".repeat(70));
console.log("Decoded Wallet Payload");
console.log("=".repeat(70));
console.log("\nTransaction ID:", callMessage.id);
console.log("Number of calls:", callMessage.calls.length);

console.log("\nCalls:");
callMessage.calls.forEach((call: any, idx: number) => {
  console.log(`\n  [${idx}] Target: ${call.target}`);
  console.log(`      Selector: ${ethers.dataSlice(call.data, 0, 4)}`);
  console.log(`      Data: ${call.data}`);
});

console.log("\n" + "=".repeat(70) + "\n");

#!/usr/bin/env node
// @ts-check
import "./lockdown.mjs";
import { prepareOffer, processWalletOffer } from "./utils.mjs";

const OFFER_FILE = "offer.json";
const CONTAINER_PATH = `/usr/src/${OFFER_FILE}`;
const FROM_ADDRESS = "agoric1rwwley550k9mmk6uq6mm6z4udrg8kyuyvfszjk";
const { log, error } = console;

try {
  log("--- Creating and Monitoring LCA ---");

  log("Preparing offer...");
  const offer = await prepareOffer({
    publicInvitationMaker: "createAndMonitorLCA",
    instanceName: "axelarGmp",
    brandName: "BLD",
    amount: 1n,
    source: "contract",
  });

  await processWalletOffer({
    offer,
    OFFER_FILE,
    CONTAINER_PATH,
    FROM_ADDRESS,
  });
} catch (err) {
  error("ERROR:", err.shortMessage || err.message);
  process.exit(1);
}

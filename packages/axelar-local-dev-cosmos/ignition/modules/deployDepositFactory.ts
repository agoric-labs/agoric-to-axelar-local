import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { config } from "dotenv";
import { ethers } from "ethers";

config();

const {
  GATEWAY_CONTRACT,
  GAS_SERVICE_CONTRACT,
  PERMIT2_CONTRACT,
  OWNER_ADDRESS,
} = process.env;

console.log("Deploying DepositFactory with CREATE2...");
console.log("Gateway:", GATEWAY_CONTRACT);
console.log("Gas Service:", GAS_SERVICE_CONTRACT);
console.log("Permit2:", PERMIT2_CONTRACT);
console.log("Owner:", OWNER_ADDRESS);

if (
  !GATEWAY_CONTRACT ||
  !GAS_SERVICE_CONTRACT ||
  !PERMIT2_CONTRACT ||
  !OWNER_ADDRESS
) {
  throw new Error(
    "Missing environment variables: GATEWAY_CONTRACT, GAS_SERVICE_CONTRACT, PERMIT2_CONTRACT, OWNER_ADDRESS",
  );
}

export default buildModule("DepositFactoryModule", (m) => {
  const gateway = m.getParameter("gateway_", GATEWAY_CONTRACT);
  const gasService = m.getParameter("gasReceiver_", GAS_SERVICE_CONTRACT);
  const permit2 = m.getParameter("permit2_", PERMIT2_CONTRACT);
  const owner = m.getParameter("owner_", OWNER_ADDRESS);

  // Deploy the CREATE2 deployer first
  const deployer = m.contract("DepositFactoryDeployer", []);

  // Generate salt from owner address for deterministic deployment
  const salt = ethers.id(OWNER_ADDRESS);
  console.log("Salt (derived from owner):", salt);

  // Deploy DepositFactory via the deployer using CREATE2
  const depositFactory = m.call(deployer, "deployDepositFactory", [
    gateway,
    gasService,
    permit2,
    owner,
    salt,
  ]);

  return { deployer, depositFactory };
});

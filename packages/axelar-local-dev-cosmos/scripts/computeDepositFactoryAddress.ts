import { ethers } from "hardhat";
import { config } from "dotenv";

config();

/**
 * Compute the deterministic address of a DepositFactory before deployment
 * This address will be the same across all EVM chains
 */
async function main() {
  const { GATEWAY_CONTRACT, GAS_SERVICE_CONTRACT, PERMIT2_CONTRACT, OWNER_ADDRESS } = process.env;

  if (!GATEWAY_CONTRACT || !GAS_SERVICE_CONTRACT || !PERMIT2_CONTRACT || !OWNER_ADDRESS) {
    throw new Error(
      "Missing environment variables: GATEWAY_CONTRACT, GAS_SERVICE_CONTRACT, PERMIT2_CONTRACT, OWNER_ADDRESS"
    );
  }

  console.log("Computing DepositFactory address...\n");
  console.log("Parameters:");
  console.log("  Gateway:", GATEWAY_CONTRACT);
  console.log("  Gas Service:", GAS_SERVICE_CONTRACT);
  console.log("  Permit2:", PERMIT2_CONTRACT);
  console.log("  Owner:", OWNER_ADDRESS);

  // Get the deployer contract factory
  const DepositFactoryDeployer = await ethers.getContractFactory("DepositFactoryDeployer");

  // Note: You need to deploy the DepositFactoryDeployer first and use its address here
  // For now, we'll compute what the address would be if deployer is at a known address
  const DEPLOYER_ADDRESS = process.env.DEPLOYER_CONTRACT_ADDRESS || "0x0000000000000000000000000000000000000000";

  if (DEPLOYER_ADDRESS === "0x0000000000000000000000000000000000000000") {
    console.log("\n⚠️  DEPLOYER_CONTRACT_ADDRESS not set in .env");
    console.log("Please deploy DepositFactoryDeployer first and set its address in .env\n");
  }

  // Generate salt from owner address
  const salt = ethers.id(OWNER_ADDRESS);
  console.log("\nSalt (derived from owner):", salt);

  // Get DepositFactory creation code
  const DepositFactory = await ethers.getContractFactory("DepositFactory");
  const bytecode = ethers.solidityPacked(
    ["bytes", "bytes"],
    [
      DepositFactory.bytecode,
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "address", "string"],
        [GATEWAY_CONTRACT, GAS_SERVICE_CONTRACT, PERMIT2_CONTRACT, OWNER_ADDRESS]
      ),
    ]
  );

  // Compute CREATE2 address
  const hash = ethers.keccak256(
    ethers.solidityPacked(
      ["bytes1", "address", "bytes32", "bytes32"],
      ["0xff", DEPLOYER_ADDRESS, salt, ethers.keccak256(bytecode)]
    )
  );

  const predictedAddress = ethers.getAddress("0x" + hash.slice(-40));

  console.log("\n✅ Predicted DepositFactory address:", predictedAddress);
  console.log("\nℹ️  This address will be the same on all chains where:");
  console.log("   - DepositFactoryDeployer is deployed at:", DEPLOYER_ADDRESS);
  console.log("   - Same constructor parameters are used");
  console.log("   - Same salt is used (derived from owner)");

  // If deployer is available, verify with contract call
  if (DEPLOYER_ADDRESS !== "0x0000000000000000000000000000000000000000") {
    try {
      const deployerContract = DepositFactoryDeployer.attach(DEPLOYER_ADDRESS);
      const computedAddress = await deployerContract.computeDepositFactoryAddress(
        GATEWAY_CONTRACT,
        GAS_SERVICE_CONTRACT,
        PERMIT2_CONTRACT,
        OWNER_ADDRESS,
        salt
      );

      console.log("\n✅ Verified with deployer contract:", computedAddress);

      if (computedAddress.toLowerCase() !== predictedAddress.toLowerCase()) {
        console.error("\n❌ ERROR: Addresses don't match!");
      }
    } catch (error) {
      console.log("\n⚠️  Could not verify with deployer contract (not deployed yet?)");
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

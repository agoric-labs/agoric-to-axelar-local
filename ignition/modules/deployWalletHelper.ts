import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("WalletHelperModule", (m) => {
  const WalletHelper = m.contract("WalletHelper", []);

  return { WalletHelper };
});

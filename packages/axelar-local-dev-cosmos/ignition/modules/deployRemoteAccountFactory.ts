import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("RemoteAccountFactoryModule", (m) => {
  const Factory = m.contract("Factory", []);

  return { Factory };
});

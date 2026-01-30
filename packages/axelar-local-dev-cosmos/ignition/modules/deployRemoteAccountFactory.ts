import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("RemoteAccountFactoryModule", (m) => {
  const RemoteAccountFactory = m.contract("RemoteAccountFactory", []);

  return { RemoteAccountFactory };
});

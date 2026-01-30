import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { config } from "dotenv";

config();

const { GATEWAY_CONTRACT, FACTORY_CONTRACT, PERMIT2_CONTRACT, AGORIC_LCA } =
  process.env;

console.log("Deploying PortfolioRouter with:");
console.log("  Gateway:", GATEWAY_CONTRACT);
console.log("  Factory:", FACTORY_CONTRACT);
console.log("  Permit2:", PERMIT2_CONTRACT);
console.log("  Agoric LCA:", AGORIC_LCA);

if (
  !GATEWAY_CONTRACT ||
  !FACTORY_CONTRACT ||
  !PERMIT2_CONTRACT ||
  !AGORIC_LCA
) {
  throw new Error(
    "Missing required env vars: GATEWAY_CONTRACT, FACTORY_CONTRACT, PERMIT2_CONTRACT, or AGORIC_LCA",
  );
}

export default buildModule("PortfolioRouterModule", (m) => {
  const gateway = m.getParameter("gateway_", GATEWAY_CONTRACT);
  const factory = m.getParameter("factory_", FACTORY_CONTRACT);
  const permit2 = m.getParameter("permit2_", PERMIT2_CONTRACT);
  const agoricLCA = m.getParameter("agoricLCA_", AGORIC_LCA);

  const PortfolioRouter = m.contract("PortfolioRouter", [
    gateway,
    factory,
    permit2,
    agoricLCA,
  ]);

  return { PortfolioRouter };
});

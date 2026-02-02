import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';
import { config } from 'dotenv';

config();

const {
    GATEWAY_CONTRACT,
    AXELAR_SOURCE_CHAIN,
    PRINCIPAL_CAIP2,
    PRINCIPAL_ACCOUNT,
    FACTORY_CONTRACT,
    PERMIT2_CONTRACT,
    OWNER_AUTHORITY,
} = process.env;

console.log('Deploying PortfolioRouter with:');
console.log('  Gateway:', GATEWAY_CONTRACT);
console.log('  Axelar Source Chain:', AXELAR_SOURCE_CHAIN);
console.log('  Principal CAIP2:', PRINCIPAL_CAIP2);
console.log('  Principal Account:', PRINCIPAL_ACCOUNT);
console.log('  Factory:', FACTORY_CONTRACT);
console.log('  Permit2:', PERMIT2_CONTRACT);
console.log('  Owner Authority:', OWNER_AUTHORITY);

if (
    !GATEWAY_CONTRACT ||
    !AXELAR_SOURCE_CHAIN ||
    !PRINCIPAL_CAIP2 ||
    !PRINCIPAL_ACCOUNT ||
    !FACTORY_CONTRACT ||
    !PERMIT2_CONTRACT ||
    !OWNER_AUTHORITY
) {
    throw new Error(
        'Missing required env vars: GATEWAY_CONTRACT, AXELAR_SOURCE_CHAIN, PRINCIPAL_CAIP2, PRINCIPAL_ACCOUNT, FACTORY_CONTRACT, PERMIT2_CONTRACT, or OWNER_AUTHORITY',
    );
}

export default buildModule('PortfolioRouterModule', (m) => {
    const gateway = m.getParameter('gateway_', GATEWAY_CONTRACT);
    const axelarSourceChain = m.getParameter('axelarSourceChain_', AXELAR_SOURCE_CHAIN);
    const principalCaip2 = m.getParameter('principalCaip2_', PRINCIPAL_CAIP2);
    const principalAccount = m.getParameter('principalAccount_', PRINCIPAL_ACCOUNT);
    const factory = m.getParameter('factory_', FACTORY_CONTRACT);
    const permit2 = m.getParameter('permit2_', PERMIT2_CONTRACT);
    const ownerAuthority = m.getParameter('ownerAuthority_', OWNER_AUTHORITY);

    const PortfolioRouter = m.contract('PortfolioRouter', [
        gateway,
        axelarSourceChain,
        principalCaip2,
        principalAccount,
        factory,
        permit2,
        ownerAuthority,
    ]);

    return { PortfolioRouter };
});

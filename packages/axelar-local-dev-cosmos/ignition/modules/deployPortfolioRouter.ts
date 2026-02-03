import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';
import { config } from 'dotenv';

config();

const {
    GATEWAY_CONTRACT,
    AXELAR_SOURCE_CHAIN,
    FACTORY_CONTRACT,
    PERMIT2_CONTRACT,
    OWNER_AUTHORITY,
} = process.env;

console.log('Deploying RemoteAccountAxelarRouter with:');
console.log('  Gateway:', GATEWAY_CONTRACT);
console.log('  Axelar Source Chain:', AXELAR_SOURCE_CHAIN);
console.log('  Factory:', FACTORY_CONTRACT);
console.log('  Permit2:', PERMIT2_CONTRACT);
console.log('  Owner Authority:', OWNER_AUTHORITY);

if (
    !GATEWAY_CONTRACT ||
    !AXELAR_SOURCE_CHAIN ||
    !FACTORY_CONTRACT ||
    !PERMIT2_CONTRACT ||
    !OWNER_AUTHORITY
) {
    throw new Error(
        'Missing required env vars: GATEWAY_CONTRACT, AXELAR_SOURCE_CHAIN, FACTORY_CONTRACT, PERMIT2_CONTRACT, or OWNER_AUTHORITY',
    );
}

export default buildModule('RemoteAccountAxelarRouterModule', (m) => {
    const gateway = m.getParameter('gateway_', GATEWAY_CONTRACT);
    const axelarSourceChain = m.getParameter('axelarSourceChain_', AXELAR_SOURCE_CHAIN);
    const factoryAddress = m.getParameter('factory_', FACTORY_CONTRACT);
    const permit2 = m.getParameter('permit2_', PERMIT2_CONTRACT);
    const ownerAuthority = m.getParameter('ownerAuthority_', OWNER_AUTHORITY);

    const RemoteAccountAxelarRouter = m.contract('RemoteAccountAxelarRouter', [
        gateway,
        axelarSourceChain,
        factoryAddress,
        permit2,
        ownerAuthority,
    ]);

    const factory = m.contractAt('RemoteAccountFactory', factoryAddress);

    m.call(factory, 'transferOwnership', [RemoteAccountAxelarRouter], {
        id: 'transferFactoryOwnership',
    });

    return { RemoteAccountAxelarRouter };
});

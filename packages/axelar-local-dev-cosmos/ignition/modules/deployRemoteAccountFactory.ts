import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';
import { config } from 'dotenv';

config();

const { PRINCIPAL_CAIP2, PRINCIPAL_ACCOUNT } = process.env;

console.log('Deploying RemoteAccountFactory with:');
console.log('  Principal CAIP2:', PRINCIPAL_CAIP2);
console.log('  Principal Account:', PRINCIPAL_ACCOUNT);

if (!PRINCIPAL_CAIP2 || !PRINCIPAL_ACCOUNT) {
    throw new Error('Missing required env vars: PRINCIPAL_CAIP2 or PRINCIPAL_ACCOUNT');
}

export default buildModule('RemoteAccountFactoryModule', (m) => {
    const principalCaip2 = m.getParameter('principalCaip2_', PRINCIPAL_CAIP2);
    const principalAccount = m.getParameter('principalAccount_', PRINCIPAL_ACCOUNT);

    // Deploy the RemoteAccount implementation contract first
    const RemoteAccountImplementation = m.contract('RemoteAccount', [], {
        id: 'RemoteAccountImplementation',
    });

    // Renounce ownership on the implementation to make it inert
    m.call(RemoteAccountImplementation, 'renounceOwnership', [], {
        id: 'renounceImplementationOwnership',
    });

    // Deploy the factory with the implementation address
    const RemoteAccountFactory = m.contract('RemoteAccountFactory', [
        principalCaip2,
        principalAccount,
        RemoteAccountImplementation,
    ]);

    return { RemoteAccountImplementation, RemoteAccountFactory };
});

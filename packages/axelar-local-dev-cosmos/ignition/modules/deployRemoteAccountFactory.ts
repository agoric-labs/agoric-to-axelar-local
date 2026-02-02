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

    const RemoteAccountFactory = m.contract('RemoteAccountFactory', [
        principalCaip2,
        principalAccount,
    ]);

    return { RemoteAccountFactory };
});

import '@nomicfoundation/hardhat-ethers';
import { ethers, network } from 'hardhat';

const { isAddress } = ethers;

import { getCreateX, validateCreateX, verifyOnExplorer } from '../src/deploy/createx-utils.ts';
import {
    deployRemoteAccountFactory,
    deployRemoteAccountImplementation,
} from '../src/deploy/deployRemoteAccountFactory.ts';

const main = async () => {
    const { PRINCIPAL_CAIP2, PRINCIPAL_ACCOUNT, VETTING_AUTHORITY } = process.env;
    if (!PRINCIPAL_CAIP2 || !PRINCIPAL_ACCOUNT) {
        throw new Error('Missing env: PRINCIPAL_CAIP2 or PRINCIPAL_ACCOUNT');
    }
    if (VETTING_AUTHORITY && !isAddress(VETTING_AUTHORITY)) {
        throw new Error(`Invalid VETTING_AUTHORITY: ${VETTING_AUTHORITY}`);
    }

    const [deployer] = await ethers.getSigners();
    const deployerAddress = await deployer.getAddress();
    const vettingAuthority = VETTING_AUTHORITY || deployerAddress;
    const { chainId } = await ethers.provider.getNetwork();

    console.log(`\nCreateX CREATE3 Deploy — ${network.name} (${chainId})`);
    console.log(`  Deployer:          ${deployerAddress}`);
    console.log(`  Principal CAIP2:   ${PRINCIPAL_CAIP2}`);
    console.log(`  Principal Account: ${PRINCIPAL_ACCOUNT}`);
    if (!VETTING_AUTHORITY) {
        console.log(`  Vetting Authority: ${vettingAuthority} (defaulting to deployer)`);
    } else {
        console.log(`  Vetting Authority: ${vettingAuthority}`);
    }

    await validateCreateX();
    const createX = getCreateX(deployer);

    // Step 1: RemoteAccount (implementation)
    console.log('RemoteAccount (implementation):');
    const implResult = await deployRemoteAccountImplementation(
        createX,
        deployerAddress,
        PRINCIPAL_ACCOUNT,
    );

    // Step 2: RemoteAccountFactory
    console.log('RemoteAccountFactory:');
    const factoryResult = await deployRemoteAccountFactory(
        createX,
        deployerAddress,
        PRINCIPAL_CAIP2,
        PRINCIPAL_ACCOUNT,
        implResult.address,
        vettingAuthority,
    );

    // Verification — always attempt, even for already-deployed contracts,
    // so a previous deploy whose verification failed can be retried.
    await verifyOnExplorer({
        address: implResult.address,
        constructorArgs: [],
        contract: 'src/contracts/RemoteAccount.sol:RemoteAccount',
    });
    await verifyOnExplorer({
        address: factoryResult.address,
        constructorArgs: [PRINCIPAL_CAIP2, PRINCIPAL_ACCOUNT, implResult.address, vettingAuthority],
        contract: 'src/contracts/RemoteAccountFactory.sol:RemoteAccountFactory',
    });
};

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

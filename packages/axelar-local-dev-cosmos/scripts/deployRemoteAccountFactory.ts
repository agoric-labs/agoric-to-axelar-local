import '@nomicfoundation/hardhat-ethers';
import { ethers, network } from 'hardhat';

const { isAddress } = ethers;

import {
    buildPermissionedSalt,
    deployViaCreateX,
    getCreateX,
    validateCreateX,
    verifyOnExplorer,
} from './createx-utils.ts';

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

    console.log(`\nCreateX CREATE2 Deploy — ${network.name} (${chainId})`);
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
    const RemoteAccountCF = await ethers.getContractFactory('RemoteAccount');
    const implRawSalt = buildPermissionedSalt(deployerAddress, RemoteAccountCF.bytecode);
    const implResult = await deployViaCreateX({
        createX,
        deployer: deployerAddress,
        rawSalt: implRawSalt,
        initCode: RemoteAccountCF.bytecode,
        label: 'RemoteAccount',
        mode: 'create2',
    });

    // Step 2: RemoteAccountFactory
    console.log('RemoteAccountFactory:');
    const FactoryCF = await ethers.getContractFactory('RemoteAccountFactory');
    const factoryDeployTx = await FactoryCF.getDeployTransaction(
        PRINCIPAL_CAIP2,
        PRINCIPAL_ACCOUNT,
        implResult.address,
        vettingAuthority,
    );
    if (!factoryDeployTx.data) {
        throw new Error('Failed to encode RemoteAccountFactory initCode');
    }
    const factoryRawSalt = buildPermissionedSalt(deployerAddress, factoryDeployTx.data);
    const factoryResult = await deployViaCreateX({
        createX,
        deployer: deployerAddress,
        rawSalt: factoryRawSalt,
        initCode: factoryDeployTx.data,
        label: 'RemoteAccountFactory',
        mode: 'create2',
    });

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

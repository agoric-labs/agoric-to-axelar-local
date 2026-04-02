import '@nomicfoundation/hardhat-ethers';
import { ethers } from 'hardhat';

import { buildPermissionedSalt, buildSalt, deployViaCreateX, getCreateX } from './createx-utils';

export const deployRemoteAccountImplementation = async (
    createX: ReturnType<typeof getCreateX>,
    deployer: string,
    principalAccount: string,
) => {
    const RemoteAccountCF = await ethers.getContractFactory('RemoteAccount');
    const implRawSalt = buildSalt(ethers.solidityPacked(['string'], [principalAccount]));
    const implResult = await deployViaCreateX({
        createX,
        deployer,
        rawSalt: implRawSalt,
        initCode: RemoteAccountCF.bytecode,
        label: 'RemoteAccount',
        mode: 'create2',
    });
    return implResult;
};

export const deployRemoteAccountFactory = async (
    createX: ReturnType<typeof getCreateX>,
    deployer: string,
    principalCaip2: string,
    principalAccount: string,
    implAddress: string,
    vettingAuthority: string,
) => {
    const FactoryCF = await ethers.getContractFactory('RemoteAccountFactory');
    const factoryDeployTx = await FactoryCF.getDeployTransaction(
        principalCaip2,
        principalAccount,
        implAddress,
        vettingAuthority,
    );
    if (!factoryDeployTx.data) {
        throw new Error('Failed to encode RemoteAccountFactory initCode');
    }
    const factorySaltInput = ethers.solidityPacked(
        ['bytes', 'address', 'string'],
        [FactoryCF.bytecode, implAddress, principalAccount],
    );
    const factoryRawSalt = buildPermissionedSalt(deployer, factorySaltInput);
    const factoryResult = await deployViaCreateX({
        createX,
        deployer,
        rawSalt: factoryRawSalt,
        initCode: factoryDeployTx.data,
        label: 'RemoteAccountFactory',
        mode: 'create3',
    });

    return factoryResult;
};

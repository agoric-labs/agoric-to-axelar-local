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
    const [factoryDeployTx, saltData] = await Promise.all([
        FactoryCF.getDeployTransaction(
            principalCaip2,
            principalAccount,
            implAddress,
            vettingAuthority,
        ),
        FactoryCF.getDeployTransaction(
            principalCaip2,
            principalAccount,
            implAddress,
            ethers.ZeroAddress, // exclude vettingAuthority from salt
        ),
    ]);
    if (!factoryDeployTx.data || !saltData.data) {
        throw new Error('Failed to encode RemoteAccountFactory initCode');
    }
    const factoryRawSalt = buildPermissionedSalt(deployer, saltData.data);
    const factoryResult = await deployViaCreateX({
        createX,
        deployer,
        rawSalt: factoryRawSalt,
        initCode: factoryDeployTx.data,
        label: 'RemoteAccountFactory',
        mode: 'create3',
    });
    if (factoryResult.alreadyDeployed) {
        const factory = await ethers.getContractAt('RemoteAccountFactory', factoryResult.address);

        // NB: we don't need to check the implementation address or the principal account because those
        // are immutable and covered by the bytecode check in deployViaCreateX.
        // However we do need to check that any state derived from the mutable vetting authority has not
        // changed beyond the initial deployment state.
        const [existingPrincipalCaip2, existingVettingAuthority, numberOfAuthorizedRouters] =
            await Promise.all([
                factory.factoryPrincipalCaip2(),
                factory.vettingAuthority(),
                factory.numberOfAuthorizedRouters(),
            ]);
        // XXX: consider making the hash of this an immutable private var to bind it to the bytecode
        if (existingPrincipalCaip2 !== principalCaip2) {
            throw new Error(
                `Factory already deployed at ${factoryResult.address} has mismatching principal CAIP2\n` +
                    `  expected: ${principalCaip2}\n` +
                    `  got:      ${existingPrincipalCaip2}`,
            );
        }
        // This is mutable, we expect the deployer to check for inconsistencies
        if (existingVettingAuthority !== vettingAuthority) {
            console.warn(
                `Factory already deployed at ${factoryResult.address} has mismatching vetting authority\n` +
                    `  expected: ${vettingAuthority}\n` +
                    `  got:      ${existingVettingAuthority}`,
            );
        }
        if (numberOfAuthorizedRouters !== BigInt(0)) {
            console.warn(
                `Factory already deployed at ${factoryResult.address} has existing authorized routers\n` +
                    `  expected: 0\n` +
                    `  got:      ${numberOfAuthorizedRouters}`,
            );
        }
    }

    return factoryResult;
};

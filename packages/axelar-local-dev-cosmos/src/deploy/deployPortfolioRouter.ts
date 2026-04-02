import '@nomicfoundation/hardhat-ethers';
import { ethers } from 'hardhat';

import { buildPermissionedSalt, deployViaCreateX, getCreateX } from './createx-utils';

export const vetRouter = async (routerAddress: string, factoryAddress: string): Promise<void> => {
    const [deployer] = await ethers.getSigners();
    const factory = await ethers.getContractAt('RemoteAccountFactory', factoryAddress);

    const [status, numberOfRouters, vettingAuthority] = await Promise.all([
        factory.getRouterStatus(routerAddress),
        factory.numberOfAuthorizedRouters(),
        factory.vettingAuthority(),
    ]);

    console.log(`\nPost-deployment vetting:`);
    console.log(`  Router:            ${routerAddress}`);
    console.log(`  Status in factory: ${status}`);
    console.log(`  Authorized routers: ${numberOfRouters}`);
    console.log(`  Vetting authority: ${vettingAuthority}`);

    if (status !== BigInt(0)) {
        console.log('  Router status already set, skipping vetting.');
    } else if (vettingAuthority !== deployer.address) {
        console.warn('  Deployer is not the vetting authority. Skipping vetting.');
    } else if (numberOfRouters > BigInt(0)) {
        console.log('  Vetting router (not initial — must be enabled through an existing router).');
        const vetTx = await factory.vetRouter(routerAddress);
        const vetReceipt = await vetTx.wait(5);
        console.log(`  vetRouter tx: ${vetReceipt.hash} (status: ${vetReceipt.status})`);
    } else {
        console.log('  Vetting and enabling initial router.');
        const vetTx = await factory.vetInitialRouter(routerAddress);
        const vetReceipt = await vetTx.wait(5);
        console.log(`  vetInitialRouter tx: ${vetReceipt.hash} (status: ${vetReceipt.status})`);
    }
};

export const deployRemoteAccountAxelarRouter = async (
    createX: ReturnType<typeof getCreateX>,
    deployer: string,
    gateway: string,
    sourceChain: string,
    factory: string,
    permit2: string,
) => {
    const RouterCF = await ethers.getContractFactory('RemoteAccountAxelarRouter');
    const routerDeployTx = await RouterCF.getDeployTransaction(
        gateway,
        sourceChain,
        factory,
        permit2,
    );
    if (!routerDeployTx.data) {
        throw new Error('Failed to encode RemoteAccountAxelarRouter initCode');
    }
    // Hash bytecode + arguments under our control (source chain, factory).
    // Omit external arguments (gateway, permit2) that vary per chain.
    const saltInput = ethers.solidityPacked(
        ['bytes', 'string', 'address'],
        [RouterCF.bytecode, sourceChain, factory],
    );
    const rawSalt = buildPermissionedSalt(deployer, saltInput);
    const routerResult = await deployViaCreateX({
        createX,
        deployer,
        rawSalt,
        initCode: routerDeployTx.data,
        label: 'RemoteAccountAxelarRouter',
        mode: 'create3',
    });

    return routerResult;
};

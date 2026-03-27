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

const vetRouter = async (routerAddress: string, factoryAddress: string): Promise<void> => {
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

    if (status !== 0n) {
        console.log('  Router status already set, skipping vetting.');
    } else if (vettingAuthority !== deployer.address) {
        console.warn('  Deployer is not the vetting authority. Skipping vetting.');
    } else if (numberOfRouters > 0n) {
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

const main = async () => {
    const { GATEWAY_CONTRACT, AXELAR_SOURCE_CHAIN, FACTORY_CONTRACT, PERMIT2_CONTRACT } =
        process.env;
    if (!GATEWAY_CONTRACT || !AXELAR_SOURCE_CHAIN || !FACTORY_CONTRACT || !PERMIT2_CONTRACT) {
        throw new Error(
            'Missing env: GATEWAY_CONTRACT, AXELAR_SOURCE_CHAIN, FACTORY_CONTRACT, or PERMIT2_CONTRACT',
        );
    }
    if (!isAddress(GATEWAY_CONTRACT)) {
        throw new Error(`Invalid GATEWAY_CONTRACT: ${GATEWAY_CONTRACT}`);
    }
    if (!isAddress(FACTORY_CONTRACT)) {
        throw new Error(`Invalid FACTORY_CONTRACT: ${FACTORY_CONTRACT}`);
    }
    if (!isAddress(PERMIT2_CONTRACT)) {
        throw new Error(`Invalid PERMIT2_CONTRACT: ${PERMIT2_CONTRACT}`);
    }

    const [deployer] = await ethers.getSigners();
    const deployerAddress = await deployer.getAddress();
    const { chainId } = await ethers.provider.getNetwork();

    console.log(`\nCreateX CREATE3 Deploy — ${network.name} (${chainId})`);
    console.log(`  Deployer:          ${deployerAddress}`);
    console.log(`  Gateway:           ${GATEWAY_CONTRACT}`);
    console.log(`  Source Chain:      ${AXELAR_SOURCE_CHAIN}`);
    console.log(`  Factory:           ${FACTORY_CONTRACT}`);
    console.log(`  Permit2:           ${PERMIT2_CONTRACT}\n`);

    await validateCreateX();
    const createX = getCreateX(deployer);

    // Deploy RemoteAccountAxelarRouter via CREATE3
    console.log('RemoteAccountAxelarRouter:');
    const RouterCF = await ethers.getContractFactory('RemoteAccountAxelarRouter');
    const routerDeployTx = await RouterCF.getDeployTransaction(
        GATEWAY_CONTRACT,
        AXELAR_SOURCE_CHAIN,
        FACTORY_CONTRACT,
        PERMIT2_CONTRACT,
    );
    if (!routerDeployTx.data) {
        throw new Error('Failed to encode RemoteAccountAxelarRouter initCode');
    }
    // Use bytecode only (not full initCode) so the salt is chain-independent.
    // Constructor args include the gateway address which differs per chain,
    // but CREATE3 address depends only on deployer + salt, not initCode.
    const rawSalt = buildPermissionedSalt(deployerAddress, RouterCF.bytecode);
    const routerResult = await deployViaCreateX({
        createX,
        deployer: deployerAddress,
        rawSalt,
        initCode: routerDeployTx.data,
        label: 'RemoteAccountAxelarRouter',
        mode: 'create3',
    });

    // Verification
    await verifyOnExplorer({
        address: routerResult.address,
        constructorArgs: [
            GATEWAY_CONTRACT,
            AXELAR_SOURCE_CHAIN,
            FACTORY_CONTRACT,
            PERMIT2_CONTRACT,
        ],
        contract: 'src/contracts/RemoteAccountAxelarRouter.sol:RemoteAccountAxelarRouter',
    });

    // Vet router in factory
    await vetRouter(routerResult.address, FACTORY_CONTRACT);
};

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

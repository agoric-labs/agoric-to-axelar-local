import '@nomicfoundation/hardhat-ethers';
import { ethers, network } from 'hardhat';

const { isAddress } = ethers;

import { getCreateX, validateCreateX, verifyOnExplorer } from '../src/deploy/createx-utils.ts';
import { deployRemoteAccountAxelarRouter, vetRouter } from '../src/deploy/deployPortfolioRouter.ts';

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
    const routerResult = await deployRemoteAccountAxelarRouter(
        createX,
        deployerAddress,
        GATEWAY_CONTRACT,
        AXELAR_SOURCE_CHAIN,
        FACTORY_CONTRACT,
        PERMIT2_CONTRACT,
    );

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

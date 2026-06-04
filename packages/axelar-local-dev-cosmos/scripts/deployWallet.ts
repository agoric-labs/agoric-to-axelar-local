import '@nomicfoundation/hardhat-ethers';
import { ethers, network } from 'hardhat';

const { isAddress } = ethers;

import { verifyOnExplorer } from '../src/deploy/createx-utils.ts';

const main = async () => {
    const { GATEWAY_CONTRACT, GAS_SERVICE_CONTRACT, OWNER_ADDRESS } = process.env;
    if (!GATEWAY_CONTRACT || !GAS_SERVICE_CONTRACT || !OWNER_ADDRESS) {
        throw new Error(
            'Missing env: GATEWAY_CONTRACT, GAS_SERVICE_CONTRACT, or OWNER_ADDRESS',
        );
    }
    if (!isAddress(GATEWAY_CONTRACT)) {
        throw new Error(`Invalid GATEWAY_CONTRACT: ${GATEWAY_CONTRACT}`);
    }
    if (!isAddress(GAS_SERVICE_CONTRACT)) {
        throw new Error(`Invalid GAS_SERVICE_CONTRACT: ${GAS_SERVICE_CONTRACT}`);
    }
    if (!OWNER_ADDRESS.startsWith('agoric1')) {
        throw new Error(`Expected an Agoric bech32 owner, got: ${OWNER_ADDRESS}`);
    }

    const [deployer] = await ethers.getSigners();
    const deployerAddress = await deployer.getAddress();
    const { chainId } = await ethers.provider.getNetwork();

    console.log(`\nWallet Deploy — ${network.name} (${chainId})`);
    console.log(`  Deployer:     ${deployerAddress}`);
    console.log(`  Gateway:      ${GATEWAY_CONTRACT}`);
    console.log(`  Gas Service:  ${GAS_SERVICE_CONTRACT}`);
    console.log(`  Owner:        ${OWNER_ADDRESS}\n`);

    const WalletCF = await ethers.getContractFactory('Wallet', deployer);
    const wallet = await WalletCF.deploy(
        GATEWAY_CONTRACT,
        GAS_SERVICE_CONTRACT,
        OWNER_ADDRESS,
    );
    await wallet.waitForDeployment();
    const address = await wallet.getAddress();
    console.log(`  Deployed Wallet at: ${address}\n`);

    await verifyOnExplorer({
        address,
        constructorArgs: [GATEWAY_CONTRACT, GAS_SERVICE_CONTRACT, OWNER_ADDRESS],
        contract: 'src/contracts/Wallet.sol:Wallet',
    });
};

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

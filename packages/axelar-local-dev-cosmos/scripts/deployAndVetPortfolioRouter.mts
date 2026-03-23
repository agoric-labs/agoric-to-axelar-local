import hre from 'hardhat';
import PortfolioRouter from '../ignition/modules/deployPortfolioRouter.ts';

async function main() {
    // This will NOT re-deploy if already on-chain; it just returns the existing instance.
    const { RemoteAccountAxelarRouter } = await hre.ignition.deploy(PortfolioRouter);

    const [deployer] = await hre.ethers.getSigners();

    const routerAddress = await RemoteAccountAxelarRouter.getAddress();
    const factoryAddress = await RemoteAccountAxelarRouter.factory();
    const factory = await hre.ethers.getContractAt('RemoteAccountFactory', factoryAddress);

    const [status, numberOfRouters, vettingAuthority] = await Promise.all([
        factory.getRouterStatus(routerAddress),
        factory.numberOfAuthorizedRouters(),
        factory.vettingAuthority(),
    ]);

    console.log(`Post-deployment of Portfolio Router at ${routerAddress}:`);
    console.log(`Status in factory: ${status}`);
    console.log(`Number of Authorized Routers in factory: ${numberOfRouters}`);
    console.log(`Vetting Authority: ${vettingAuthority}`);
    console.log(`Deployer address: ${deployer.address}`);

    if (status !== 0n) {
        console.log('Router status already set, skipping vetting.');
    } else if (vettingAuthority !== deployer.address) {
        console.warn('Deployer is not the vetting authority. Skipping vetting deployed router.');
    } else if (numberOfRouters > 0n) {
        console.log(
            'Vetting router. This is not the initial router, it must be enabled through an existing router.',
        );
        await factory.vetRouter(routerAddress);
    } else {
        console.log('Vetting and enabling initial router.');
        await factory.vetInitialRouter(routerAddress);
    }
}

await main();

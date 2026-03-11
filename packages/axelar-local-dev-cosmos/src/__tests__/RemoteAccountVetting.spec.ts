import AxelarGasService from '@axelar-network/axelar-cgp-solidity/artifacts/contracts/gas-service/AxelarGasService.sol/AxelarGasService.json';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { ethers } from 'hardhat';
import '@nomicfoundation/hardhat-chai-matchers';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { routed, deployRemoteAccountFactory } from './lib/utils';

describe('RemoteAccountAxelarRouter - Vetting and Authorization', () => {
    let owner: HardhatEthersSigner, addr1: HardhatEthersSigner;
    let axelarGatewayMock: Contract;
    let factory: Contract, router: Contract, permit2Mock: Contract;

    const abiCoder = new ethers.AbiCoder();

    const sourceChain = 'agoric';
    const portfolioContractCaip2 = 'cosmos:agoric-3';
    const portfolioContractAccount = 'agoric1routerlca123456789abcdefghijklmnopqrs';

    let route: ReturnType<typeof routed>;
    let routeConfig: Parameters<typeof routed>[1];

    before(async () => {
        [owner, addr1] = await ethers.getSigners();

        const GasServiceFactory = await ethers.getContractFactory(
            AxelarGasService.abi,
            AxelarGasService.bytecode,
        );
        await GasServiceFactory.deploy(owner.address);

        const TokenDeployerFactory = await ethers.getContractFactory('TokenDeployer');
        const tokenDeployer = await TokenDeployerFactory.deploy();

        const AuthFactory = await ethers.getContractFactory('AxelarAuthWeighted');
        const authContract = await AuthFactory.deploy([
            abiCoder.encode(['address[]', 'uint256[]', 'uint256'], [[owner.address], [1], 1]),
        ]);

        const AxelarGatewayFactory = await ethers.getContractFactory('AxelarGateway');
        axelarGatewayMock = await AxelarGatewayFactory.deploy(
            authContract.target,
            tokenDeployer.target,
        );

        const MockPermit2Factory = await ethers.getContractFactory('MockPermit2');
        permit2Mock = await MockPermit2Factory.deploy();

        factory = await deployRemoteAccountFactory(
            portfolioContractCaip2,
            portfolioContractAccount,
        );

        const RouterContract = await ethers.getContractFactory('RemoteAccountAxelarRouter');
        router = await RouterContract.deploy(
            axelarGatewayMock.target,
            sourceChain,
            factory.target,
            permit2Mock.target,
            owner.address,
        );
        await router.waitForDeployment();

        await factory.getFunction('vetRouter')(router.target);
        await factory.getFunction('transferOwnership')(router.target);

        routeConfig = {
            sourceChain,
            owner,
            portfolioContractAccount,
            AxelarGateway: axelarGatewayMock,
            abiCoder,
        };
        route = routed(router, routeConfig);
    });

    // ==================== Vetting ====================

    it('should vet a router and emit RouterVetted event', async () => {
        const RouterContract = await ethers.getContractFactory('RemoteAccountAxelarRouter');
        const newRouter = await RouterContract.deploy(
            axelarGatewayMock.target,
            sourceChain,
            factory.target,
            permit2Mock.target,
            owner.address,
        );
        await newRouter.waitForDeployment();

        await expect(router.getFunction('vetRouter')(newRouter.target))
            .to.emit(router, 'RouterVetted')
            .withArgs(newRouter.target);

        // Vetted but not yet enabled — not authorized
        expect(await factory.getFunction('isAuthorizedCaller')(newRouter.target)).to.equal(false);
    });

    it('should reject vetRouter from non-owner', async () => {
        await expect(
            router.connect(addr1).getFunction('vetRouter')(addr1.address),
        ).to.be.revertedWithCustomError(router, 'OwnableUnauthorizedAccount');
    });

    // ==================== Enabling ====================

    it('should enable a vetted router via GMP and emit RouterEnabled', async () => {
        const RouterContract = await ethers.getContractFactory('RemoteAccountAxelarRouter');
        const newRouter = await RouterContract.deploy(
            axelarGatewayMock.target,
            sourceChain,
            factory.target,
            permit2Mock.target,
            owner.address,
        );
        await newRouter.waitForDeployment();

        // Vet first
        await router.getFunction('vetRouter')(newRouter.target);
        expect(await factory.getFunction('isAuthorizedCaller')(newRouter.target)).to.equal(false);

        // Enable via GMP from factory principal
        const receipt = await route(portfolioContractAccount).doEnableRouter({
            router: newRouter.target as `0x${string}`,
        });
        receipt.expectOperationSuccess();

        // Now authorized
        expect(await factory.getFunction('isAuthorizedCaller')(newRouter.target)).to.equal(true);
    });

    it('should reject enabling an un-vetted router', async () => {
        const unvetted = addr1.address;

        const receipt = await route(portfolioContractAccount).doEnableRouter({
            router: unvetted as `0x${string}`,
        });
        const decodedError = receipt.parseOperationError(factory.interface);
        expect(decodedError?.name).to.equal('RouterNotVetted');
    });

    it('should reject enableRouter from non-factory-principal', async () => {
        const RouterContract = await ethers.getContractFactory('RemoteAccountAxelarRouter');
        const newRouter = await RouterContract.deploy(
            axelarGatewayMock.target,
            sourceChain,
            factory.target,
            permit2Mock.target,
            owner.address,
        );
        await newRouter.waitForDeployment();
        await router.getFunction('vetRouter')(newRouter.target);

        // Non-principal LCA resolves to a remote account address (not factory),
        // so the router rejects with UnauthorizedCaller before reaching the principal check
        const nonPrincipalLCA = 'agoric1notprincipal12345678901234abcde';
        const receipt = await route(nonPrincipalLCA).doEnableRouter({
            router: newRouter.target as `0x${string}`,
        });
        const decodedError = receipt.parseOperationError(router.interface);
        expect(decodedError?.name).to.equal('UnauthorizedCaller');
    });

    // ==================== Disabling ====================

    it('should disable an enabled router via GMP', async () => {
        const RouterContract = await ethers.getContractFactory('RemoteAccountAxelarRouter');
        const newRouter = await RouterContract.deploy(
            axelarGatewayMock.target,
            sourceChain,
            factory.target,
            permit2Mock.target,
            owner.address,
        );
        await newRouter.waitForDeployment();

        // Vet and enable
        await router.getFunction('vetRouter')(newRouter.target);
        (
            await route(portfolioContractAccount).doEnableRouter({
                router: newRouter.target as `0x${string}`,
            })
        ).expectOperationSuccess();
        expect(await factory.getFunction('isAuthorizedCaller')(newRouter.target)).to.equal(true);

        // Disable via GMP
        const receipt = await route(portfolioContractAccount).doDisableRouter({
            router: newRouter.target as `0x${string}`,
        });
        receipt.expectOperationSuccess();

        // No longer authorized
        expect(await factory.getFunction('isAuthorizedCaller')(newRouter.target)).to.equal(false);
    });

    it('should reject disableRouter from non-factory-principal', async () => {
        // Non-principal LCA resolves to a remote account address (not factory),
        // so the router rejects with UnauthorizedCaller
        const nonPrincipalLCA = 'agoric1notprincipal12345678901234abcde';
        const receipt = await route(nonPrincipalLCA).doDisableRouter({
            router: addr1.address as `0x${string}`,
        });
        const decodedError = receipt.parseOperationError(router.interface);
        expect(decodedError?.name).to.equal('UnauthorizedCaller');
    });

    // ==================== Revoking ====================

    it('should revoke a disabled router and emit RouterRevoked', async () => {
        const RouterContract = await ethers.getContractFactory('RemoteAccountAxelarRouter');
        const newRouter = await RouterContract.deploy(
            axelarGatewayMock.target,
            sourceChain,
            factory.target,
            permit2Mock.target,
            owner.address,
        );
        await newRouter.waitForDeployment();

        // Vet, enable, then disable
        await router.getFunction('vetRouter')(newRouter.target);
        (
            await route(portfolioContractAccount).doEnableRouter({
                router: newRouter.target as `0x${string}`,
            })
        ).expectOperationSuccess();
        (
            await route(portfolioContractAccount).doDisableRouter({
                router: newRouter.target as `0x${string}`,
            })
        ).expectOperationSuccess();

        // Revoke
        await expect(router.getFunction('revokeRouter')(newRouter.target))
            .to.emit(router, 'RouterRevoked')
            .withArgs(newRouter.target);
    });

    it('should reject revoking a router that is still enabled', async () => {
        const RouterContract = await ethers.getContractFactory('RemoteAccountAxelarRouter');
        const newRouter = await RouterContract.deploy(
            axelarGatewayMock.target,
            sourceChain,
            factory.target,
            permit2Mock.target,
            owner.address,
        );
        await newRouter.waitForDeployment();

        // Vet and enable
        await router.getFunction('vetRouter')(newRouter.target);
        (
            await route(portfolioContractAccount).doEnableRouter({
                router: newRouter.target as `0x${string}`,
            })
        ).expectOperationSuccess();

        // Try to revoke without disabling first
        await expect(
            router.getFunction('revokeRouter')(newRouter.target),
        ).to.be.revertedWithCustomError(factory, 'RouterStillEnabled');
    });

    it('should reject revokeRouter from non-owner', async () => {
        await expect(
            router.connect(addr1).getFunction('revokeRouter')(addr1.address),
        ).to.be.revertedWithCustomError(router, 'OwnableUnauthorizedAccount');
    });

    // ==================== isAuthorizedCaller ====================

    it('should return true for factory owner', async () => {
        expect(await factory.getFunction('isAuthorizedCaller')(router.target)).to.equal(true);
    });

    it('should return false for random address', async () => {
        expect(await factory.getFunction('isAuthorizedCaller')(addr1.address)).to.equal(false);
    });

    it('should return true for enabled router and false after disabling', async () => {
        const RouterContract = await ethers.getContractFactory('RemoteAccountAxelarRouter');
        const newRouter = await RouterContract.deploy(
            axelarGatewayMock.target,
            sourceChain,
            factory.target,
            permit2Mock.target,
            owner.address,
        );
        await newRouter.waitForDeployment();

        // Not authorized initially
        expect(await factory.getFunction('isAuthorizedCaller')(newRouter.target)).to.equal(false);

        // Vet — still not authorized
        await router.getFunction('vetRouter')(newRouter.target);
        expect(await factory.getFunction('isAuthorizedCaller')(newRouter.target)).to.equal(false);

        // Enable — now authorized
        (
            await route(portfolioContractAccount).doEnableRouter({
                router: newRouter.target as `0x${string}`,
            })
        ).expectOperationSuccess();
        expect(await factory.getFunction('isAuthorizedCaller')(newRouter.target)).to.equal(true);

        // Disable — no longer authorized
        (
            await route(portfolioContractAccount).doDisableRouter({
                router: newRouter.target as `0x${string}`,
            })
        ).expectOperationSuccess();
        expect(await factory.getFunction('isAuthorizedCaller')(newRouter.target)).to.equal(false);
    });

    // ==================== Full lifecycle ====================

    it('should support full vet → enable → operate → disable → revoke lifecycle', async () => {
        const RouterContract = await ethers.getContractFactory('RemoteAccountAxelarRouter');
        const expRouter = await RouterContract.deploy(
            axelarGatewayMock.target,
            sourceChain,
            factory.target,
            permit2Mock.target,
            owner.address,
        );
        await expRouter.waitForDeployment();

        // 1. Vet (off-chain admin)
        await router.getFunction('vetRouter')(expRouter.target);

        // 2. Enable (Agoric chain via GMP)
        (
            await route(portfolioContractAccount).doEnableRouter({
                router: expRouter.target as `0x${string}`,
            })
        ).expectOperationSuccess();

        // 3. Operate — experimental router can create and use accounts
        const expRoute = routed(expRouter, routeConfig);
        const lca = 'agoric1lifecycletest12345678901234abcde';
        (await expRoute(lca).doRemoteAccountExecute({ multiCalls: [] })).expectOperationSuccess();

        // 4. Disable (Agoric chain via GMP)
        (
            await route(portfolioContractAccount).doDisableRouter({
                router: expRouter.target as `0x${string}`,
            })
        ).expectOperationSuccess();

        // Experimental router can no longer operate
        const lca2 = 'agoric1lifecycletest2345678901234abcdef';
        const failReceipt = await expRoute(lca2).doRemoteAccountExecute({ multiCalls: [] });
        const decodedError = failReceipt.parseOperationError(factory.interface);
        expect(decodedError?.name).to.equal('UnauthorizedCaller');

        // 5. Revoke (off-chain admin)
        await router.getFunction('revokeRouter')(expRouter.target);

        // Cannot re-enable without vetting again
        const reEnableReceipt = await route(portfolioContractAccount).doEnableRouter({
            router: expRouter.target as `0x${string}`,
        });
        const reEnableError = reEnableReceipt.parseOperationError(factory.interface);
        expect(reEnableError?.name).to.equal('RouterNotVetted');
    });
});

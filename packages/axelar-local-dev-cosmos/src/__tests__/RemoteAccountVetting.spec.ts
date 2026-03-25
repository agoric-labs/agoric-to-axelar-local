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
            owner.address,
        );

        const RouterContract = await ethers.getContractFactory('RemoteAccountAxelarRouter');
        router = await RouterContract.deploy(
            axelarGatewayMock.target,
            sourceChain,
            factory.target,
            permit2Mock.target,
        );
        await router.waitForDeployment();

        await factory.getFunction('vetInitialRouter')(router.target);

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
        );
        await newRouter.waitForDeployment();

        await expect(factory.getFunction('vetRouter')(newRouter.target))
            .to.emit(factory, 'RouterVetted')
            .withArgs(newRouter.target);

        // Vetted but not yet enabled — not authorized
        expect(await factory.getFunction('isAuthorizedRouter')(newRouter.target)).to.equal(false);
    });

    it('should reject vetRouter from non-vetting-authority', async () => {
        await expect(
            factory.connect(addr1).getFunction('vetRouter')(addr1.address),
        ).to.be.revertedWithCustomError(factory, 'UnauthorizedCaller');
    });

    it('should reject vetInitialRouter after a router is already authorized', async () => {
        const RouterContract = await ethers.getContractFactory('RemoteAccountAxelarRouter');
        const newRouter = await RouterContract.deploy(
            axelarGatewayMock.target,
            sourceChain,
            factory.target,
            permit2Mock.target,
        );
        await newRouter.waitForDeployment();

        await expect(
            factory.getFunction('vetInitialRouter')(newRouter.target),
        ).to.be.revertedWithCustomError(factory, 'UnauthorizedCaller');
    });

    // ==================== Authorization ====================

    it('should authorize a vetted router via GMP and emit RouterAuthorized', async () => {
        const RouterContract = await ethers.getContractFactory('RemoteAccountAxelarRouter');
        const newRouter = await RouterContract.deploy(
            axelarGatewayMock.target,
            sourceChain,
            factory.target,
            permit2Mock.target,
        );
        await newRouter.waitForDeployment();

        const initialAuthorizedRouters = await factory.getFunction('numberOfAuthorizedRouters')();

        // Vet first
        await factory.getFunction('vetRouter')(newRouter.target);
        expect(await factory.getFunction('isAuthorizedRouter')(newRouter.target)).to.equal(false);
        expect(await factory.getFunction('numberOfAuthorizedRouters')()).to.equal(
            initialAuthorizedRouters,
        );

        // Authorize via GMP from factory principal
        const receipt = await route(portfolioContractAccount).doAuthorizeRouter({
            router: newRouter.target as `0x${string}`,
        });
        receipt.expectOperationSuccess();

        // Now authorized
        expect(await factory.getFunction('isAuthorizedRouter')(newRouter.target)).to.equal(true);
        expect(await factory.getFunction('numberOfAuthorizedRouters')()).to.equal(
            initialAuthorizedRouters + 1n,
        );
    });

    it('should reject authorizing an un-vetted router', async () => {
        const unvetted = addr1.address;

        const receipt = await route(portfolioContractAccount).doAuthorizeRouter({
            router: unvetted as `0x${string}`,
        });
        const decodedError = receipt.parseOperationError(factory.interface);
        expect(decodedError?.name).to.equal('RouterNotVetted');
    });

    it('should reject authorizeRouter from non-factory-principal', async () => {
        const RouterContract = await ethers.getContractFactory('RemoteAccountAxelarRouter');
        const newRouter = await RouterContract.deploy(
            axelarGatewayMock.target,
            sourceChain,
            factory.target,
            permit2Mock.target,
        );
        await newRouter.waitForDeployment();
        await factory.getFunction('vetRouter')(newRouter.target);

        // Non-principal LCA resolves to a remote account address (not factory),
        // so the router rejects with UnauthorizedCaller before reaching the principal check
        const nonPrincipalLCA = 'agoric1notprincipal12345678901234abcde';
        const receipt = await route(nonPrincipalLCA).doAuthorizeRouter({
            router: newRouter.target as `0x${string}`,
        });
        const decodedError = receipt.parseOperationError(router.interface);
        expect(decodedError?.name).to.equal('UnauthorizedCaller');
    });

    // ==================== Deauthorization ====================

    it('should deauthorize an authorized router via GMP', async () => {
        const RouterContract = await ethers.getContractFactory('RemoteAccountAxelarRouter');
        const newRouter = await RouterContract.deploy(
            axelarGatewayMock.target,
            sourceChain,
            factory.target,
            permit2Mock.target,
        );
        await newRouter.waitForDeployment();

        const initialAuthorizedRouters = await factory.getFunction('numberOfAuthorizedRouters')();

        // Vet and authorize
        await factory.getFunction('vetRouter')(newRouter.target);
        (
            await route(portfolioContractAccount).doAuthorizeRouter({
                router: newRouter.target as `0x${string}`,
            })
        ).expectOperationSuccess();
        expect(await factory.getFunction('isAuthorizedRouter')(newRouter.target)).to.equal(true);
        expect(await factory.getFunction('numberOfAuthorizedRouters')()).to.equal(
            initialAuthorizedRouters + 1n,
        );

        // Deauthorize via GMP
        const receipt = await route(portfolioContractAccount).doDeauthorizeRouter({
            router: newRouter.target as `0x${string}`,
        });
        receipt.expectOperationSuccess();

        // No longer authorized
        expect(await factory.getFunction('isAuthorizedRouter')(newRouter.target)).to.equal(false);
        expect(await factory.getFunction('numberOfAuthorizedRouters')()).to.equal(
            initialAuthorizedRouters,
        );
    });

    it('should reject deauthorizeRouter from non-factory-principal', async () => {
        // Non-principal LCA resolves to a remote account address (not factory),
        // so the router rejects with UnauthorizedCaller
        const nonPrincipalLCA = 'agoric1notprincipal12345678901234abcde';
        const receipt = await route(nonPrincipalLCA).doDeauthorizeRouter({
            router: addr1.address as `0x${string}`,
        });
        const decodedError = receipt.parseOperationError(router.interface);
        expect(decodedError?.name).to.equal('UnauthorizedCaller');
    });

    // ==================== Unvetting ====================

    it('should unvet a deauthorized router and keep vet / authorize / deauthorize / unvet idempotent', async () => {
        const RouterContract = await ethers.getContractFactory('RemoteAccountAxelarRouter');
        const newRouter = await RouterContract.deploy(
            axelarGatewayMock.target,
            sourceChain,
            factory.target,
            permit2Mock.target,
        );
        await newRouter.waitForDeployment();

        const initialAuthorizedRouters = await factory.getFunction('numberOfAuthorizedRouters')();

        // Vet is idempotent
        await expect(factory.getFunction('vetRouter')(newRouter.target))
            .to.emit(factory, 'RouterVetted')
            .withArgs(newRouter.target);
        expect(await factory.getFunction('isAuthorizedRouter')(newRouter.target)).to.equal(false);
        expect(await factory.getFunction('numberOfAuthorizedRouters')()).to.equal(
            initialAuthorizedRouters,
        );

        await factory.getFunction('vetRouter')(newRouter.target);
        expect(await factory.getFunction('isAuthorizedRouter')(newRouter.target)).to.equal(false);
        expect(await factory.getFunction('numberOfAuthorizedRouters')()).to.equal(
            initialAuthorizedRouters,
        );

        // Authorize is idempotent
        (
            await route(portfolioContractAccount).doAuthorizeRouter({
                router: newRouter.target as `0x${string}`,
            })
        ).expectOperationSuccess();
        expect(await factory.getFunction('isAuthorizedRouter')(newRouter.target)).to.equal(true);
        expect(await factory.getFunction('numberOfAuthorizedRouters')()).to.equal(
            initialAuthorizedRouters + 1n,
        );

        (
            await route(portfolioContractAccount).doAuthorizeRouter({
                router: newRouter.target as `0x${string}`,
            })
        ).expectOperationSuccess();
        expect(await factory.getFunction('isAuthorizedRouter')(newRouter.target)).to.equal(true);
        expect(await factory.getFunction('numberOfAuthorizedRouters')()).to.equal(
            initialAuthorizedRouters + 1n,
        );

        // Deauthorize is idempotent
        (
            await route(portfolioContractAccount).doDeauthorizeRouter({
                router: newRouter.target as `0x${string}`,
            })
        ).expectOperationSuccess();
        expect(await factory.getFunction('isAuthorizedRouter')(newRouter.target)).to.equal(false);
        expect(await factory.getFunction('numberOfAuthorizedRouters')()).to.equal(
            initialAuthorizedRouters,
        );

        (
            await route(portfolioContractAccount).doDeauthorizeRouter({
                router: newRouter.target as `0x${string}`,
            })
        ).expectOperationSuccess();
        expect(await factory.getFunction('isAuthorizedRouter')(newRouter.target)).to.equal(false);
        expect(await factory.getFunction('numberOfAuthorizedRouters')()).to.equal(
            initialAuthorizedRouters,
        );

        // Unvet is idempotent
        await expect(factory.getFunction('unvetRouter')(newRouter.target))
            .to.emit(factory, 'RouterUnvetted')
            .withArgs(newRouter.target);
        expect(await factory.getFunction('isAuthorizedRouter')(newRouter.target)).to.equal(false);
        expect(await factory.getFunction('numberOfAuthorizedRouters')()).to.equal(
            initialAuthorizedRouters,
        );

        await factory.getFunction('unvetRouter')(newRouter.target);
        expect(await factory.getFunction('isAuthorizedRouter')(newRouter.target)).to.equal(false);
        expect(await factory.getFunction('numberOfAuthorizedRouters')()).to.equal(
            initialAuthorizedRouters,
        );
    });

    it('should reject unvetting a router that is still authorized', async () => {
        const RouterContract = await ethers.getContractFactory('RemoteAccountAxelarRouter');
        const newRouter = await RouterContract.deploy(
            axelarGatewayMock.target,
            sourceChain,
            factory.target,
            permit2Mock.target,
        );
        await newRouter.waitForDeployment();

        // Vet and authorize
        await factory.getFunction('vetRouter')(newRouter.target);
        (
            await route(portfolioContractAccount).doAuthorizeRouter({
                router: newRouter.target as `0x${string}`,
            })
        ).expectOperationSuccess();

        // Try to unvet without deauthorizing first
        await expect(
            factory.getFunction('unvetRouter')(newRouter.target),
        ).to.be.revertedWithCustomError(factory, 'RouterNotVetted');
    });

    it('should reject unvetRouter from non-vetting-authority', async () => {
        await expect(
            factory.connect(addr1).getFunction('unvetRouter')(addr1.address),
        ).to.be.revertedWithCustomError(factory, 'UnauthorizedCaller');
    });

    // ==================== isAuthorizedRouter ====================

    it('should return true for factory owner', async () => {
        expect(await factory.getFunction('isAuthorizedRouter')(router.target)).to.equal(true);
    });

    it('should return false for random address', async () => {
        expect(await factory.getFunction('isAuthorizedRouter')(addr1.address)).to.equal(false);
    });

    it('should return true for authorized router and false after deauthorizing', async () => {
        const RouterContract = await ethers.getContractFactory('RemoteAccountAxelarRouter');
        const newRouter = await RouterContract.deploy(
            axelarGatewayMock.target,
            sourceChain,
            factory.target,
            permit2Mock.target,
        );
        await newRouter.waitForDeployment();

        // Not authorized initially
        expect(await factory.getFunction('isAuthorizedRouter')(newRouter.target)).to.equal(false);

        // Vet — still not authorized
        await factory.getFunction('vetRouter')(newRouter.target);
        expect(await factory.getFunction('isAuthorizedRouter')(newRouter.target)).to.equal(false);

        // Authorize — now authorized
        (
            await route(portfolioContractAccount).doAuthorizeRouter({
                router: newRouter.target as `0x${string}`,
            })
        ).expectOperationSuccess();
        expect(await factory.getFunction('isAuthorizedRouter')(newRouter.target)).to.equal(true);

        // Deauthorize — no longer authorized
        (
            await route(portfolioContractAccount).doDeauthorizeRouter({
                router: newRouter.target as `0x${string}`,
            })
        ).expectOperationSuccess();
        expect(await factory.getFunction('isAuthorizedRouter')(newRouter.target)).to.equal(false);
    });

    // ==================== Full lifecycle ====================

    it('should support full vet → authorize → operate → deauthorize → unvet lifecycle', async () => {
        const RouterContract = await ethers.getContractFactory('RemoteAccountAxelarRouter');
        const expRouter = await RouterContract.deploy(
            axelarGatewayMock.target,
            sourceChain,
            factory.target,
            permit2Mock.target,
        );
        await expRouter.waitForDeployment();

        // 1. Vet (vetting authority)
        await factory.getFunction('vetRouter')(expRouter.target);

        // 2. Authorize (Agoric chain via GMP)
        (
            await route(portfolioContractAccount).doAuthorizeRouter({
                router: expRouter.target as `0x${string}`,
            })
        ).expectOperationSuccess();

        // 3. Operate — experimental router can create and use accounts
        const expRoute = routed(expRouter, routeConfig);
        const lca = 'agoric1lifecycletest12345678901234abcde';
        (await expRoute(lca).doRemoteAccountExecute({ multiCalls: [] })).expectOperationSuccess();

        // 4. Deauthorize (Agoric chain via GMP)
        (
            await route(portfolioContractAccount).doDeauthorizeRouter({
                router: expRouter.target as `0x${string}`,
            })
        ).expectOperationSuccess();

        // Experimental router can no longer operate (must include a call to trigger auth check)
        const noopCall = {
            target: factory.target as `0x${string}`,
            data: '0x' as `0x${string}`,
            value: 0n,
            gasLimit: 0n,
        };
        const failReceipt = await expRoute(lca).doRemoteAccountExecute({ multiCalls: [noopCall] });
        const decodedError = failReceipt.parseOperationError(factory.interface);
        expect(decodedError?.name).to.equal('UnauthorizedCaller');

        // 5. Unvet (vetting authority)
        await factory.getFunction('unvetRouter')(expRouter.target);

        // Cannot re-authorize without vetting again
        const reAuthorizeReceipt = await route(portfolioContractAccount).doAuthorizeRouter({
            router: expRouter.target as `0x${string}`,
        });
        const reAuthorizeError = reAuthorizeReceipt.parseOperationError(factory.interface);
        expect(reAuthorizeError?.name).to.equal('RouterNotVetted');
    });

    // ==================== Vetting Authority Transfer ====================
    // NOTE: These tests are ordered carefully. The "propose" and "reject"
    // tests run first (non-mutating or self-contained), then the successful
    // confirm test transfers authority to addr1, and subsequent tests
    // operate under that new authority.

    it('should reject proposeVettingAuthorityTransfer from non-vetting-authority', async () => {
        await expect(
            factory.connect(addr1).getFunction('proposeVettingAuthorityTransfer')(addr1.address),
        ).to.be.revertedWithCustomError(factory, 'UnauthorizedCaller');
    });

    it('should reject confirmVettingAuthorityTransfer when nothing was proposed', async () => {
        const receipt = await route(portfolioContractAccount).doConfirmVettingAuthority({
            authority: addr1.address as `0x${string}`,
        });
        const decodedError = receipt.parseOperationError(factory.interface);
        expect(decodedError?.name).to.equal('InvalidVettingAuthority');
    });

    it('should propose vetting authority transfer and emit VettingAuthorityTransferProposed', async () => {
        await expect(factory.getFunction('proposeVettingAuthorityTransfer')(addr1.address))
            .to.emit(factory, 'VettingAuthorityTransferProposed')
            .withArgs(owner.address, addr1.address);
    });

    it('should reject confirmVettingAuthorityTransfer with wrong address', async () => {
        // Previous test proposed addr1; try to confirm with owner instead
        const receipt = await route(portfolioContractAccount).doConfirmVettingAuthority({
            authority: owner.address as `0x${string}`,
        });
        const decodedError = receipt.parseOperationError(factory.interface);
        expect(decodedError?.name).to.equal('InvalidVettingAuthority');
    });

    it('should reject confirmVettingAuthorityTransfer from non-factory-principal', async () => {
        // addr1 is still the pending authority from the propose test
        const nonPrincipalLCA = 'agoric1notprincipal12345678901234abcde';
        const receipt = await route(nonPrincipalLCA).doConfirmVettingAuthority({
            authority: addr1.address as `0x${string}`,
        });
        const decodedError = receipt.parseOperationError(router.interface);
        expect(decodedError?.name).to.equal('UnauthorizedCaller');
    });

    it('should confirm vetting authority transfer via GMP and emit VettingAuthorityTransferred', async () => {
        // addr1 is still pending from the propose test above
        const receipt = await route(portfolioContractAccount).doConfirmVettingAuthority({
            authority: addr1.address as `0x${string}`,
        });
        receipt.expectOperationSuccess();

        // Verify the vetting authority has changed
        expect(await factory.getFunction('vettingAuthority')()).to.equal(addr1.address);
    });

    it('should allow new vetting authority to vet routers after transfer', async () => {
        // Authority was transferred to addr1 by the previous test
        const RouterContract = await ethers.getContractFactory('RemoteAccountAxelarRouter');
        const newRouter = await RouterContract.deploy(
            axelarGatewayMock.target,
            sourceChain,
            factory.target,
            permit2Mock.target,
        );
        await newRouter.waitForDeployment();

        await expect(factory.connect(addr1).getFunction('vetRouter')(newRouter.target))
            .to.emit(factory, 'RouterVetted')
            .withArgs(newRouter.target);

        // Old vetting authority (owner) can no longer vet
        const anotherRouter = await RouterContract.deploy(
            axelarGatewayMock.target,
            sourceChain,
            factory.target,
            permit2Mock.target,
        );
        await anotherRouter.waitForDeployment();

        await expect(
            factory.connect(owner).getFunction('vetRouter')(anotherRouter.target),
        ).to.be.revertedWithCustomError(factory, 'UnauthorizedCaller');
    });
});

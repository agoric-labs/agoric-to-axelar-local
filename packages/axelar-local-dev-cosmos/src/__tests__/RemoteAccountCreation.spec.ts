import AxelarGasService from '@axelar-network/axelar-cgp-solidity/artifacts/contracts/gas-service/AxelarGasService.sol/AxelarGasService.json';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { ethers } from 'hardhat';
import '@nomicfoundation/hardhat-chai-matchers';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import * as helpers from '@nomicfoundation/hardhat-network-helpers';
import { routed, deployRemoteAccountFactory } from './lib/utils';

describe('RemoteAccountAxelarRouter - RemoteAccountCreation', () => {
    let owner: HardhatEthersSigner, addr1: HardhatEthersSigner;
    let axelarGatewayMock: Contract, axelarGasServiceMock: Contract;
    let factory: Contract, router: Contract, permit2Mock: Contract;

    const abiCoder = new ethers.AbiCoder();

    const sourceChain = 'agoric';
    const portfolioContractCaip2 = 'cosmos:agoric-3';
    const portfolioContractAccount = 'agoric1routerlca123456789abcdefghijklmnopqrs';
    const portfolioLCA = 'agoric1portfolio123456789abcdefghijklmnopqrs';

    let route: ReturnType<typeof routed>;
    let routeConfig: Parameters<typeof routed>[1];

    before(async () => {
        [owner, addr1] = await ethers.getSigners();

        // Deploy Axelar Gas Service
        const GasServiceFactory = await ethers.getContractFactory(
            AxelarGasService.abi,
            AxelarGasService.bytecode,
        );
        axelarGasServiceMock = await GasServiceFactory.deploy(owner.address);

        // Deploy Token Deployer
        const TokenDeployerFactory = await ethers.getContractFactory('TokenDeployer');
        const tokenDeployer = await TokenDeployerFactory.deploy();

        // Deploy Auth Contract
        const AuthFactory = await ethers.getContractFactory('AxelarAuthWeighted');
        const authContract = await AuthFactory.deploy([
            abiCoder.encode(['address[]', 'uint256[]', 'uint256'], [[owner.address], [1], 1]),
        ]);

        // Deploy Axelar Gateway
        const AxelarGatewayFactory = await ethers.getContractFactory('AxelarGateway');
        axelarGatewayMock = await AxelarGatewayFactory.deploy(
            authContract.target,
            tokenDeployer.target,
        );

        // Deploy MockPermit2
        const MockPermit2Factory = await ethers.getContractFactory('MockPermit2');
        permit2Mock = await MockPermit2Factory.deploy();

        // Deploy RemoteAccount implementation + RemoteAccountFactory
        factory = await deployRemoteAccountFactory(
            portfolioContractCaip2,
            portfolioContractAccount,
        );

        // Deploy RemoteAccountAxelarRouter
        const RouterContract = await ethers.getContractFactory('RemoteAccountAxelarRouter');
        router = await RouterContract.deploy(
            axelarGatewayMock.target,
            sourceChain,
            factory.target,
            permit2Mock.target,
            owner.address, // ownerAuthority
        );
        await router.waitForDeployment();

        // Transfer factory ownership to router
        await factory.transferOwnership(router.target);

        routeConfig = {
            sourceChain,
            owner,
            portfolioContractAccount,
            AxelarGateway: axelarGatewayMock,
            abiCoder,
        };
        route = routed(router, routeConfig);
    });

    it('should reject when source address does not match expected account', async () => {
        const wrongSourceAddress = 'agoric1wrongaddress123456789abcdefghijk';
        const receipt = await route(portfolioLCA, {
            sourceAddress: wrongSourceAddress,
        }).doRemoteAccountExecute({
            multiCalls: [],
        });

        const decodedError = receipt.parseOperationError(factory.interface);
        expect(decodedError?.name).to.equal('AddressMismatch');
    });

    it('should provide RemoteAccount via router', async () => {
        const receipt = await route(portfolioLCA).doRemoteAccountExecute({ multiCalls: [] });
        receipt.expectOperationSuccess();

        const expectedAccountAddress = await route(portfolioLCA).getRemoteAccountAddress();
        const RemoteAccountContract = await ethers.getContractFactory('RemoteAccount');
        const account = RemoteAccountContract.attach(expectedAccountAddress);
        expect(await account.owner()).to.equal(router.target);
    });

    it('should be idempotent - providing same account twice succeeds with created=false', async () => {
        const receipt = await route(portfolioLCA).doRemoteAccountExecute({ multiCalls: [] });
        receipt.expectOperationSuccess();

        const expectedAccountAddress = await route(portfolioLCA).getRemoteAccountAddress();
        const RemoteAccountContract = await ethers.getContractFactory('RemoteAccount');
        const account = RemoteAccountContract.attach(expectedAccountAddress);
        expect(await account.owner()).to.equal(router.target);
    });

    it('should reject when expected address does not match', async () => {
        const newPortfolioLCA = 'agoric1newportfolio123456789abcdefghijk';

        // Compute wrong address (using different portfolioLCA)
        const wrongAddress = await route(
            'agoric1differentlca123456789abcdefghijk',
        ).getRemoteAccountAddress();

        const receipt = await route(newPortfolioLCA, {
            expectedAccountAddress: wrongAddress,
        }).doRemoteAccountExecute({ multiCalls: [] });

        const decodedError = receipt.parseOperationError(factory.interface);
        expect(decodedError?.name).to.equal('AddressMismatch');

        // Verify error contains the expected vs actual addresses
        const expectedCorrectAddress = await route(newPortfolioLCA).getRemoteAccountAddress();
        expect(decodedError?.args.expected).to.equal(wrongAddress);
        expect(decodedError?.args.actual).to.equal(expectedCorrectAddress);
    });

    it('should reject when ownership was transferred away from router', async () => {
        const transferTestLCA = 'agoric1transfertest123456789abcdefghij';

        const expectedAccountAddress = await route(transferTestLCA).getRemoteAccountAddress();

        // Step 1: Create account via router
        await route(transferTestLCA).doRemoteAccountExecute({ multiCalls: [] });

        // Step 2: Transfer ownership away from router (impersonate router)
        const account = await ethers.getContractAt('RemoteAccount', expectedAccountAddress);

        await helpers.impersonateAccount(router.target.toString());
        await helpers.setBalance(router.target.toString(), ethers.parseEther('100'));
        const routerSigner = await ethers.getSigner(router.target.toString());

        await account.connect(routerSigner).getFunction('transferOwnership')(addr1.address);
        await helpers.stopImpersonatingAccount(router.target.toString());

        // Verify ownership transferred
        expect(await account.owner()).to.equal(addr1.address);

        // Step 3: Try to provide again via router - should fail
        const receipt = await route(transferTestLCA).doRemoteAccountExecute({ multiCalls: [] });
        const decodedError = receipt.parseOperationError(factory.interface);
        expect(decodedError?.name).to.equal('UnauthorizedOwner');
        expect(decodedError?.args.account).to.equal(expectedAccountAddress);
        expect(decodedError?.args.owner).to.equal(router.target);
    });

    it('should be protected from front-running - factory rejects unauthorized routers', async () => {
        const frontRunLCA = 'agoric1frontruntest123456789abcdefghij';

        // Compute the expected address
        const expectedAddress = await route(frontRunLCA).getRemoteAccountAddress();

        // Attacker tries to front-run by calling factory.provideRemoteAccount directly
        // This should revert because the public method cannot be used with arbitrary owners
        await expect(
            factory.provideRemoteAccount(
                frontRunLCA,
                addr1.address, // attacker tries to use themselves as router
                expectedAddress,
            ),
        ).to.be.revertedWithCustomError(factory, 'UnauthorizedOwner');
    });

    it('should refuse creating an account for the factory principal', async () => {
        // Attacker tries to front-run by calling factory.provideRemoteAccount directly
        // This should revert because factory only does a verify for calls not from its owner (router)
        await expect(
            factory.provideRemoteAccount(
                portfolioContractAccount,
                router.target,
                ethers.ZeroAddress,
            ),
        ).to.be.revertedWithCustomError(factory, 'InvalidAccountAtAddress');
    });

    it('should revert getRemoteAccountAddress for the factory principal', async () => {
        await expect(
            factory.getRemoteAccountAddress(portfolioContractAccount),
        ).to.be.revertedWithCustomError(factory, 'InvalidAccountAtAddress');
    });

    it('should create account for a different owner via provideRemoteAccountForOwner', async () => {
        // Get current factory owner (may have changed from previous tests)
        const factoryOwnerAddress = await factory.owner();
        const factoryOwnerRouter = await ethers.getContractAt(
            'RemoteAccountAxelarRouter',
            factoryOwnerAddress,
        );

        // Deploy a target router that will own the new account
        const RouterContract = await ethers.getContractFactory('RemoteAccountAxelarRouter');
        const targetRouter = await RouterContract.deploy(
            axelarGatewayMock.target,
            sourceChain,
            factory.target,
            permit2Mock.target,
            owner.address,
        );
        await targetRouter.waitForDeployment();

        // router will call the factory's provideRemoteAccountForOwner
        // Must be executed by the router that currently owns the factory
        const factoryOwnerRoute = routed(factoryOwnerRouter, routeConfig);

        // Compute address for the new account
        const newPortfolioLCA = 'agoric1provideforowner123456789abcdef';
        const newAccountAddress = await factory.getRemoteAccountAddress(newPortfolioLCA);

        // Impersonate the router (factory owner) to call provideRemoteAccountForOwner directly
        await helpers.impersonateAccount(factoryOwnerAddress);
        await helpers.setBalance(factoryOwnerAddress, ethers.parseEther('1'));
        const routerSigner = await ethers.getSigner(factoryOwnerAddress);

        // Create account owned by addr1 instead of the router
        await expect(
            factory.connect(routerSigner).getFunction('provideRemoteAccountForOwner')(
                newPortfolioLCA,
                targetRouter.target,
                newAccountAddress,
            ),
        )
            .to.emit(factory, 'RemoteAccountCreated')
            .withArgs(newAccountAddress, newPortfolioLCA, targetRouter.target.toString());

        await helpers.stopImpersonatingAccount(factoryOwnerAddress);

        // Verify account was created and is owned by targetRouter
        const newAccount = await ethers.getContractAt('RemoteAccount', newAccountAddress);
        expect(await newAccount.owner()).to.equal(targetRouter.target);

        // Verify idempotent: calling again with same owner succeeds (returns false)
        await helpers.impersonateAccount(factoryOwnerAddress);
        const routerSigner2 = await ethers.getSigner(factoryOwnerAddress);
        await factory.connect(routerSigner2).getFunction('provideRemoteAccountForOwner')(
            newPortfolioLCA,
            targetRouter.target,
            newAccountAddress,
        );
        await helpers.stopImpersonatingAccount(factoryOwnerAddress);

        // Verify factory ownership unchanged
        expect(await factory.owner()).to.equal(factoryOwnerAddress);

        // Verify targetRouter can execute instructions on the new account
        const targetRoute = routed(targetRouter, routeConfig);

        const receipt2 = await targetRoute(newPortfolioLCA).doRemoteAccountExecute({
            multiCalls: [],
        });
        receipt2.expectOperationSuccess();

        // Verify factory owner router cannot execute instructions on the new account (owned by targetRouter)
        const receipt3 = await factoryOwnerRoute(newPortfolioLCA).doRemoteAccountExecute({
            multiCalls: [],
        });
        const decodedError = receipt3.parseOperationError(factory.interface);
        expect(decodedError?.name).to.equal('UnauthorizedOwner');
    });

    it('should reject provideRemoteAccountForOwner from non-owner', async () => {
        const lca = 'agoric1nonownertest123456789abcdefghij';
        const accountAddress = await factory.getRemoteAccountAddress(lca);

        await expect(
            factory.connect(addr1).getFunction('provideRemoteAccountForOwner')(
                lca,
                addr1.address,
                accountAddress,
            ),
        ).to.be.revertedWithCustomError(factory, 'OwnableUnauthorizedAccount');
    });

    it('should reject factory creation if RemoteAccount implementation is not inert', async () => {
        const RemoteAccountContract = await ethers.getContractFactory('RemoteAccount');
        const impl = await RemoteAccountContract.deploy();
        await impl.waitForDeployment();

        const FactoryContract = await ethers.getContractFactory('RemoteAccountFactory');
        await expect(
            FactoryContract.deploy('foo', 'bar', impl.target),
        ).to.be.revertedWithCustomError(FactoryContract, 'UnauthorizedOwner');
    });

    it('should disallow initializing the RemoteAccount implementation contract', async () => {
        const implementationAddress = await factory.implementation();
        const account = await ethers.getContractAt('RemoteAccount', implementationAddress);
        expect(await account.owner()).to.equal(ethers.ZeroAddress);

        // Try to call initialize on the implementation contract
        await expect(account.initialize(addr1.address)).to.be.revertedWithCustomError(
            account,
            'InvalidInitialization',
        );
    });

    it('should disallow re-initializing a clone', async () => {
        const lca = 'agoric1reinitializetest123456789abcdefghij';
        const receipt = await route(lca).doRemoteAccountExecute({ multiCalls: [] });
        receipt.expectOperationSuccess();

        const accountAddress = await factory.getRemoteAccountAddress(lca);
        const account = await ethers.getContractAt('RemoteAccount', accountAddress);

        // Try to call initialize again on the clone
        await expect(account.initialize(addr1.address)).to.be.revertedWithCustomError(
            account,
            'InvalidInitialization',
        );

        // Renounce ownership by first updating ownership through the successor mechanism
        await expect(router.setSuccessor(owner.address)).to.emit(router, 'SuccessorSet');
        const updateReceipt = await route(lca).doUpdateOwner({
            newOwner: owner.address as `0x${string}`,
        });
        updateReceipt.expectOperationSuccess();
        await expect(account.renounceOwnership()).to.emit(account, 'OwnershipTransferred');
        expect(await account.owner()).to.equal(ethers.ZeroAddress);

        // Try to call initialize after ownership has been renounced
        await expect(account.initialize(addr1.address)).to.be.revertedWithCustomError(
            account,
            'InvalidInitialization',
        );
    });
});

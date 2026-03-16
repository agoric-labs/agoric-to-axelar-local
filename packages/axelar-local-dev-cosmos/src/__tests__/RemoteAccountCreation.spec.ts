import AxelarGasService from '@axelar-network/axelar-cgp-solidity/artifacts/contracts/gas-service/AxelarGasService.sol/AxelarGasService.json';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { ethers } from 'hardhat';
import '@nomicfoundation/hardhat-chai-matchers';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { routed, deployRemoteAccountFactory, predictDeployAddress } from './lib/utils';

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

        // Predict the router address so the factory can enable it at construction
        const predictedRouterAddress = await predictDeployAddress(owner, 2);

        // Deploy RemoteAccount implementation + RemoteAccountFactory
        factory = await deployRemoteAccountFactory(
            portfolioContractCaip2,
            portfolioContractAccount,
            predictedRouterAddress,
        );

        // Deploy RemoteAccountAxelarRouter
        const RouterContract = await ethers.getContractFactory('RemoteAccountAxelarRouter');
        router = await RouterContract.deploy(
            axelarGatewayMock.target,
            sourceChain,
            factory.target,
            permit2Mock.target,
        );
        await router.waitForDeployment();

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
        const account = await ethers.getContractAt('RemoteAccount', expectedAccountAddress);
        expect(await account.factory()).to.equal(factory.target);
    });

    it('should be idempotent - providing same account twice succeeds', async () => {
        const receipt = await route(portfolioLCA).doRemoteAccountExecute({ multiCalls: [] });
        receipt.expectOperationSuccess();

        const expectedAccountAddress = await route(portfolioLCA).getRemoteAccountAddress();
        const account = await ethers.getContractAt('RemoteAccount', expectedAccountAddress);
        expect(await account.factory()).to.equal(factory.target);
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

    it('should reject unauthorized callers for publicly created remote accounts', async () => {
        const frontRunLCA = 'agoric1frontruntest123456789abcdefghij';

        // Anyone can call provideRemoteAccount to create the account
        const expectedAddress = await route(frontRunLCA).getRemoteAccountAddress();
        await factory.connect(addr1).getFunction('provideRemoteAccount')(
            frontRunLCA,
            expectedAddress,
        );

        // But only authorized routers can operate the created account
        const account = await ethers.getContractAt('RemoteAccount', expectedAddress);
        await expect(
            account.connect(addr1).getFunction('executeCalls')([]),
        ).to.be.revertedWithCustomError(factory, 'UnauthorizedCaller');
    });

    it('should refuse creating an account for the factory principal', async () => {
        await expect(
            factory.getFunction('provideRemoteAccount')(
                portfolioContractAccount,
                ethers.ZeroAddress,
            ),
        ).to.be.revertedWithCustomError(factory, 'InvalidAccountAtAddress');
    });

    it('should revert getRemoteAccountAddress for the factory principal', async () => {
        await expect(
            factory.getRemoteAccountAddress(portfolioContractAccount),
        ).to.be.revertedWithCustomError(factory, 'InvalidAccountAtAddress');
    });

    it('should allow enabled router to create and operate accounts', async () => {
        // Deploy a second router
        const RouterContract = await ethers.getContractFactory('RemoteAccountAxelarRouter');
        const secondRouter = await RouterContract.deploy(
            axelarGatewayMock.target,
            sourceChain,
            factory.target,
            permit2Mock.target,
        );
        await secondRouter.waitForDeployment();

        // Vet the second router via the current router (factory owner)
        await factory.getFunction('vetRouter')(secondRouter.target);

        // Enable the second router via GMP from factory principal
        const enableReceipt = await route(portfolioContractAccount).doEnableRouter({
            router: secondRouter.target as `0x${string}`,
        });
        enableReceipt.expectOperationSuccess();

        // Verify the second router is authorized
        expect(await factory.getFunction('isAuthorizedRouter')(secondRouter.target)).to.equal(true);

        // Second router can create and operate accounts
        const secondRoute = routed(secondRouter, routeConfig);
        const newLCA = 'agoric1enabledroutertest123456789abcde';
        const receipt = await secondRoute(newLCA).doRemoteAccountExecute({ multiCalls: [] });
        receipt.expectOperationSuccess();
    });

    it('should disallow initializing the RemoteAccount implementation contract', async () => {
        const implementationAddress = await factory.implementation();
        const account = await ethers.getContractAt('RemoteAccount', implementationAddress);

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
    });
});

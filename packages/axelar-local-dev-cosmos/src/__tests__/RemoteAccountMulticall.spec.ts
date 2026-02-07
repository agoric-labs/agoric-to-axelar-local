import AxelarGasService from '@axelar-network/axelar-cgp-solidity/artifacts/contracts/gas-service/AxelarGasService.sol/AxelarGasService.json';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { ethers } from 'hardhat';
import '@nomicfoundation/hardhat-chai-matchers';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { Abi } from 'viem';
import { computeRemoteAccountAddress, ContractCall, makeEvmContract, routed } from './lib/utils';

/**
 * Tests for RemoteAccount multicall functionality via RemoteAccountAxelarRouter.
 *
 * The Multicall contract is a mock target for testing. In production,
 * RemoteAccount.executeCalls() deploys funds to EVM protocols.
 *
 * These tests verify multicalls execute correctly without breaking.
 */
describe('RemoteAccountAxelarRouter - RemoteAccountMulticall', () => {
    let owner: HardhatEthersSigner, addr1: HardhatEthersSigner;
    let axelarGatewayMock: Contract, axelarGasServiceMock: Contract;
    let factory: Contract, router: Contract, permit2Mock: Contract;
    let multicallTarget: Contract;
    let accountAddress: `0x${string}`;
    let multicallContract: ReturnType<typeof makeEvmContract>;

    const abiCoder = new ethers.AbiCoder();

    const sourceChain = 'agoric';
    const portfolioContractCaip2 = 'cosmos:agoric-3';
    const portfolioContractAccount = 'agoric1routerlca123456789abcdefghijklmnopqrs';
    const portfolioLCA = 'agoric1multicall123456789abcdefghijklmno';

    const multicallAbi = [
        {
            name: 'setValue',
            type: 'function',
            inputs: [{ name: '_value', type: 'uint256' }],
            outputs: [],
            stateMutability: 'nonpayable',
        },
        {
            name: 'addToValue',
            type: 'function',
            inputs: [{ name: '_amount', type: 'uint256' }],
            outputs: [],
            stateMutability: 'nonpayable',
        },
        {
            name: 'alwaysReverts',
            type: 'function',
            inputs: [],
            outputs: [],
            stateMutability: 'nonpayable',
        },
    ] as const satisfies Abi;

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

        // Deploy RemoteAccountFactory
        const FactoryContract = await ethers.getContractFactory('RemoteAccountFactory');
        factory = await FactoryContract.deploy(portfolioContractCaip2, portfolioContractAccount);
        await factory.waitForDeployment();

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

        // Deploy Multicall target for tests
        const MulticallFactory = await ethers.getContractFactory('Multicall');
        multicallTarget = await MulticallFactory.deploy();
        multicallContract = makeEvmContract(
            multicallAbi,
            multicallTarget.target.toString() as `0x${string}`,
        );

        // Compute account address (account will be created in first test)
        accountAddress = await computeRemoteAccountAddress(factory.target.toString(), portfolioLCA);

        routeConfig = {
            sourceChain,
            owner,
            portfolioContractAccount,
            AxelarGateway: axelarGatewayMock,
            abiCoder,
        };
        route = routed(router, routeConfig);
    });

    it('should create account and execute multicall in single call', async () => {
        const multiCalls: ContractCall[] = [multicallContract.setValue(42n)];

        const receipt = await route(portfolioLCA).doRemoteAccountExecute({ multiCalls });
        receipt.expectOperationSuccess();
        expect(await multicallTarget.getValue()).to.equal(42n);
    });

    it('should execute multiple calls in sequence', async () => {
        const multiCalls: ContractCall[] = [
            multicallContract.setValue(100n),
            multicallContract.addToValue(5n),
        ];

        const receipt = await route(portfolioLCA).doRemoteAccountExecute({ multiCalls });
        receipt.expectOperationSuccess();
        expect(await multicallTarget.getValue()).to.equal(105n);
    });

    it('should emit failure when multicall reverts', async () => {
        const multiCalls: ContractCall[] = [multicallContract.alwaysReverts()];

        const receipt = await route(portfolioLCA).doRemoteAccountExecute({ multiCalls });
        const errorEvent = receipt.expectOperationFailure();
        expect(errorEvent.args.reason).to.not.equal('0x');
    });

    it('should reject multicall with wrong controller', async () => {
        const wrongPortfolioLCA = 'agoric1wrongcontroller123456789abcdefgh';

        const multiCalls: ContractCall[] = [multicallContract.setValue(999n)];

        // Use correct account address but wrong source address (wrongPortfolioLCA)
        const receipt = await route(portfolioLCA, {
            sourceAddress: wrongPortfolioLCA,
        }).doRemoteAccountExecute({
            multiCalls,
        });
        const decodedError = receipt.parseOperationError(factory.interface);
        expect(decodedError?.name).to.equal('AddressMismatch');
    });

    it('should update owner of remote account with successor check', async () => {
        // Deploy a new router
        const RouterContract = await ethers.getContractFactory('RemoteAccountAxelarRouter');
        const newRouter = await RouterContract.deploy(
            axelarGatewayMock.target,
            sourceChain,
            factory.target,
            permit2Mock.target,
            owner.address, // ownerAuthority
        );
        await newRouter.waitForDeployment();

        // Old router owner pre-designates the successor
        await router.setSuccessor(newRouter.target);

        // Verify successor was set
        expect(await router.successor()).to.equal(newRouter.target);

        // Verify RemoteAccount is still owned by old router before transfer
        const remoteAccount = await ethers.getContractAt('RemoteAccount', accountAddress);
        expect(await remoteAccount.owner()).to.equal(router.target);

        // Execute UpdateOwner to transfer ownership
        const receipt = await route(portfolioLCA).doUpdateOwner({
            newOwner: newRouter.target as `0x${string}`,
        });
        receipt.expectOperationSuccess();

        // Verify ownership was transferred
        expect(await remoteAccount.owner()).to.equal(newRouter.target);

        const multiCalls2: ContractCall[] = [multicallContract.setValue(999n)];

        const receipt2 = await route(portfolioLCA).doRemoteAccountExecute({
            multiCalls: multiCalls2,
        });

        const decodedError = receipt2.parseOperationError(factory.interface);
        expect(decodedError?.name).to.equal('UnauthorizedOwner');

        // New router should succeed
        const newRoute = routed(newRouter, routeConfig);

        const receipt3 = await newRoute(portfolioLCA).doRemoteAccountExecute({
            multiCalls: multiCalls2,
        });
        receipt3.expectOperationSuccess();
        expect(await multicallTarget.getValue()).to.equal(999n);
    });

    it('should transfer factory ownership and create new account with new router', async () => {
        // Deploy a new router
        const RouterContract = await ethers.getContractFactory('RemoteAccountAxelarRouter');
        const newRouter = await RouterContract.deploy(
            axelarGatewayMock.target,
            sourceChain,
            factory.target,
            permit2Mock.target,
            owner.address, // ownerAuthority
        );
        await newRouter.waitForDeployment();

        // Old router owner pre-designates its successor
        await router.setSuccessor(newRouter.target);

        // Verify factory is currently owned by old router
        expect(await factory.owner()).to.equal(router.target);

        // Transfer factory ownership via UpdateOwner
        const receipt = await route(portfolioContractAccount).doUpdateOwner({
            newOwner: newRouter.target as `0x${string}`,
        });
        receipt.expectOperationSuccess();

        // Verify factory ownership was transferred
        expect(await factory.owner()).to.equal(newRouter.target);

        // Now use new router to create a new account for a different portfolioLCA
        const newPortfolioLCA = 'agoric1newportfolio123456789abcdefghijk';
        const newAccountAddress = await computeRemoteAccountAddress(
            factory.target.toString(),
            newPortfolioLCA,
        );

        const newRoute = routed(newRouter, routeConfig);

        const receipt2 = await newRoute(newPortfolioLCA).doRemoteAccountExecute({
            multiCalls: [],
        });
        receipt2.expectOperationSuccess();

        // Verify new account was created and owned by new router
        const newAccount = await ethers.getContractAt('RemoteAccount', newAccountAddress);
        expect(await newAccount.owner()).to.equal(newRouter.target);

        // Verify old router cannot create accounts anymore
        const anotherPortfolioLCA = 'agoric1anotherportfolio123456789abcdefg';
        const receipt3 = await route(anotherPortfolioLCA).doRemoteAccountExecute({
            multiCalls: [],
        });
        const decodedError = receipt3.parseOperationError(factory.interface);
        expect(decodedError?.name).to.equal('InvalidAccountAtAddress');
    });

    it.skip('should create account for different router via factory.provideForRouter multicall', async () => {
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

        // router will call the factory's provideForRouter
        // Must be executed by the router that currently owns the factory
        const factoryOwnerRoute = routed(factoryOwnerRouter, routeConfig);

        // Compute address for the new account
        const newPortfolioLCA = 'agoric1provideforrouter123456789abcdef';
        const newAccountAddress =
            await factoryOwnerRoute(newPortfolioLCA).getRemoteAccountAddress();

        const receipt = await factoryOwnerRoute(portfolioContractAccount)
            // @ts-expect-error - removed
            .doProvideForRouter({
                principalAccount: newPortfolioLCA,
                router: targetRouter.target as `0x${string}`,
                expectedAccountAddress: newAccountAddress,
            });
        receipt.expectOperationSuccess();

        // Verify account was created and is owned by targetRouter
        const newAccount = await ethers.getContractAt('RemoteAccount', newAccountAddress);
        expect(await newAccount.owner()).to.equal(targetRouter.target);

        // Verify factory ownership unchanged
        expect(await factory.owner()).to.equal(factoryOwnerAddress);

        // Verify targetRouter can execute multicalls on the new account
        const multiCalls2: ContractCall[] = [multicallContract.setValue(777n)];

        const targetRoute = routed(targetRouter, routeConfig);

        const receipt2 = await targetRoute(newPortfolioLCA).doRemoteAccountExecute({
            multiCalls: multiCalls2,
        });
        receipt2.expectOperationSuccess();
        expect(await multicallTarget.getValue()).to.equal(777n);

        // Verify factory owner router cannot execute multicalls on the new account (owned by targetRouter)

        const receipt3 = await factoryOwnerRoute(newPortfolioLCA).doRemoteAccountExecute({
            multiCalls: multiCalls2,
        });
        receipt3.expectOperationFailure();
        const decodedError = receipt3.parseOperationError(factory.interface);
        expect(decodedError?.name).to.equal('InvalidAccountAtAddress');
    });
});

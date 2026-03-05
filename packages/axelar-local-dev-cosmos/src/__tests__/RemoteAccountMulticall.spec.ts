import AxelarGasService from '@axelar-network/axelar-cgp-solidity/artifacts/contracts/gas-service/AxelarGasService.sol/AxelarGasService.json';
import { expect } from 'chai';
import { Contract, Interface, keccak256, toUtf8Bytes } from 'ethers';
import { ethers } from 'hardhat';
import '@nomicfoundation/hardhat-chai-matchers';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { makeEvmContract } from '../utils/evm-facade';
import { contractWithCallMetadata } from '../utils/router';
import type { ContractCall } from '../interfaces/router';
import { computeRemoteAccountAddress, ParsedLog, routed } from './lib/utils';
import { multicallAbi } from './interfaces/multicall';

const getContractCallSuccessEvents = async (receipt: {
    parseLogs: (iface: Interface) => ParsedLog[];
}) => {
    const RemoteAccount = await ethers.getContractFactory('RemoteAccount');
    return receipt
        .parseLogs(RemoteAccount.interface)
        .filter((e) => e.name === 'ContractCallSuccess');
};

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
    type BaseMulticallContract = ReturnType<typeof makeEvmContract<typeof multicallAbi>>;
    let multicallContract: ReturnType<typeof contractWithCallMetadata<BaseMulticallContract>>;

    const abiCoder = new ethers.AbiCoder();

    const sourceChain = 'agoric';
    const portfolioContractCaip2 = 'cosmos:agoric-3';
    const portfolioContractAccount = 'agoric1routerlca123456789abcdefghijklmnopqrs';
    const portfolioLCA = 'agoric1multicall123456789abcdefghijklmno';

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
        multicallContract = contractWithCallMetadata(
            makeEvmContract(multicallAbi),
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
        const operationResult = receipt.expectOperationSuccess();
        expect(operationResult.args.sourceAddress).to.equal(portfolioLCA);
        expect(operationResult.args.sourceAddressIndex.hash).to.equal(
            keccak256(toUtf8Bytes(portfolioLCA)),
        );
        expect(operationResult.args.allegedRemoteAccount).to.equal(
            await route(portfolioLCA).getRemoteAccountAddress(),
        );

        expect(operationResult.args.instructionSelector).to.equal(
            router.interface.getFunction('processRemoteAccountExecuteInstruction')!.selector,
        );

        const successEvents = await getContractCallSuccessEvents(receipt);
        expect(successEvents).to.have.a.lengthOf(1);
        expect(successEvents[0].args.target).to.equal(multiCalls[0].target);
        expect(successEvents[0].args.selector).to.equal(multiCalls[0].data.slice(0, 10));
        expect(successEvents[0].args.callIndex).to.equal(0);
        expect(successEvents[0].args.gasUsed).to.be.gt(2000);

        expect(await multicallTarget.getValue()).to.equal(42n);
    });

    it('should execute multiple calls in sequence', async () => {
        const multiCalls: ContractCall[] = [
            multicallContract.setValue(100n),
            multicallContract.addToValue(5n),
        ];

        const receipt = await route(portfolioLCA).doRemoteAccountExecute({ multiCalls });
        receipt.expectOperationSuccess();

        const successEvents = await getContractCallSuccessEvents(receipt);
        expect(successEvents).to.have.a.lengthOf(2);
        expect(successEvents[0].args.target).to.equal(multiCalls[0].target);
        expect(successEvents[0].args.selector).to.equal(multiCalls[0].data.slice(0, 10));
        expect(successEvents[0].args.callIndex).to.equal(0);
        expect(successEvents[0].args.gasUsed).to.be.gt(2000);
        expect(successEvents[1].args.target).to.equal(multiCalls[1].target);
        expect(successEvents[1].args.selector).to.equal(multiCalls[1].data.slice(0, 10));
        expect(successEvents[1].args.callIndex).to.equal(1);
        expect(successEvents[1].args.gasUsed).to.be.gt(2000);

        expect(await multicallTarget.getValue()).to.equal(105n);
    });

    it('should emit failure when multicall reverts', async () => {
        const multiCalls: ContractCall[] = [multicallContract.alwaysReverts()];

        const receipt = await route(portfolioLCA).doRemoteAccountExecute({ multiCalls });
        const errorEvent = receipt.expectOperationFailure();
        const RemoteAccount = await ethers.getContractFactory('RemoteAccount');
        const decoded = RemoteAccount.interface.parseError(errorEvent.args.reason);
        expect(decoded?.name).to.equal('ContractCallFailed');
        expect(decoded?.args.target).to.equal(multiCalls[0].target);
        expect(decoded?.args.selector).to.equal(multiCalls[0].data.slice(0, 10));
        expect(decoded?.args.callIndex).to.equal(0);
        const error = new Error('Synthetic call failure');
        Object.assign(error, { data: decoded?.args.reason });
        await expect(Promise.reject(error)).to.be.revertedWith('Multicall: intentional revert');
    });

    it('should revert all calls when second call in batch fails', async () => {
        // Set a known value first
        const setupCalls: ContractCall[] = [multicallContract.setValue(500n)];
        (
            await route(portfolioLCA).doRemoteAccountExecute({ multiCalls: setupCalls })
        ).expectOperationSuccess();
        expect(await multicallTarget.getValue()).to.equal(500n);

        // Batch: first call sets value to 999, second call reverts
        const multiCalls: ContractCall[] = [
            multicallContract.setValue(999n),
            multicallContract.alwaysReverts(),
        ];

        const receipt = await route(portfolioLCA).doRemoteAccountExecute({ multiCalls });
        receipt.expectOperationFailure();

        // Value should still be 500 — the first call's setValue(999) was rolled back
        expect(await multicallTarget.getValue()).to.equal(500n);
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
        await router.getFunction('setSuccessor')(newRouter.target);

        // Verify successor was set
        expect(await router.getFunction('successor')()).to.equal(newRouter.target);

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

        // Create a new account with the old router
        const tmpLCA = 'agoric1templca123456789abcdefghijklmno';
        (
            await route(tmpLCA).doRemoteAccountExecute({
                multiCalls: [],
            })
        ).expectOperationSuccess();

        // Old router owner pre-designates its successor
        await router.getFunction('setSuccessor')(newRouter.target);

        // Verify factory is currently owned by old router
        expect(await factory.owner()).to.equal(router.target);

        // Transfer factory ownership via UpdateOwner
        (
            await route(portfolioContractAccount).doUpdateOwner({
                newOwner: newRouter.target as `0x${string}`,
            })
        ).expectOperationSuccess();

        // Verify factory ownership was transferred
        expect(await factory.owner()).to.equal(newRouter.target);

        // Now use new router to create a new account for a different portfolioLCA
        const newPortfolioLCA = 'agoric1newportfolio123456789abcdefghijk';
        const newAccountAddress = await computeRemoteAccountAddress(
            factory.target.toString(),
            newPortfolioLCA,
        );

        const newRoute = routed(newRouter, routeConfig);

        (
            await newRoute(newPortfolioLCA).doRemoteAccountExecute({
                multiCalls: [],
            })
        ).expectOperationSuccess();

        // Verify new account was created and owned by new router
        const newAccount = await ethers.getContractAt('RemoteAccount', newAccountAddress);
        expect(await newAccount.owner()).to.equal(newRouter.target);

        // Verify old router cannot create accounts anymore
        const anotherPortfolioLCA = 'agoric1anotherportfolio123456789abcdefg';
        const receiptFailedCreate = await route(anotherPortfolioLCA).doRemoteAccountExecute({
            multiCalls: [],
        });
        const decodedError = receiptFailedCreate.parseOperationError(factory.interface);
        expect(decodedError?.name).to.equal('InvalidAccountAtAddress');

        // Verify old router can update ownership of the accounts it still owns (tmpLCA) to the new router
        (
            await route(tmpLCA).doUpdateOwner({
                newOwner: newRouter.target as `0x${string}`,
            })
        ).expectOperationSuccess();

        const tmpAccount = await ethers.getContractAt(
            'RemoteAccount',
            await route(tmpLCA).getRemoteAccountAddress(),
        );
        expect(await tmpAccount.owner()).to.equal(newRouter.target);
    });

    it('should reject UpdateOwner when no successor is designated', async () => {
        // Deploy a fresh router with no successor set
        const RouterContract = await ethers.getContractFactory('RemoteAccountAxelarRouter');
        const freshRouter = await RouterContract.deploy(
            axelarGatewayMock.target,
            sourceChain,
            factory.target,
            permit2Mock.target,
            owner.address,
        );
        await freshRouter.waitForDeployment();

        // Get current factory owner and set freshRouter as its successor
        const currentFactoryOwner = await factory.owner();
        const currentRouter = await ethers.getContractAt(
            'RemoteAccountAxelarRouter',
            currentFactoryOwner,
        );
        await currentRouter.getFunction('setSuccessor')(freshRouter.target);

        // Transfer factory ownership to freshRouter
        const currentOwnerRoute = routed(currentRouter, routeConfig);
        (
            await currentOwnerRoute(portfolioContractAccount).doUpdateOwner({
                newOwner: freshRouter.target as `0x${string}`,
            })
        ).expectOperationSuccess();

        // freshRouter now owns the factory but has no successor set (default: address(0))
        expect(await factory.owner()).to.equal(freshRouter.target);
        expect(await freshRouter.getFunction('successor')()).to.equal(ethers.ZeroAddress);

        // Try to UpdateOwner with address(0) as newOwner — should fail
        const freshRoute = routed(freshRouter, routeConfig);
        const receipt = await freshRoute(portfolioContractAccount).doUpdateOwner({
            newOwner: ethers.ZeroAddress as `0x${string}`,
        });
        const decodedError = receipt.parseOperationError(router.interface);
        expect(decodedError?.name).to.equal('OwnableInvalidOwner');
    });

    it('should reject UpdateOwner when newOwner does not match successor', async () => {
        // Get current factory owner
        const currentFactoryOwner = await factory.owner();
        const currentRouter = await ethers.getContractAt(
            'RemoteAccountAxelarRouter',
            currentFactoryOwner,
        );

        // Set a successor
        const RouterContract = await ethers.getContractFactory('RemoteAccountAxelarRouter');
        const designatedSuccessor = await RouterContract.deploy(
            axelarGatewayMock.target,
            sourceChain,
            factory.target,
            permit2Mock.target,
            owner.address,
        );
        await designatedSuccessor.waitForDeployment();
        await currentRouter.getFunction('setSuccessor')(designatedSuccessor.target);

        // Try to transfer to a DIFFERENT address (not the successor)
        const currentRoute = routed(currentRouter, routeConfig);
        const receipt = await currentRoute(portfolioContractAccount).doUpdateOwner({
            newOwner: addr1.address as `0x${string}`,
        });
        const decodedError = receipt.parseOperationError(router.interface);
        expect(decodedError?.name).to.equal('OwnableInvalidOwner');
    });
});

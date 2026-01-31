import AxelarGasService from '@axelar-network/axelar-cgp-solidity/artifacts/contracts/gas-service/AxelarGasService.sol/AxelarGasService.json';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { ethers } from 'hardhat';
import '@nomicfoundation/hardhat-chai-matchers';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { keccak256, stringToHex, toBytes, encodeFunctionData } from 'viem';
import {
    approveMessage,
    computeRemoteAccountAddress,
    encodeRouterPayload,
    ContractCall,
} from './lib/utils';

/**
 * Tests for RemoteAccount multicall functionality via PortfolioRouter.
 *
 * The Multicall contract is a mock target for testing. In production,
 * RemoteAccount.executeCalls() deploys funds to EVM protocols.
 *
 * These tests verify multicalls execute correctly without breaking.
 */
describe('PortfolioRouter - RemoteAccountMulticall', () => {
    let owner: HardhatEthersSigner, addr1: HardhatEthersSigner;
    let axelarGatewayMock: Contract, axelarGasServiceMock: Contract;
    let factory: Contract, router: Contract, permit2Mock: Contract;
    let multicallTarget: Contract;
    let accountAddress: `0x${string}`;

    const abiCoder = new ethers.AbiCoder();

    const sourceChain = 'agoric';
    const portfolioContractCaip2 = 'cosmos:agoric-3';
    const portfolioContractAccount = 'agoric1routerlca123456789abcdefghijklmnopqrs';
    const portfolioLCA = 'agoric1multicall123456789abcdefghijklmno';

    let commandIdCounter = 1;
    const getCommandId = () => {
        const commandId = keccak256(stringToHex(String(commandIdCounter)));
        commandIdCounter++;
        return commandId;
    };

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

        // Deploy PortfolioRouter
        const RouterContract = await ethers.getContractFactory('PortfolioRouter');
        router = await RouterContract.deploy(
            axelarGatewayMock.target,
            sourceChain,
            portfolioContractCaip2,
            portfolioContractAccount,
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

        // Compute account address (account will be created in first test)
        accountAddress = await computeRemoteAccountAddress(
            factory.target.toString(),
            portfolioContractCaip2,
            portfolioLCA,
        );
    });

    it('should create account and execute multicall in single call', async () => {
        const commandId = getCommandId();
        const txId = 'multicall1';

        // Encode call to Multicall.setValue(42)
        const callData = encodeFunctionData({
            abi: [
                {
                    name: 'setValue',
                    type: 'function',
                    inputs: [{ name: '_value', type: 'uint256' }],
                },
            ],
            functionName: 'setValue',
            args: [42n],
        });

        const multiCalls: ContractCall[] = [
            {
                target: multicallTarget.target.toString() as `0x${string}`,
                data: callData,
            },
        ];

        // Both create account AND execute multicall in one call
        const payload = encodeRouterPayload({
            id: txId,
            portfolioLCA,
            remoteAccountAddress: accountAddress,
            provideAccount: true,
            depositPermit: [],
            multiCalls,
        });

        const payloadHash = keccak256(toBytes(payload));

        await approveMessage({
            commandId,
            from: sourceChain,
            sourceAddress: portfolioContractAccount,
            targetAddress: router.target,
            payload: payloadHash,
            owner,
            AxelarGateway: axelarGatewayMock,
            abiCoder,
        });

        const tx = await router.execute(commandId, sourceChain, portfolioContractAccount, payload);
        const receipt = await tx.wait();

        // Parse events
        const routerInterface = router.interface;
        const parsedLogs = receipt?.logs
            .map((log: { topics: string[]; data: string }) => {
                try {
                    return routerInterface.parseLog(log);
                } catch {
                    return null;
                }
            })
            .filter(Boolean);

        // Check RemoteAccountStatus event (account created)
        const accountEvent = parsedLogs.find(
            (e: { name: string }) => e?.name === 'RemoteAccountStatus',
        );
        expect(accountEvent?.args.success).to.be.true;
        expect(accountEvent?.args.created).to.be.true;

        // Check MulticallStatus event (multicall executed)
        const multicallEvent = parsedLogs.find(
            (e: { name: string }) => e?.name === 'MulticallStatus',
        );
        expect(multicallEvent?.args.id.hash).to.equal(keccak256(toBytes(txId)));
        expect(multicallEvent?.args.success).to.be.true;
        expect(await multicallTarget.getValue()).to.equal(42n);
    });

    it('should execute multiple calls in sequence', async () => {
        const commandId = getCommandId();
        const txId = 'multicall2';

        // Multiple calls: setValue(100), then addToValue(5)
        const setValueData = encodeFunctionData({
            abi: [
                {
                    name: 'setValue',
                    type: 'function',
                    inputs: [{ name: '_value', type: 'uint256' }],
                },
            ],
            functionName: 'setValue',
            args: [100n],
        });

        const addToValueData = encodeFunctionData({
            abi: [
                {
                    name: 'addToValue',
                    type: 'function',
                    inputs: [{ name: '_amount', type: 'uint256' }],
                },
            ],
            functionName: 'addToValue',
            args: [5n],
        });

        const multiCalls: ContractCall[] = [
            { target: multicallTarget.target.toString() as `0x${string}`, data: setValueData },
            { target: multicallTarget.target.toString() as `0x${string}`, data: addToValueData },
        ];

        const payload = encodeRouterPayload({
            id: txId,
            portfolioLCA,
            remoteAccountAddress: accountAddress,
            provideAccount: false,
            depositPermit: [],
            multiCalls,
        });

        const payloadHash = keccak256(toBytes(payload));

        await approveMessage({
            commandId,
            from: sourceChain,
            sourceAddress: portfolioContractAccount,
            targetAddress: router.target,
            payload: payloadHash,
            owner,
            AxelarGateway: axelarGatewayMock,
            abiCoder,
        });

        const tx = await router.execute(commandId, sourceChain, portfolioContractAccount, payload);
        const receipt = await tx.wait();

        // Parse events
        const routerInterface = router.interface;
        const parsedLogs = receipt?.logs
            .map((log: { topics: string[]; data: string }) => {
                try {
                    return routerInterface.parseLog(log);
                } catch {
                    return null;
                }
            })
            .filter(Boolean);

        const multicallEvent = parsedLogs.find(
            (e: { name: string }) => e?.name === 'MulticallStatus',
        );

        expect(multicallEvent?.args.success).to.be.true;
        expect(await multicallTarget.getValue()).to.equal(105n);
    });

    it('should emit failure when multicall reverts', async () => {
        const commandId = getCommandId();
        const txId = 'multicall3';

        // Encode call to Multicall.alwaysReverts()
        const revertData = encodeFunctionData({
            abi: [{ name: 'alwaysReverts', type: 'function', inputs: [] }],
            functionName: 'alwaysReverts',
        });

        const multiCalls: ContractCall[] = [
            { target: multicallTarget.target.toString() as `0x${string}`, data: revertData },
        ];

        const payload = encodeRouterPayload({
            id: txId,
            portfolioLCA,
            remoteAccountAddress: accountAddress,
            provideAccount: false,
            depositPermit: [],
            multiCalls,
        });

        const payloadHash = keccak256(toBytes(payload));

        await approveMessage({
            commandId,
            from: sourceChain,
            sourceAddress: portfolioContractAccount,
            targetAddress: router.target,
            payload: payloadHash,
            owner,
            AxelarGateway: axelarGatewayMock,
            abiCoder,
        });

        const tx = await router.execute(commandId, sourceChain, portfolioContractAccount, payload);
        const receipt = await tx.wait();

        // Parse events
        const routerInterface = router.interface;
        const parsedLogs = receipt?.logs
            .map((log: { topics: string[]; data: string }) => {
                try {
                    return routerInterface.parseLog(log);
                } catch {
                    return null;
                }
            })
            .filter(Boolean);

        const multicallEvent = parsedLogs.find(
            (e: { name: string }) => e?.name === 'MulticallStatus',
        );

        expect(multicallEvent?.args.id.hash).to.equal(keccak256(toBytes(txId)));
        expect(multicallEvent?.args.success).to.be.false;
        expect(multicallEvent?.args.reason).to.not.equal('0x');
    });

    it('should reject multicall with wrong controller', async () => {
        const commandId = getCommandId();
        const txId = 'multicall4';
        const wrongPortfolioLCA = 'agoric1wrongcontroller123456789abcdefgh';

        // Try to execute on existing account but with wrong portfolioLCA
        const callData = encodeFunctionData({
            abi: [
                {
                    name: 'setValue',
                    type: 'function',
                    inputs: [{ name: '_value', type: 'uint256' }],
                },
            ],
            functionName: 'setValue',
            args: [999n],
        });

        const multiCalls: ContractCall[] = [
            { target: multicallTarget.target.toString() as `0x${string}`, data: callData },
        ];

        // Use wrong portfolioLCA but correct account address
        const payload = encodeRouterPayload({
            id: txId,
            portfolioLCA: wrongPortfolioLCA,
            remoteAccountAddress: accountAddress,
            provideAccount: false,
            depositPermit: [],
            multiCalls,
        });

        const payloadHash = keccak256(toBytes(payload));

        await approveMessage({
            commandId,
            from: sourceChain,
            sourceAddress: portfolioContractAccount,
            targetAddress: router.target,
            payload: payloadHash,
            owner,
            AxelarGateway: axelarGatewayMock,
            abiCoder,
        });

        const tx = await router.execute(commandId, sourceChain, portfolioContractAccount, payload);
        const receipt = await tx.wait();

        // Parse events
        const routerInterface = router.interface;
        const parsedLogs = receipt?.logs
            .map((log: { topics: string[]; data: string }) => {
                try {
                    return routerInterface.parseLog(log);
                } catch {
                    return null;
                }
            })
            .filter(Boolean);

        const multicallEvent = parsedLogs.find(
            (e: { name: string }) => e?.name === 'MulticallStatus',
        );

        expect(multicallEvent?.args.id.hash).to.equal(keccak256(toBytes(txId)));
        expect(multicallEvent?.args.success).to.be.false;

        // Decode error - should be UnauthorizedController
        const remoteAccountInterface = (await ethers.getContractFactory('RemoteAccount')).interface;
        const decodedError = remoteAccountInterface.parseError(multicallEvent?.args.reason);
        expect(decodedError?.name).to.equal('UnauthorizedController');
    });
});

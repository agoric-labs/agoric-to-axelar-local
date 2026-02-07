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

    // Helper to parse logs using a contract interface
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type ParsedLog = { name: string; args: Record<string, any> };
    const parseLogs = (
        receipt: { logs: Array<{ topics: string[]; data: string }> } | null,
        contractInterface: { parseLog: (log: { topics: string[]; data: string }) => unknown },
    ): ParsedLog[] => {
        return (
            (receipt?.logs
                .map((log) => {
                    try {
                        return contractInterface.parseLog(log);
                    } catch {
                        return null;
                    }
                })
                .filter(Boolean) as ParsedLog[]) ?? []
        );
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

        // Compute account address (account will be created in first test)
        accountAddress = await computeRemoteAccountAddress(factory.target.toString(), portfolioLCA);
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
            expectedAccountAddress: accountAddress,
            instructionType: 'RemoteAccountExecute',
            instruction: {
                multiCalls,
            },
        });

        const payloadHash = keccak256(toBytes(payload));

        await approveMessage({
            commandId,
            from: sourceChain,
            sourceAddress: portfolioLCA,
            targetAddress: router.target,
            payload: payloadHash,
            owner,
            AxelarGateway: axelarGatewayMock,
            abiCoder,
        });

        const tx = await router.execute(commandId, sourceChain, portfolioLCA, payload);
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

        // Check OperationResult event (account created and multicall executed)
        const successEvent = parsedLogs.find((e: { name: string }) => e.name === 'OperationResult');
        expect(successEvent.args.id.hash).to.equal(keccak256(toBytes(txId)));
        expect(successEvent.args.success).to.equal(true);
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
            { target: multicallTarget.target as `0x${string}`, data: setValueData },
            { target: multicallTarget.target as `0x${string}`, data: addToValueData },
        ];

        const payload = encodeRouterPayload({
            id: txId,
            expectedAccountAddress: accountAddress,
            instructionType: 'RemoteAccountExecute',
            instruction: {
                multiCalls,
            },
        });

        const payloadHash = keccak256(toBytes(payload));

        await approveMessage({
            commandId,
            from: sourceChain,
            sourceAddress: portfolioLCA,
            targetAddress: router.target,
            payload: payloadHash,
            owner,
            AxelarGateway: axelarGatewayMock,
            abiCoder,
        });

        const tx = await router.execute(commandId, sourceChain, portfolioLCA, payload);
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

        const successEvent = parsedLogs.find((e: { name: string }) => e.name === 'OperationResult');
        expect(successEvent.args.id.hash).to.equal(keccak256(toBytes(txId)));
        expect(successEvent.args.success).to.equal(true);
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
            expectedAccountAddress: accountAddress,
            instructionType: 'RemoteAccountExecute',
            instruction: {
                multiCalls,
            },
        });

        const payloadHash = keccak256(toBytes(payload));

        await approveMessage({
            commandId,
            from: sourceChain,
            sourceAddress: portfolioLCA,
            targetAddress: router.target,
            payload: payloadHash,
            owner,
            AxelarGateway: axelarGatewayMock,
            abiCoder,
        });

        const tx = await router.execute(commandId, sourceChain, portfolioLCA, payload);
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

        const errorEvent = parsedLogs.find((e: { name: string }) => e?.name === 'OperationResult');
        expect(errorEvent.args.id.hash).to.equal(keccak256(toBytes(txId)));
        expect(errorEvent.args.success).to.equal(false);
        expect(errorEvent.args.reason).to.not.equal('0x');
    });

    it('should reject multicall with wrong controller', async () => {
        const commandId = getCommandId();
        const txId = 'multicall4';
        const wrongPortfolioLCA = 'agoric1wrongcontroller123456789abcdefgh';

        // Try to execute on existing account but with wrong portfolioLCA as source address
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

        // Use correct account address but wrong source address (wrongPortfolioLCA)
        const payload = encodeRouterPayload({
            id: txId,
            expectedAccountAddress: accountAddress,
            instructionType: 'RemoteAccountExecute',
            instruction: {
                multiCalls,
            },
        });

        const payloadHash = keccak256(toBytes(payload));

        // Send with wrongPortfolioLCA as source address - this doesn't match accountAddress's principal
        await approveMessage({
            commandId,
            from: sourceChain,
            sourceAddress: wrongPortfolioLCA,
            targetAddress: router.target,
            payload: payloadHash,
            owner,
            AxelarGateway: axelarGatewayMock,
            abiCoder,
        });

        const tx = await router.execute(commandId, sourceChain, wrongPortfolioLCA, payload);
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

        const errorEvent = parsedLogs.find((e: { name: string }) => e.name === 'OperationResult');
        expect(errorEvent.args.id.hash).to.equal(keccak256(toBytes(txId)));
        expect(errorEvent.args.success).to.equal(false);
        // Decode error - should be AddressMismatch from factory
        const decodedError = factory.interface.parseError(errorEvent.args.reason);
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
        const commandId = getCommandId();
        const txId = 'ownerUpdate1';

        const payload = encodeRouterPayload({
            id: txId,
            expectedAccountAddress: accountAddress,
            instructionType: 'UpdateOwner',
            instruction: {
                newOwner: newRouter.target as `0x${string}`,
            },
        });

        const payloadHash = keccak256(toBytes(payload));

        await approveMessage({
            commandId,
            from: sourceChain,
            sourceAddress: portfolioLCA,
            targetAddress: router.target,
            payload: payloadHash,
            owner,
            AxelarGateway: axelarGatewayMock,
            abiCoder,
        });

        const tx = await router.execute(commandId, sourceChain, portfolioLCA, payload);
        const receipt = await tx.wait();

        const parsedLogs = parseLogs(receipt, router.interface);

        // Check OperationResult event - should succeed
        const successEvent = parsedLogs.find((e) => e.name === 'OperationResult')!;
        expect(successEvent.args.id.hash).to.equal(keccak256(toBytes(txId)));
        expect(successEvent.args.success).to.equal(true);

        // Verify ownership was transferred
        expect(await remoteAccount.owner()).to.equal(newRouter.target);

        // Old router should fail to execute multicall
        const commandId2 = getCommandId();
        const txId2 = 'ownerUpdate2';

        const setValueData = encodeFunctionData({
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

        const multiCalls2: ContractCall[] = [
            { target: multicallTarget.target as `0x${string}`, data: setValueData },
        ];

        const payload2 = encodeRouterPayload({
            id: txId2,
            expectedAccountAddress: accountAddress,
            instructionType: 'RemoteAccountExecute',
            instruction: {
                multiCalls: multiCalls2,
            },
        });

        const payloadHash2 = keccak256(toBytes(payload2));

        await approveMessage({
            commandId: commandId2,
            from: sourceChain,
            sourceAddress: portfolioLCA,
            targetAddress: router.target,
            payload: payloadHash2,
            owner,
            AxelarGateway: axelarGatewayMock,
            abiCoder,
        });

        const tx2 = await router.execute(commandId2, sourceChain, portfolioLCA, payload2);
        const receipt2 = await tx2.wait();

        const parsedLogs2 = parseLogs(receipt2, router.interface);

        // Old router should fail
        const errorEvent = parsedLogs2.find((e) => e.name === 'OperationResult')!;
        expect(errorEvent.args.id.hash).to.equal(keccak256(toBytes(txId2)));
        expect(errorEvent.args.success).to.equal(false);

        // Decode error - should be UnauthorizedOwner from factory
        const decodedError = factory.interface.parseError(errorEvent.args.reason);
        expect(decodedError?.name).to.equal('UnauthorizedOwner');

        // New router should succeed
        const commandId3 = getCommandId();
        const txId3 = 'ownerUpdate3';

        const payload3 = encodeRouterPayload({
            id: txId3,
            expectedAccountAddress: accountAddress,
            instructionType: 'RemoteAccountExecute',
            instruction: {
                multiCalls: multiCalls2, // same setValue(999) call
            },
        });

        const payloadHash3 = keccak256(toBytes(payload3));

        await approveMessage({
            commandId: commandId3,
            from: sourceChain,
            sourceAddress: portfolioLCA,
            targetAddress: newRouter.target,
            payload: payloadHash3,
            owner,
            AxelarGateway: axelarGatewayMock,
            abiCoder,
        });

        const tx3 = await newRouter.execute(commandId3, sourceChain, portfolioLCA, payload3);
        const receipt3 = await tx3.wait();

        const parsedLogs3 = parseLogs(receipt3, newRouter.interface);

        // New router should succeed
        const successEvent2 = parsedLogs3.find((e) => e.name === 'OperationResult')!;
        expect(successEvent2.args.id.hash).to.equal(keccak256(toBytes(txId3)));
        expect(successEvent2.args.success).to.equal(true);
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
        const commandId = getCommandId();
        const txId = 'factoryOwnerUpdate1';

        const payload = encodeRouterPayload({
            id: txId,
            expectedAccountAddress: factory.target as `0x${string}`,
            instructionType: 'UpdateOwner',
            instruction: {
                newOwner: newRouter.target as `0x${string}`,
            },
        });

        const payloadHash = keccak256(toBytes(payload));

        // Use portfolioContractAccount as source since factory's principal is portfolioContractAccount
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

        const parsedLogs = parseLogs(receipt, router.interface);
        const successEvent = parsedLogs.find((e) => e.name === 'OperationResult')!;
        expect(successEvent.args.success).to.equal(true);

        // Verify factory ownership was transferred
        expect(await factory.owner()).to.equal(newRouter.target);

        // Now use new router to create a new account for a different portfolioLCA
        const newPortfolioLCA = 'agoric1newportfolio123456789abcdefghijk';
        const newAccountAddress = await computeRemoteAccountAddress(
            factory.target.toString(),
            newPortfolioLCA,
        );

        const commandId2 = getCommandId();
        const txId2 = 'createNewAccount1';

        const payload2 = encodeRouterPayload({
            id: txId2,
            expectedAccountAddress: newAccountAddress,
            instructionType: 'RemoteAccountExecute',
            instruction: {
                multiCalls: [],
            },
        });

        const payloadHash2 = keccak256(toBytes(payload2));

        await approveMessage({
            commandId: commandId2,
            from: sourceChain,
            sourceAddress: newPortfolioLCA,
            targetAddress: newRouter.target,
            payload: payloadHash2,
            owner,
            AxelarGateway: axelarGatewayMock,
            abiCoder,
        });

        const tx2 = await newRouter.execute(commandId2, sourceChain, newPortfolioLCA, payload2);
        const receipt2 = await tx2.wait();

        const parsedLogs2 = parseLogs(receipt2, newRouter.interface);
        const successEvent2 = parsedLogs2.find((e) => e.name === 'OperationResult')!;
        expect(successEvent2.args.success).to.equal(true);

        // Verify new account was created and owned by new router
        const newAccount = await ethers.getContractAt('RemoteAccount', newAccountAddress);
        expect(await newAccount.owner()).to.equal(newRouter.target);

        // Verify old router cannot create accounts anymore
        const commandId3 = getCommandId();
        const txId3 = 'createNewAccount2';
        const anotherPortfolioLCA = 'agoric1anotherportfolio123456789abcdefg';
        const anotherAccountAddress = await computeRemoteAccountAddress(
            factory.target.toString(),
            anotherPortfolioLCA,
        );

        const payload3 = encodeRouterPayload({
            id: txId3,
            expectedAccountAddress: anotherAccountAddress,
            instructionType: 'RemoteAccountExecute',
            instruction: {
                multiCalls: [],
            },
        });

        const payloadHash3 = keccak256(toBytes(payload3));

        await approveMessage({
            commandId: commandId3,
            from: sourceChain,
            sourceAddress: anotherPortfolioLCA,
            targetAddress: router.target,
            payload: payloadHash3,
            owner,
            AxelarGateway: axelarGatewayMock,
            abiCoder,
        });

        const tx3 = await router.execute(commandId3, sourceChain, anotherPortfolioLCA, payload3);
        const receipt3 = await tx3.wait();

        const parsedLogs3 = parseLogs(receipt3, router.interface);
        const errorEvent = parsedLogs3.find((e) => e.name === 'OperationResult')!;
        expect(errorEvent.args.success).to.equal(false);

        // Decode error - should be InvalidAccountAtAddress from factory
        const factoryInterface = (await ethers.getContractFactory('RemoteAccountFactory'))
            .interface;
        const decodedError = factoryInterface.parseError(errorEvent.args.reason);
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

        // Compute address for the new account
        const newPortfolioLCA = 'agoric1provideforrouter123456789abcdef';
        const newAccountAddress = await computeRemoteAccountAddress(
            factory.target.toString(),
            newPortfolioLCA,
        );

        // router will call the factory's provideForRouter
        // Must be executed by the router that currently owns the factory
        const commandId = getCommandId();
        const txId = 'tx301';

        // creates account owned by targetRouter
        const payload = encodeRouterPayload({
            id: txId,
            expectedAccountAddress: factory.target as `0x${string}`,
            // @ts-expect-error - removed
            instructionType: 'ProvideForRouter',
            instruction: {
                principalAccount: newPortfolioLCA,
                // @ts-expect-error - removed
                router: targetRouter.target as `0x${string}`,
                expectedAccountAddress: newAccountAddress,
            },
        });

        const payloadHash = keccak256(toBytes(payload));

        await approveMessage({
            commandId,
            from: sourceChain,
            sourceAddress: portfolioContractAccount,
            targetAddress: factoryOwnerRouter.target,
            payload: payloadHash,
            owner,
            AxelarGateway: axelarGatewayMock,
            abiCoder,
        });

        const tx = await factoryOwnerRouter.execute(
            commandId,
            sourceChain,
            portfolioContractAccount,
            payload,
        );
        const receipt = await tx.wait();

        const parsedLogs = parseLogs(receipt, factoryOwnerRouter.interface);
        const successEvent = parsedLogs.find((e) => e.name === 'OperationResult')!;
        expect(successEvent.args.success).to.equal(true);

        // Verify account was created and is owned by targetRouter
        const newAccount = await ethers.getContractAt('RemoteAccount', newAccountAddress);
        expect(await newAccount.owner()).to.equal(targetRouter.target);

        // Verify factory ownership unchanged
        expect(await factory.owner()).to.equal(factoryOwnerAddress);

        // Verify targetRouter can execute multicalls on the new account
        const commandId2 = getCommandId();
        const txId2 = 'tx302';

        const setValueData = encodeFunctionData({
            abi: [
                {
                    name: 'setValue',
                    type: 'function',
                    inputs: [{ name: '_value', type: 'uint256' }],
                },
            ],
            functionName: 'setValue',
            args: [777n],
        });

        const multiCalls2: ContractCall[] = [
            { target: multicallTarget.target as `0x${string}`, data: setValueData },
        ];

        const payload2 = encodeRouterPayload({
            id: txId2,
            expectedAccountAddress: newAccountAddress,
            instructionType: 'RemoteAccountExecute',
            instruction: {
                multiCalls: multiCalls2,
            },
        });

        const payloadHash2 = keccak256(toBytes(payload2));

        await approveMessage({
            commandId: commandId2,
            from: sourceChain,
            sourceAddress: newPortfolioLCA,
            targetAddress: targetRouter.target,
            payload: payloadHash2,
            owner,
            AxelarGateway: axelarGatewayMock,
            abiCoder,
        });

        const tx2 = await targetRouter.execute(commandId2, sourceChain, newPortfolioLCA, payload2);
        const receipt2 = await tx2.wait();

        const parsedLogs2 = parseLogs(receipt2, targetRouter.interface);
        const successEvent2 = parsedLogs2.find((e) => e.name === 'OperationResult')!;
        expect(successEvent2.args.success).to.equal(true);
        expect(await multicallTarget.getValue()).to.equal(777n);

        // Verify factory owner router cannot execute multicalls on the new account (owned by targetRouter)
        const commandId3 = getCommandId();
        const txId3 = 'tx303';

        const payload3 = encodeRouterPayload({
            id: txId3,
            expectedAccountAddress: newAccountAddress,
            instructionType: 'RemoteAccountExecute',
            instruction: {
                multiCalls: multiCalls2,
            },
        });

        const payloadHash3 = keccak256(toBytes(payload3));

        await approveMessage({
            commandId: commandId3,
            from: sourceChain,
            sourceAddress: newPortfolioLCA,
            targetAddress: factoryOwnerRouter.target,
            payload: payloadHash3,
            owner,
            AxelarGateway: axelarGatewayMock,
            abiCoder,
        });

        const tx3 = await factoryOwnerRouter.execute(
            commandId3,
            sourceChain,
            newPortfolioLCA,
            payload3,
        );
        const receipt3 = await tx3.wait();

        const parsedLogs3 = parseLogs(receipt3, factoryOwnerRouter.interface);
        const errorEvent = parsedLogs3.find((e) => e.name === 'OperationResult')!;
        expect(errorEvent.args.success).to.equal(false);

        // Decode error - should be InvalidAccountAtAddress from factory
        const decodedError = factory.interface.parseError(errorEvent.args.reason);
        expect(decodedError?.name).to.equal('InvalidAccountAtAddress');
    });
});

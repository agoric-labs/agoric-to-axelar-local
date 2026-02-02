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

        const errorEvent = parsedLogs.find((e: { name: string }) => e?.name === 'OperationResult');
        expect(errorEvent.args.id.hash).to.equal(keccak256(toBytes(txId)));
        expect(errorEvent.args.success).to.equal(false);
        expect(errorEvent.args.reason).to.not.equal('0x');
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

        const errorEvent = parsedLogs.find((e: { name: string }) => e.name === 'OperationResult');
        expect(errorEvent.args.id.hash).to.equal(keccak256(toBytes(txId)));
        expect(errorEvent.args.success).to.equal(false);
        // Decode error - should be RemoteRepresentativeUnauthorizedPrincipal
        const remoteAccountInterface = (await ethers.getContractFactory('RemoteAccount')).interface;
        const decodedError = remoteAccountInterface.parseError(errorEvent.args.reason);
        expect(decodedError?.name).to.equal('RemoteRepresentativeUnauthorizedPrincipal');
    });

    it('should update owner of remote account through router authority + multicall', async () => {
        // Deploy a new router
        const RouterContract = await ethers.getContractFactory('PortfolioRouter');
        const newRouter = await RouterContract.deploy(
            axelarGatewayMock.target,
            sourceChain,
            portfolioContractCaip2,
            portfolioContractAccount,
            factory.target,
            permit2Mock.target,
            owner.address, // ownerAuthority
        );
        await newRouter.waitForDeployment();

        // Old router authority pre-designates the new owner
        await router.replaceOwner(newRouter.target);

        // Verify replacement owner was set
        expect(await router.replacementOwner()).to.equal(newRouter.target);

        // Verify RemoteAccount is still owned by old router before transfer
        const remoteAccount = await ethers.getContractAt('RemoteAccount', accountAddress);
        expect(await remoteAccount.owner()).to.equal(router.target);

        // Execute multicall to transfer ownership
        const commandId = getCommandId();
        const txId = 'ownerUpdate1';

        // Encode call to RemoteAccount.replaceOwner(newRouter)
        const replaceOwnerData = encodeFunctionData({
            abi: [
                {
                    name: 'replaceOwner',
                    type: 'function',
                    inputs: [{ name: 'newOwner', type: 'address' }],
                },
            ],
            functionName: 'replaceOwner',
            args: [newRouter.target as `0x${string}`],
        });

        // The multicall targets the RemoteAccount itself to call replaceOwner
        const multiCalls: ContractCall[] = [
            {
                target: accountAddress,
                data: replaceOwnerData,
            },
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
            portfolioLCA,
            remoteAccountAddress: accountAddress,
            provideAccount: false,
            depositPermit: [],
            multiCalls: multiCalls2,
        });

        const payloadHash2 = keccak256(toBytes(payload2));

        await approveMessage({
            commandId: commandId2,
            from: sourceChain,
            sourceAddress: portfolioContractAccount,
            targetAddress: router.target,
            payload: payloadHash2,
            owner,
            AxelarGateway: axelarGatewayMock,
            abiCoder,
        });

        const tx2 = await router.execute(
            commandId2,
            sourceChain,
            portfolioContractAccount,
            payload2,
        );
        const receipt2 = await tx2.wait();

        const parsedLogs2 = parseLogs(receipt2, router.interface);

        // Old router should fail
        const errorEvent = parsedLogs2.find((e) => e.name === 'OperationResult')!;
        expect(errorEvent.args.id.hash).to.equal(keccak256(toBytes(txId2)));
        expect(errorEvent.args.success).to.equal(false);

        // Decode error - should be OwnableUnauthorizedAccount
        const ownableInterface = (await ethers.getContractFactory('RemoteAccount')).interface;
        const decodedError = ownableInterface.parseError(errorEvent.args.reason);
        expect(decodedError?.name).to.equal('OwnableUnauthorizedAccount');

        // New router should succeed
        const commandId3 = getCommandId();
        const txId3 = 'ownerUpdate3';

        const payload3 = encodeRouterPayload({
            id: txId3,
            portfolioLCA,
            remoteAccountAddress: accountAddress,
            provideAccount: false,
            depositPermit: [],
            multiCalls: multiCalls2, // same setValue(999) call
        });

        const payloadHash3 = keccak256(toBytes(payload3));

        await approveMessage({
            commandId: commandId3,
            from: sourceChain,
            sourceAddress: portfolioContractAccount,
            targetAddress: newRouter.target,
            payload: payloadHash3,
            owner,
            AxelarGateway: axelarGatewayMock,
            abiCoder,
        });

        const tx3 = await newRouter.execute(
            commandId3,
            sourceChain,
            portfolioContractAccount,
            payload3,
        );
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
        const RouterContract = await ethers.getContractFactory('PortfolioRouter');
        const newRouter = await RouterContract.deploy(
            axelarGatewayMock.target,
            sourceChain,
            portfolioContractCaip2,
            portfolioContractAccount,
            factory.target,
            permit2Mock.target,
            owner.address, // ownerAuthority
        );
        await newRouter.waitForDeployment();

        // Old router authority pre-designates the new owner
        await router.replaceOwner(newRouter.target);

        // Verify factory is currently owned by old router
        expect(await factory.owner()).to.equal(router.target);

        // Transfer factory ownership via multicall
        const commandId = getCommandId();
        const txId = 'factoryOwnerUpdate1';

        const replaceOwnerData = encodeFunctionData({
            abi: [
                {
                    name: 'replaceOwner',
                    type: 'function',
                    inputs: [{ name: 'newOwner', type: 'address' }],
                },
            ],
            functionName: 'replaceOwner',
            args: [newRouter.target as `0x${string}`],
        });

        // Target the factory to call replaceOwner
        const multiCalls: ContractCall[] = [
            {
                target: factory.target as `0x${string}`,
                data: replaceOwnerData,
            },
        ];

        const payload = encodeRouterPayload({
            id: txId,
            portfolioLCA: portfolioContractAccount,
            remoteAccountAddress: factory.target as `0x${string}`,
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

        const parsedLogs = parseLogs(receipt, router.interface);
        const successEvent = parsedLogs.find((e) => e.name === 'OperationResult')!;
        expect(successEvent.args.success).to.equal(true);

        // Verify factory ownership was transferred
        expect(await factory.owner()).to.equal(newRouter.target);

        // Now use new router to create a new account for a different portfolioLCA
        const newPortfolioLCA = 'agoric1newportfolio123456789abcdefghijk';
        const newAccountAddress = await computeRemoteAccountAddress(
            factory.target.toString(),
            portfolioContractCaip2,
            newPortfolioLCA,
        );

        const commandId2 = getCommandId();
        const txId2 = 'createNewAccount1';

        const payload2 = encodeRouterPayload({
            id: txId2,
            portfolioLCA: newPortfolioLCA,
            remoteAccountAddress: newAccountAddress,
            provideAccount: true, // Create the new account
            depositPermit: [],
            multiCalls: [],
        });

        const payloadHash2 = keccak256(toBytes(payload2));

        await approveMessage({
            commandId: commandId2,
            from: sourceChain,
            sourceAddress: portfolioContractAccount,
            targetAddress: newRouter.target,
            payload: payloadHash2,
            owner,
            AxelarGateway: axelarGatewayMock,
            abiCoder,
        });

        const tx2 = await newRouter.execute(
            commandId2,
            sourceChain,
            portfolioContractAccount,
            payload2,
        );
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
            portfolioContractCaip2,
            anotherPortfolioLCA,
        );

        const payload3 = encodeRouterPayload({
            id: txId3,
            portfolioLCA: anotherPortfolioLCA,
            remoteAccountAddress: anotherAccountAddress,
            provideAccount: true,
            depositPermit: [],
            multiCalls: [],
        });

        const payloadHash3 = keccak256(toBytes(payload3));

        await approveMessage({
            commandId: commandId3,
            from: sourceChain,
            sourceAddress: portfolioContractAccount,
            targetAddress: router.target,
            payload: payloadHash3,
            owner,
            AxelarGateway: axelarGatewayMock,
            abiCoder,
        });

        const tx3 = await router.execute(
            commandId3,
            sourceChain,
            portfolioContractAccount,
            payload3,
        );
        const receipt3 = await tx3.wait();

        const parsedLogs3 = parseLogs(receipt3, router.interface);
        const errorEvent = parsedLogs3.find((e) => e.name === 'OperationResult')!;
        expect(errorEvent.args.success).to.equal(false);

        // Decode error - should be UnauthorizedRouter from factory
        const factoryInterface = (await ethers.getContractFactory('RemoteAccountFactory'))
            .interface;
        const decodedError = factoryInterface.parseError(errorEvent.args.reason);
        expect(decodedError?.name).to.equal('UnauthorizedRouter');
    });
});

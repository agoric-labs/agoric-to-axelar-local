import AxelarGasService from '@axelar-network/axelar-cgp-solidity/artifacts/contracts/gas-service/AxelarGasService.sol/AxelarGasService.json';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { ethers } from 'hardhat';
import '@nomicfoundation/hardhat-chai-matchers';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { keccak256, stringToHex, toBytes } from 'viem';
import { approveMessage, computeRemoteAccountAddress, encodeRouterPayload } from './lib/utils';

describe('RemoteAccountAxelarRouter - RemoteAccountCreation', () => {
    let owner: HardhatEthersSigner, addr1: HardhatEthersSigner;
    let axelarGatewayMock: Contract, axelarGasServiceMock: Contract;
    let factory: Contract, router: Contract, permit2Mock: Contract;

    const abiCoder = new ethers.AbiCoder();

    const sourceChain = 'agoric';
    const portfolioContractCaip2 = 'cosmos:agoric-3';
    const portfolioContractAccount = 'agoric1routerlca123456789abcdefghijklmnopqrs';
    const portfolioLCA = 'agoric1portfolio123456789abcdefghijklmnopqrs';

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
    });

    it('should reject invalid source chain', async () => {
        const commandId = getCommandId();
        const wrongSourceChain = 'ethereum';

        const expectedAccountAddress = await computeRemoteAccountAddress(
            factory.target.toString(),
            portfolioLCA,
        );

        const payload = encodeRouterPayload({
            id: 'tx2',
            expectedAccountAddress,
            provideAccount: true,
            depositPermit: [],
            multiCalls: [],
        });

        const payloadHash = keccak256(toBytes(payload));

        await approveMessage({
            commandId,
            from: wrongSourceChain,
            sourceAddress: portfolioLCA,
            targetAddress: router.target,
            payload: payloadHash,
            owner,
            AxelarGateway: axelarGatewayMock,
            abiCoder,
        });

        await expect(
            router.execute(commandId, wrongSourceChain, portfolioLCA, payload),
        ).to.be.revertedWithCustomError(router, 'InvalidSourceChain');
    });

    it('should reject when source address does not match expected account', async () => {
        const commandId = getCommandId();
        const wrongSourceAddress = 'agoric1wrongaddress123456789abcdefghijk';

        const expectedAccountAddress = await computeRemoteAccountAddress(
            factory.target.toString(),
            portfolioLCA,
        );

        const payload = encodeRouterPayload({
            id: 'tx3',
            expectedAccountAddress,
            provideAccount: true,
            depositPermit: [],
            multiCalls: [],
        });

        const payloadHash = keccak256(toBytes(payload));

        await approveMessage({
            commandId,
            from: sourceChain,
            sourceAddress: wrongSourceAddress,
            targetAddress: router.target,
            payload: payloadHash,
            owner,
            AxelarGateway: axelarGatewayMock,
            abiCoder,
        });

        const tx = await router.execute(commandId, sourceChain, wrongSourceAddress, payload);
        const receipt = await tx.wait();

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

        // Check OperationResult event - should fail due to address mismatch
        const errorEvent = parsedLogs.find((e: { name: string }) => e?.name === 'OperationResult');
        expect(errorEvent.args.success).to.equal(false);

        // Decode the error reason - should be AddressMismatch from factory
        const factoryInterface = factory.interface;
        const decodedError = factoryInterface.parseError(errorEvent.args.reason);
        expect(decodedError?.name).to.equal('AddressMismatch');
    });

    it('should provide RemoteAccount via router', async () => {
        const commandId = getCommandId();
        const txId = 'tx1';

        const expectedAccountAddress = await computeRemoteAccountAddress(
            factory.target.toString(),
            portfolioLCA,
        );

        const payload = encodeRouterPayload({
            id: txId,
            expectedAccountAddress,
            provideAccount: true,
            depositPermit: [],
            multiCalls: [],
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

        // Check OperationResult event
        const successEvent = parsedLogs.find(
            (e: { name: string }) => e?.name === 'OperationResult',
        );
        expect(successEvent.args.id.hash).to.equal(keccak256(toBytes(txId)));
        expect(successEvent.args.success).to.equal(true);

        // Verify RemoteAccount exists with correct ownership
        const RemoteAccountContract = await ethers.getContractFactory('RemoteAccount');
        const account = RemoteAccountContract.attach(expectedAccountAddress);
        expect(await account.owner()).to.equal(router.target);
    });

    it('should be idempotent - providing same account twice succeeds with created=false', async () => {
        const commandId = getCommandId();
        const txId = 'tx4';
        // Use the same portfolioLCA from the first test - account already exists
        const expectedAccountAddress = await computeRemoteAccountAddress(
            factory.target.toString(),
            portfolioLCA,
        );

        const payload = encodeRouterPayload({
            id: txId,
            expectedAccountAddress,
            provideAccount: true,
            depositPermit: [],
            multiCalls: [],
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

        // Check OperationResult event (idempotent - succeeds even if account exists)
        const successEvent = parsedLogs.find(
            (e: { name: string }) => e?.name === 'OperationResult',
        );
        expect(successEvent.args.id.hash).to.equal(keccak256(toBytes(txId)));
        expect(successEvent.args.success).to.equal(true);

        // Verify account still exists with correct owner
        const RemoteAccountContract = await ethers.getContractFactory('RemoteAccount');
        const account = RemoteAccountContract.attach(expectedAccountAddress);
        expect(await account.owner()).to.equal(router.target);
    });

    it('should reject when expected address does not match', async () => {
        const commandId = getCommandId();
        const txId = 'tx5';
        const newPortfolioLCA = 'agoric1newportfolio123456789abcdefghijk';

        // Compute wrong address (using different portfolioLCA)
        const wrongAddress = await computeRemoteAccountAddress(
            factory.target.toString(),
            'agoric1differentlca123456789abcdefghijk',
        );

        const payload = encodeRouterPayload({
            id: txId,
            expectedAccountAddress: wrongAddress, // Wrong address for this portfolioLCA
            provideAccount: true,
            depositPermit: [],
            multiCalls: [],
        });

        const payloadHash = keccak256(toBytes(payload));

        // Use newPortfolioLCA as source address (fresh account)
        await approveMessage({
            commandId,
            from: sourceChain,
            sourceAddress: newPortfolioLCA,
            targetAddress: router.target,
            payload: payloadHash,
            owner,
            AxelarGateway: axelarGatewayMock,
            abiCoder,
        });

        const tx = await router.execute(commandId, sourceChain, newPortfolioLCA, payload);
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

        // Check OperationResult event (failure due to address mismatch)
        const errorEvent = parsedLogs.find((e: { name: string }) => e?.name === 'OperationResult');
        expect(errorEvent.args.success).to.equal(false);
        expect(errorEvent.args.id.hash).to.equal(keccak256(toBytes(txId)));

        // Decode the error reason
        const reason = errorEvent.args.reason;
        expect(reason).to.not.equal('0x');

        // Parse the custom error from factory
        const factoryInterface = factory.interface;
        const decodedError = factoryInterface.parseError(reason);
        expect(decodedError?.name).to.equal('AddressMismatch');

        // Verify error contains the expected vs actual addresses
        const expectedCorrectAddress = await computeRemoteAccountAddress(
            factory.target.toString(),
            newPortfolioLCA,
        );
        expect(decodedError?.args.expected).to.equal(wrongAddress);
        expect(decodedError?.args.actual).to.equal(expectedCorrectAddress);
    });

    it('should reject when ownership was transferred away from router', async () => {
        const commandId1 = getCommandId();
        const commandId2 = getCommandId();
        const txId1 = 'tx6';
        const txId2 = 'tx7';
        const transferTestLCA = 'agoric1transfertest123456789abcdefghij';

        const expectedAccountAddress = await computeRemoteAccountAddress(
            factory.target.toString(),
            transferTestLCA,
        );

        // Step 1: Create account via router
        const payload1 = encodeRouterPayload({
            id: txId1,
            expectedAccountAddress,
            provideAccount: true,
            depositPermit: [],
            multiCalls: [],
        });

        const payloadHash1 = keccak256(toBytes(payload1));

        await approveMessage({
            commandId: commandId1,
            from: sourceChain,
            sourceAddress: transferTestLCA,
            targetAddress: router.target,
            payload: payloadHash1,
            owner,
            AxelarGateway: axelarGatewayMock,
            abiCoder,
        });

        await router.execute(commandId1, sourceChain, transferTestLCA, payload1);

        // Step 2: Transfer ownership away from router (impersonate router)
        const account = await ethers.getContractAt('RemoteAccount', expectedAccountAddress);

        await ethers.provider.send('hardhat_impersonateAccount', [router.target.toString()]);
        await owner.sendTransaction({ to: router.target, value: ethers.parseEther('1') });
        const routerSigner = await ethers.getSigner(router.target.toString());

        await account.connect(routerSigner).getFunction('transferOwnership')(addr1.address);
        await ethers.provider.send('hardhat_stopImpersonatingAccount', [router.target.toString()]);

        // Verify ownership transferred
        expect(await account.owner()).to.equal(addr1.address);

        // Step 3: Try to provide again via router - should fail
        const payload2 = encodeRouterPayload({
            id: txId2,
            expectedAccountAddress,
            provideAccount: true,
            depositPermit: [],
            multiCalls: [],
        });

        const payloadHash2 = keccak256(toBytes(payload2));

        await approveMessage({
            commandId: commandId2,
            from: sourceChain,
            sourceAddress: transferTestLCA,
            targetAddress: router.target,
            payload: payloadHash2,
            owner,
            AxelarGateway: axelarGatewayMock,
            abiCoder,
        });

        const tx = await router.execute(commandId2, sourceChain, transferTestLCA, payload2);
        const receipt = await tx.wait();

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

        // Check OperationResult event (failure due to ownership transferred)
        const errorEvent = parsedLogs.find((e: { name: string }) => e?.name === 'OperationResult');
        expect(errorEvent.args.success).to.equal(false);
        expect(errorEvent.args.id.hash).to.equal(keccak256(toBytes(txId2)));

        // Decode the error - should be InvalidAccountAtAddress
        const reason = errorEvent.args.reason;
        expect(reason).to.not.equal('0x');

        const factoryInterface = factory.interface;
        const decodedError = factoryInterface.parseError(reason);
        expect(decodedError?.name).to.equal('InvalidAccountAtAddress');
        expect(decodedError?.args.account).to.equal(expectedAccountAddress);
    });

    it('should be protected from front-running - factory rejects unauthorized routers', async () => {
        const frontRunLCA = 'agoric1frontruntest123456789abcdefghij';

        // Compute the expected address
        const expectedAddress = await computeRemoteAccountAddress(
            factory.target.toString(),
            frontRunLCA,
        );

        // Attacker tries to front-run by calling factory.provide directly
        // This should revert because factory only accepts calls from its owner (router)
        await expect(
            factory.provide(
                frontRunLCA,
                addr1.address, // attacker tries to use themselves as router
                expectedAddress,
            ),
        ).to.be.revertedWithCustomError(factory, 'UnauthorizedRouter');
    });
});

import AxelarGasService from '@axelar-network/axelar-cgp-solidity/artifacts/contracts/gas-service/AxelarGasService.sol/AxelarGasService.json';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { ethers } from 'hardhat';
import '@nomicfoundation/hardhat-chai-matchers';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { keccak256, stringToHex, toBytes, encodeAbiParameters } from 'viem';
import { approveMessage } from './lib/utils';

/**
 * Compute CREATE2 address for RemoteAccount
 */
const computeRemoteAccountAddress = async (factoryAddress: string, portfolioLCA: string) => {
    const salt = ethers.solidityPackedKeccak256(['string'], [portfolioLCA]);

    const RemoteAccountFactory = await ethers.getContractFactory('RemoteAccount');
    const constructorArgs = ethers.AbiCoder.defaultAbiCoder().encode(['string'], [portfolioLCA]);
    const initCode = ethers.solidityPacked(
        ['bytes', 'bytes'],
        [RemoteAccountFactory.bytecode, constructorArgs],
    );
    const initCodeHash = ethers.keccak256(initCode);

    return ethers.getCreate2Address(factoryAddress, salt, initCodeHash) as `0x${string}`;
};

interface ContractCall {
    target: `0x${string}`;
    data: `0x${string}`;
}

interface DepositPermit {
    tokenOwner: `0x${string}`;
    permit: {
        permitted: {
            token: `0x${string}`;
            amount: bigint;
        };
        nonce: bigint;
        deadline: bigint;
    };
    witness: `0x${string}`;
    witnessTypeString: string;
    signature: `0x${string}`;
}

interface RouterPayloadParams {
    id: string;
    portfolioLCA: string;
    remoteAccountAddress: `0x${string}`;
    provideAccount: boolean;
    depositPermit?: DepositPermit[];
    multiCalls?: ContractCall[];
}

/**
 * Encode RouterPayload for PortfolioRouter
 */
const encodeRouterPayload = ({
    id,
    portfolioLCA,
    remoteAccountAddress,
    provideAccount,
    depositPermit = [],
    multiCalls = [],
}: RouterPayloadParams) => {
    return encodeAbiParameters(
        [
            {
                type: 'tuple',
                components: [
                    { name: 'id', type: 'string' },
                    { name: 'portfolioLCA', type: 'string' },
                    { name: 'remoteAccountAddress', type: 'address' },
                    { name: 'provideAccount', type: 'bool' },
                    {
                        name: 'depositPermit',
                        type: 'tuple[]',
                        components: [
                            { name: 'tokenOwner', type: 'address' },
                            {
                                name: 'permit',
                                type: 'tuple',
                                components: [
                                    {
                                        name: 'permitted',
                                        type: 'tuple',
                                        components: [
                                            { name: 'token', type: 'address' },
                                            { name: 'amount', type: 'uint256' },
                                        ],
                                    },
                                    { name: 'nonce', type: 'uint256' },
                                    { name: 'deadline', type: 'uint256' },
                                ],
                            },
                            { name: 'witness', type: 'bytes32' },
                            { name: 'witnessTypeString', type: 'string' },
                            { name: 'signature', type: 'bytes' },
                        ],
                    },
                    {
                        name: 'multiCalls',
                        type: 'tuple[]',
                        components: [
                            { name: 'target', type: 'address' },
                            { name: 'data', type: 'bytes' },
                        ],
                    },
                ],
            },
        ],
        [
            {
                id,
                portfolioLCA,
                remoteAccountAddress,
                provideAccount,
                depositPermit,
                multiCalls,
            },
        ],
    );
};

describe('PortfolioRouter', () => {
    let owner: HardhatEthersSigner, addr1: HardhatEthersSigner;
    let axelarGatewayMock: Contract, axelarGasServiceMock: Contract;
    let factory: Contract, router: Contract, permit2Mock: Contract;

    const abiCoder = new ethers.AbiCoder();

    const sourceChain = 'agoric';
    const agoricLCA = 'agoric1routerlca123456789abcdefghijklmnopqrs';
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
        factory = await FactoryContract.deploy();
        await factory.waitForDeployment();

        // Deploy PortfolioRouter
        const RouterContract = await ethers.getContractFactory('PortfolioRouter');
        router = await RouterContract.deploy(
            axelarGatewayMock.target,
            factory.target,
            permit2Mock.target,
            agoricLCA,
        );
        await router.waitForDeployment();
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
            portfolioLCA,
            remoteAccountAddress: expectedAccountAddress,
            provideAccount: true,
            depositPermit: [],
            multiCalls: [],
        });

        const payloadHash = keccak256(toBytes(payload));

        await approveMessage({
            commandId,
            from: wrongSourceChain,
            sourceAddress: agoricLCA,
            targetAddress: router.target,
            payload: payloadHash,
            owner,
            AxelarGateway: axelarGatewayMock,
            abiCoder,
        });

        await expect(
            router.execute(commandId, wrongSourceChain, agoricLCA, payload),
        ).to.be.revertedWithCustomError(router, 'InvalidSourceChain');
    });

    it('should reject invalid source address', async () => {
        const commandId = getCommandId();
        const wrongSourceAddress = 'agoric1wrongaddress123456789abcdefghijk';

        const expectedAccountAddress = await computeRemoteAccountAddress(
            factory.target.toString(),
            portfolioLCA,
        );

        const payload = encodeRouterPayload({
            id: 'tx3',
            portfolioLCA,
            remoteAccountAddress: expectedAccountAddress,
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

        await expect(
            router.execute(commandId, sourceChain, wrongSourceAddress, payload),
        ).to.be.revertedWithCustomError(router, 'InvalidSourceAddress');
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
            portfolioLCA,
            remoteAccountAddress: expectedAccountAddress,
            provideAccount: true,
            depositPermit: [],
            multiCalls: [],
        });

        const payloadHash = keccak256(toBytes(payload));

        await approveMessage({
            commandId,
            from: sourceChain,
            sourceAddress: agoricLCA,
            targetAddress: router.target,
            payload: payloadHash,
            owner,
            AxelarGateway: axelarGatewayMock,
            abiCoder,
        });

        const tx = await router.execute(commandId, sourceChain, agoricLCA, payload);
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

        // Check RemoteAccountStatus event (success, created=true)
        const accountStatusEvent = parsedLogs.find(
            (e: { name: string }) => e?.name === 'RemoteAccountStatus',
        );
        expect(accountStatusEvent).to.not.be.undefined;
        expect(accountStatusEvent?.args.id.hash).to.equal(keccak256(toBytes(txId)));
        expect(accountStatusEvent?.args.success).to.be.true;
        expect(accountStatusEvent?.args.created).to.be.true;
        expect(accountStatusEvent?.args.account).to.equal(expectedAccountAddress);

        // Verify RemoteAccount ownership and controller
        const RemoteAccountFactory = await ethers.getContractFactory('RemoteAccount');
        const account = RemoteAccountFactory.attach(expectedAccountAddress);
        expect(await account.owner()).to.equal(router.target);
        expect(await account.controller()).to.equal(portfolioLCA);
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
            portfolioLCA,
            remoteAccountAddress: expectedAccountAddress,
            provideAccount: true,
            depositPermit: [],
            multiCalls: [],
        });

        const payloadHash = keccak256(toBytes(payload));

        await approveMessage({
            commandId,
            from: sourceChain,
            sourceAddress: agoricLCA,
            targetAddress: router.target,
            payload: payloadHash,
            owner,
            AxelarGateway: axelarGatewayMock,
            abiCoder,
        });

        const tx = await router.execute(commandId, sourceChain, agoricLCA, payload);
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

        // Check RemoteAccountStatus event (success=true, created=false)
        const accountStatusEvent = parsedLogs.find(
            (e: { name: string }) => e?.name === 'RemoteAccountStatus',
        );
        expect(accountStatusEvent).to.not.be.undefined;
        expect(accountStatusEvent?.args.id.hash).to.equal(keccak256(toBytes(txId)));
        expect(accountStatusEvent?.args.success).to.be.true;
        expect(accountStatusEvent?.args.created).to.be.false; // Already exists
        expect(accountStatusEvent?.args.account).to.equal(expectedAccountAddress);
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
            portfolioLCA: newPortfolioLCA,
            remoteAccountAddress: wrongAddress, // Wrong address for this portfolioLCA
            provideAccount: true,
            depositPermit: [],
            multiCalls: [],
        });

        const payloadHash = keccak256(toBytes(payload));

        await approveMessage({
            commandId,
            from: sourceChain,
            sourceAddress: agoricLCA,
            targetAddress: router.target,
            payload: payloadHash,
            owner,
            AxelarGateway: axelarGatewayMock,
            abiCoder,
        });

        const tx = await router.execute(commandId, sourceChain, agoricLCA, payload);
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

        // Check RemoteAccountStatus event (success=false due to address mismatch)
        const accountStatusEvent = parsedLogs.find(
            (e: { name: string }) => e?.name === 'RemoteAccountStatus',
        );
        expect(accountStatusEvent).to.not.be.undefined;
        expect(accountStatusEvent?.args.id.hash).to.equal(keccak256(toBytes(txId)));
        expect(accountStatusEvent?.args.success).to.be.false;
        expect(accountStatusEvent?.args.reason).to.not.equal('0x'); // Has error reason
    });
});

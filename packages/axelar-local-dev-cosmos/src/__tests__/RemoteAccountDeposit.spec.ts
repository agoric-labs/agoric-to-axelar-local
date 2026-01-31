import AxelarGasService from '@axelar-network/axelar-cgp-solidity/artifacts/contracts/gas-service/AxelarGasService.sol/AxelarGasService.json';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { ethers } from 'hardhat';
import '@nomicfoundation/hardhat-chai-matchers';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { keccak256, stringToHex, toBytes } from 'viem';
import {
    approveMessage,
    computeRemoteAccountAddress,
    encodeRouterPayload,
    DepositPermit,
} from './lib/utils';

/**
 * Tests for RemoteAccount deposit functionality via PortfolioRouter.
 *
 * Uses MockPermit2 which simplifies signature verification for testing.
 */
describe('PortfolioRouter - RemoteAccountDeposit', () => {
    let owner: HardhatEthersSigner, addr1: HardhatEthersSigner;
    let axelarGatewayMock: Contract, axelarGasServiceMock: Contract;
    let factory: Contract, router: Contract, permit2Mock: Contract;
    let testToken: Contract;
    let accountAddress: `0x${string}`;

    const abiCoder = new ethers.AbiCoder();

    const sourceChain = 'agoric';
    const portfolioContractCaip2 = 'cosmos:agoric-3';
    const portfolioContractAccount = 'agoric1routerlca123456789abcdefghijklmnopqrs';
    const portfolioLCA = 'agoric1deposit123456789abcdefghijklmnopq';

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

        // Deploy test token
        const MockERC20Factory = await ethers.getContractFactory('MockERC20');
        testToken = await MockERC20Factory.deploy('Test USDC', 'USDC', 18);
        await testToken.waitForDeployment();

        // Mint tokens to owner and approve Permit2
        await testToken.mint(owner.address, ethers.parseEther('10000'));
        await testToken.approve(permit2Mock.target, ethers.MaxUint256);

        // Compute account address
        accountAddress = await computeRemoteAccountAddress(
            factory.target.toString(),
            portfolioContractCaip2,
            portfolioLCA,
        );
    });

    it('should create account and deposit tokens in single call', async () => {
        const commandId = getCommandId();
        const txId = 'deposit1';
        const depositAmount = ethers.parseEther('100');

        const depositPermit: DepositPermit[] = [
            {
                tokenOwner: owner.address as `0x${string}`,
                permit: {
                    permitted: {
                        token: testToken.target.toString() as `0x${string}`,
                        amount: depositAmount,
                    },
                    nonce: 0n,
                    deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
                },
                witness: ethers.ZeroHash as `0x${string}`,
                witnessTypeString: 'Deposit(address account)',
                signature: ('0x' + '00'.repeat(65)) as `0x${string}`,
            },
        ];

        const payload = encodeRouterPayload({
            id: txId,
            portfolioLCA,
            remoteAccountAddress: accountAddress,
            provideAccount: true,
            depositPermit,
            multiCalls: [],
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

        const balanceBefore = await testToken.balanceOf(accountAddress);

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

        // Check OperationSuccess event
        const successEvent = parsedLogs.find(
            (e: { name: string }) => e.name === 'OperationSuccess',
        );
        expect(successEvent?.args.id.hash).to.equal(keccak256(toBytes(txId)));

        // Verify token balance
        const balanceAfter = await testToken.balanceOf(accountAddress);
        expect(balanceAfter - balanceBefore).to.equal(depositAmount);
    });

    it('should fail deposit with expired deadline', async () => {
        const commandId = getCommandId();
        const txId = 'deposit2';
        const depositAmount = ethers.parseEther('50');

        // Use expired deadline (1 hour ago)
        const expiredDeadline = BigInt(Math.floor(Date.now() / 1000) - 3600);

        const depositPermit: DepositPermit[] = [
            {
                tokenOwner: owner.address as `0x${string}`,
                permit: {
                    permitted: {
                        token: testToken.target.toString() as `0x${string}`,
                        amount: depositAmount,
                    },
                    nonce: 1n,
                    deadline: expiredDeadline,
                },
                witness: ethers.ZeroHash as `0x${string}`,
                witnessTypeString: 'Deposit(address account)',
                signature: ('0x' + '00'.repeat(65)) as `0x${string}`,
            },
        ];

        const payload = encodeRouterPayload({
            id: txId,
            portfolioLCA,
            remoteAccountAddress: accountAddress,
            provideAccount: false,
            depositPermit,
            multiCalls: [],
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

        // Check OperationError event - should fail due to expired deadline
        const errorEvent = parsedLogs.find((e: { name: string }) => e?.name === 'OperationError');
        expect(errorEvent?.args.id.hash).to.equal(keccak256(toBytes(txId)));
        expect(errorEvent?.args.reason).to.not.equal('0x');
    });
});

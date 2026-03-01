import AxelarGasService from '@axelar-network/axelar-cgp-solidity/artifacts/contracts/gas-service/AxelarGasService.sol/AxelarGasService.json';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { ethers } from 'hardhat';
import '@nomicfoundation/hardhat-chai-matchers';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { computeRemoteAccountAddress, routed } from './lib/utils';
import type { DepositPermit } from '../interfaces/router.ts';

/**
 * Tests for RemoteAccount deposit functionality via RemoteAccountAxelarRouter.
 *
 * Uses MockPermit2 which simplifies signature verification for testing.
 */
describe('RemoteAccountAxelarRouter - RemoteAccountDeposit', () => {
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

        // Deploy test token
        const MockERC20Factory = await ethers.getContractFactory('MockERC20');
        testToken = await MockERC20Factory.deploy('Test USDC', 'USDC', 18);
        await testToken.waitForDeployment();

        // Mint tokens to owner and approve Permit2
        await testToken.mint(owner.address, ethers.parseEther('10000'));
        await testToken.approve(permit2Mock.target, ethers.MaxUint256);

        // Compute account address
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

    it('should create account and deposit tokens in single call', async () => {
        const depositAmount = ethers.parseEther('100');

        const depositPermit: DepositPermit[] = [
            {
                owner: owner.address as `0x${string}`,
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

        const balanceBefore = await testToken.balanceOf(accountAddress);
        const receipt = await route(portfolioContractAccount).doProvideRemoteAccount({
            depositPermit,
            principalAccount: portfolioLCA,
            expectedAccountAddress: accountAddress,
        });
        receipt.expectOperationSuccess();

        // Verify token balance
        const balanceAfter = await testToken.balanceOf(accountAddress);
        expect(balanceAfter - balanceBefore).to.equal(depositAmount);
    });

    it('should fail deposit with expired deadline', async () => {
        const depositAmount = ethers.parseEther('50');

        // Use expired deadline (1 hour ago)
        const expiredDeadline = BigInt(Math.floor(Date.now() / 1000) - 3600);

        const depositPermit: DepositPermit[] = [
            {
                owner: owner.address as `0x${string}`,
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

        const receipt = await route(portfolioContractAccount).doProvideRemoteAccount({
            depositPermit,
            principalAccount: portfolioLCA,
            expectedAccountAddress: accountAddress,
        });
        const errorEvent = receipt.expectOperationFailure();
        expect(errorEvent.args.reason).to.not.equal('0x');
    });

    it('should succeed deposit-only to existing valid RemoteAccount', async () => {
        // Account was created in first test, now deposit without provision or multicall
        const depositAmount = ethers.parseEther('25');

        const depositPermit: DepositPermit[] = [
            {
                owner: owner.address as `0x${string}`,
                permit: {
                    permitted: {
                        token: testToken.target as `0x${string}`,
                        amount: depositAmount,
                    },
                    nonce: 2n,
                    deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
                },
                witness: ethers.ZeroHash as `0x${string}`,
                witnessTypeString: 'Deposit(address account)',
                signature: ('0x' + '00'.repeat(65)) as `0x${string}`,
            },
        ];

        const balanceBefore = await testToken.balanceOf(accountAddress);
        const receipt = await route(portfolioContractAccount).doProvideRemoteAccount({
            depositPermit,
            principalAccount: portfolioLCA,
            expectedAccountAddress: accountAddress,
        });
        receipt.expectOperationSuccess();

        const balanceAfter = await testToken.balanceOf(accountAddress);
        expect(balanceAfter - balanceBefore).to.equal(depositAmount);
    });

    it('should reject deposit-only to address with wrong principal', async () => {
        // Create account for a different portfolioLCA
        const wrongPortfolioLCA = 'agoric1wrongprincipal123456789abcdefgh';
        const wrongAccountAddress = await route(wrongPortfolioLCA).getRemoteAccountAddress();

        // First create this account
        await route(wrongPortfolioLCA).doRemoteAccountExecute({ multiCalls: [] });

        // Now try to deposit to wrongAccountAddress but with original portfolioLCA
        const depositAmount = ethers.parseEther('10');

        const depositPermit: DepositPermit[] = [
            {
                owner: owner.address as `0x${string}`,
                permit: {
                    permitted: {
                        token: testToken.target.toString() as `0x${string}`,
                        amount: depositAmount,
                    },
                    nonce: 3n,
                    deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
                },
                witness: ethers.ZeroHash as `0x${string}`,
                witnessTypeString: 'Deposit(address account)',
                signature: ('0x' + '00'.repeat(65)) as `0x${string}`,
            },
        ];

        const receipt = await route(portfolioContractAccount).doProvideRemoteAccount({
            depositPermit,
            principalAccount: portfolioLCA,
            expectedAccountAddress: wrongAccountAddress, // But wrong account address
        });

        const decodedError = receipt.parseOperationError(factory.interface);
        expect(decodedError?.name).to.equal('AddressMismatch');
        expect(decodedError?.args.expected).to.equal(wrongAccountAddress);
        expect(decodedError?.args.actual).to.equal(accountAddress);
    });

    it('should reject deposit from source other than factory principal', async () => {
        const depositAmount = ethers.parseEther('10');

        const depositPermit: DepositPermit[] = [
            {
                owner: owner.address as `0x${string}`,
                permit: {
                    permitted: {
                        token: testToken.target.toString() as `0x${string}`,
                        amount: depositAmount,
                    },
                    nonce: 3n,
                    deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
                },
                witness: ethers.ZeroHash as `0x${string}`,
                witnessTypeString: 'Deposit(address account)',
                signature: ('0x' + '00'.repeat(65)) as `0x${string}`,
            },
        ];

        const receipt = await route(portfolioContractAccount, {
            sourceAddress: portfolioLCA,
        }).doProvideRemoteAccount({
            depositPermit,
            principalAccount: portfolioLCA,
            expectedAccountAddress: accountAddress,
        });

        const decodedError = receipt.parseOperationError(factory.interface);
        expect(decodedError?.name).to.equal('PrincipalAccountMismatch');
        expect(decodedError?.args.expected).to.equal(portfolioLCA);
        expect(decodedError?.args.actual).to.equal(portfolioContractAccount);
    });
});

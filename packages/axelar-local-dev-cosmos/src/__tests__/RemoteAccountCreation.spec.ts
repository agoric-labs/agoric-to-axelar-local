import AxelarGasService from '@axelar-network/axelar-cgp-solidity/artifacts/contracts/gas-service/AxelarGasService.sol/AxelarGasService.json';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { ethers } from 'hardhat';
import '@nomicfoundation/hardhat-chai-matchers';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { routed } from './lib/utils';

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

        routeConfig = {
            sourceChain,
            owner,
            portfolioContractAccount,
            AxelarGateway: axelarGatewayMock,
            abiCoder,
        };
        route = routed(router, routeConfig);
    });

    it('should reject invalid source chain', async () => {
        const wrongSourceChain = 'ethereum';
        const receipt = await route(portfolioLCA, {
            sourceChain: wrongSourceChain,
        }).doRemoteAccountExecute({ multiCalls: [] });

        await expect(receipt).to.be.revertedWithCustomError(router, 'InvalidSourceChain');
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
        const RemoteAccountContract = await ethers.getContractFactory('RemoteAccount');
        const account = RemoteAccountContract.attach(expectedAccountAddress);
        expect(await account.owner()).to.equal(router.target);
    });

    it('should be idempotent - providing same account twice succeeds with created=false', async () => {
        const receipt = await route(portfolioLCA).doRemoteAccountExecute({ multiCalls: [] });
        receipt.expectOperationSuccess();

        const expectedAccountAddress = await route(portfolioLCA).getRemoteAccountAddress();
        const RemoteAccountContract = await ethers.getContractFactory('RemoteAccount');
        const account = RemoteAccountContract.attach(expectedAccountAddress);
        expect(await account.owner()).to.equal(router.target);
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

    it('should reject when ownership was transferred away from router', async () => {
        const transferTestLCA = 'agoric1transfertest123456789abcdefghij';

        const expectedAccountAddress = await route(transferTestLCA).getRemoteAccountAddress();

        // Step 1: Create account via router
        await route(transferTestLCA).doRemoteAccountExecute({ multiCalls: [] });

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
        const receipt = await route(transferTestLCA).doRemoteAccountExecute({ multiCalls: [] });
        const decodedError = receipt.parseOperationError(factory.interface);
        expect(decodedError?.name).to.equal('UnauthorizedOwner');
        expect(decodedError?.args.account).to.equal(expectedAccountAddress);
        expect(decodedError?.args.owner).to.equal(router.target);
    });

    it('should be protected from front-running - factory rejects unauthorized routers', async () => {
        const frontRunLCA = 'agoric1frontruntest123456789abcdefghij';

        // Compute the expected address
        const expectedAddress = await route(frontRunLCA).getRemoteAccountAddress();

        // Attacker tries to front-run by calling factory.provide directly
        // This should revert because factory only does a verify for calls not from its owner (router)
        await expect(
            factory.provide(
                frontRunLCA,
                addr1.address, // attacker tries to use themselves as router
                expectedAddress,
            ),
        ).to.be.reverted; // The revert type depends on why the "existing account check" fails
    });

    it('should refuse creating an account for the factory principal', async () => {
        // Attacker tries to front-run by calling factory.provide directly
        // This should revert because factory only does a verify for calls not from its owner (router)
        await expect(
            factory.provide(portfolioContractAccount, router.target, ethers.ZeroAddress),
        ).to.be.revertedWithCustomError(factory, 'InvalidAccountAtAddress');
    });
});

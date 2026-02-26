import AxelarGasService from '@axelar-network/axelar-cgp-solidity/artifacts/contracts/gas-service/AxelarGasService.sol/AxelarGasService.json';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { ethers } from 'hardhat';
import '@nomicfoundation/hardhat-chai-matchers';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { keccak256, toBytes } from 'viem';
import { encodeRouterPayload, padTxId, routed } from './lib/utils';

describe('RemoteAccountAxelarRouter - RouterBehavior', () => {
    let owner: HardhatEthersSigner;
    let axelarGatewayMock: Contract;
    let factory: Contract, router: Contract, permit2Mock: Contract;

    const abiCoder = new ethers.AbiCoder();

    const sourceChain = 'agoric';
    const portfolioContractCaip2 = 'cosmos:agoric-3';
    const portfolioContractAccount = 'agoric1routerlca123456789abcdefghijklmnopqrs';
    const portfolioLCA = 'agoric1routerbehavior123456789abcdefghijklmn';

    let route: ReturnType<typeof routed>;
    let routeConfig: Parameters<typeof routed>[1];
    let expectedAccountAddress: `0x${string}`;

    before(async () => {
        [owner] = await ethers.getSigners();

        const GasServiceFactory = await ethers.getContractFactory(
            AxelarGasService.abi,
            AxelarGasService.bytecode,
        );
        await GasServiceFactory.deploy(owner.address);

        const TokenDeployerFactory = await ethers.getContractFactory('TokenDeployer');
        const tokenDeployer = await TokenDeployerFactory.deploy();

        const AuthFactory = await ethers.getContractFactory('AxelarAuthWeighted');
        const authContract = await AuthFactory.deploy([
            abiCoder.encode(['address[]', 'uint256[]', 'uint256'], [[owner.address], [1], 1]),
        ]);

        const AxelarGatewayFactory = await ethers.getContractFactory('AxelarGateway');
        axelarGatewayMock = await AxelarGatewayFactory.deploy(
            authContract.target,
            tokenDeployer.target,
        );

        const MockPermit2Factory = await ethers.getContractFactory('MockPermit2');
        permit2Mock = await MockPermit2Factory.deploy();

        const FactoryContract = await ethers.getContractFactory('RemoteAccountFactory');
        factory = await FactoryContract.deploy(portfolioContractCaip2, portfolioContractAccount);
        await factory.waitForDeployment();

        const RouterContract = await ethers.getContractFactory('RemoteAccountAxelarRouter');
        router = await RouterContract.deploy(
            axelarGatewayMock.target,
            sourceChain,
            factory.target,
            permit2Mock.target,
            owner.address,
        );
        await router.waitForDeployment();

        await factory.transferOwnership(router.target);

        routeConfig = {
            sourceChain,
            owner,
            portfolioContractAccount,
            AxelarGateway: axelarGatewayMock,
            abiCoder,
        };
        route = routed(router, routeConfig);

        expectedAccountAddress = await route(portfolioLCA).getRemoteAccountAddress();
    });

    it('should reject invalid source chain', async () => {
        const wrongSourceChain = 'ethereum';
        const receipt = await route(portfolioLCA, {
            sourceChain: wrongSourceChain,
        }).doRemoteAccountExecute({ multiCalls: [] });

        await expect(receipt).to.be.revertedWithCustomError(router, 'InvalidSourceChain');
    });

    it('should revert when selector is invalid but txId/address decode', async () => {
        const invalidSelector = '0xdeadbeef' as const;
        const txId = padTxId('tx-invalid-selector', portfolioLCA);
        const encodedArgs = abiCoder.encode(['string', 'address'], [txId, expectedAccountAddress]);
        const payload = (invalidSelector + encodedArgs.slice(2)) as `0x${string}`;

        const receipt = await route(portfolioLCA).execRaw({ payload, txId });
        receipt.expectTxReverted();
    });

    it('should revert when payload cannot be decoded', async () => {
        const payload = '0xdeadbeef' as `0x${string}`;

        const receipt = await route(portfolioLCA).execRaw({
            payload,
            txId: 'ignored',
        });
        receipt.expectTxReverted();
    });

    it('should revert when payload valid but txId is too short', async () => {
        const txId = padTxId('tx-id-too-short', portfolioLCA).slice(0, -1);
        const payload = encodeRouterPayload({
            id: txId,
            expectedAccountAddress,
            instructionType: 'RemoteAccountExecute',
            instruction: {
                multiCalls: [],
            },
        });

        const receipt = await route(portfolioLCA).execRaw({
            payload,
            txId,
        });
        receipt.expectTxReverted();
    });

    it('should revert when payload valid but txId is too long', async () => {
        const txId = padTxId('tx-id-too-long', portfolioLCA) + '\0';
        const payload = encodeRouterPayload({
            id: txId,
            expectedAccountAddress,
            instructionType: 'RemoteAccountExecute',
            instruction: {
                multiCalls: [],
            },
        });

        const receipt = await route(portfolioLCA).execRaw({
            payload,
            txId,
        });
        receipt.expectTxReverted();
    });

    it.skip('should revert when processing the instruction runs out of gas');
});

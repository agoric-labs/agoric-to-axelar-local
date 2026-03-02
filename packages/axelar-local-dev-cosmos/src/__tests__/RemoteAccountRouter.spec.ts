import AxelarGasService from '@axelar-network/axelar-cgp-solidity/artifacts/contracts/gas-service/AxelarGasService.sol/AxelarGasService.json';
import { expect } from 'chai';
import { Contract, ParamType } from 'ethers';
import { ethers } from 'hardhat';
import '@nomicfoundation/hardhat-chai-matchers';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { Abi } from 'viem';
import { gmpRouterContract, padTxId, contractWithTargetAndValue } from '../utils/router';
import { makeEvmContract } from '../utils/evm-facade';
import { routed } from './lib/utils';
import type { ContractCall } from '../interfaces/router';

describe('RemoteAccountAxelarRouter - RouterBehavior', () => {
    let owner: HardhatEthersSigner, addr1: HardhatEthersSigner;
    let axelarGatewayMock: Contract;
    let factory: Contract, router: Contract, permit2Mock: Contract;
    let multicallTarget: Contract;

    const multicallAbi = [
        {
            name: 'setValue',
            type: 'function',
            inputs: [{ name: '_value', type: 'uint256' }],
            outputs: [],
            stateMutability: 'nonpayable',
        },
    ] as const satisfies Abi;

    const abiCoder = new ethers.AbiCoder();

    const sourceChain = 'agoric';
    const portfolioContractCaip2 = 'cosmos:agoric-3';
    const portfolioContractAccount = 'agoric1routerlca123456789abcdefghijklmnopqrs';
    const portfolioLCA = 'agoric1routerbehavior123456789abcdefghijklmn';

    let route: ReturnType<typeof routed>;
    let routeConfig: Parameters<typeof routed>[1];
    let expectedAccountAddress: `0x${string}`;

    before(async () => {
        [owner, addr1] = await ethers.getSigners();

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

        const MulticallFactory = await ethers.getContractFactory('Multicall');
        multicallTarget = await MulticallFactory.deploy();
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
        await expect(receipt).to.be.revertedWithCustomError(router, 'InvalidInstructionSelector');
    });

    it('should revert when payload cannot be decoded', async () => {
        const fragment = router.interface.getFunction('processRemoteAccountExecuteInstruction')!;
        const selector = fragment.selector as `0x${string}`;
        const inputs: Array<string | ParamType> = [...fragment.inputs];
        inputs[0] = 'uint256';
        const encodedArgs = abiCoder.encode(inputs, [
            42n,
            expectedAccountAddress,
            { multiCalls: [] },
        ]);

        const payload = (selector + encodedArgs.slice(2)) as `0x${string}`;

        const receipt = await route(portfolioLCA).execRaw({
            payload,
            txId: 'ignored',
        });
        receipt.expectTxReverted();
    });

    it('should revert when payload valid but txId is too short', async () => {
        const txId = padTxId('tx-id-too-short', portfolioLCA).slice(0, -1);
        const payload = gmpRouterContract.processRemoteAccountExecuteInstruction(
            txId,
            expectedAccountAddress,
            {
                multiCalls: [],
            },
        );

        const receipt = await route(portfolioLCA).execRaw({
            payload,
            txId,
        });
        receipt.expectTxReverted();
    });

    it('should revert when payload valid but txId is too long', async () => {
        const txId = padTxId('tx-id-too-long', portfolioLCA) + '\0';
        const payload = gmpRouterContract.processRemoteAccountExecuteInstruction(
            txId,
            expectedAccountAddress,
            {
                multiCalls: [],
            },
        );

        const receipt = await route(portfolioLCA).execRaw({
            payload,
            txId,
        });
        receipt.expectTxReverted();
    });

    it('should execute even if the txId string is encoded out of order', async () => {
        const fragment = router.interface.getFunction('processRemoteAccountExecuteInstruction')!;
        const selector = fragment.selector as `0x${string}`;
        const inputs: Array<string | ParamType> = [...fragment.inputs];
        const txId = padTxId('tx-out-of-order', portfolioLCA);
        // We're manually creating an encoded payload where the first string arg is encoded at the end of the dynamic data.
        // For that we encode the payload manually, pretending the first arg is an uint256, to reserve the slot
        // in which the string arg would encode the offset. Then we separately encode the string to be used
        // as first argument, strip its first 32 bytes slot (containing the offset), and place it at the end of the rest of
        // the payload we previously encoded. Then we replace the first 32 bytes in there with the offset at which we appended
        // our string data.
        // Reserve the space for the first arg as a primitive type
        inputs[0] = 'uint256';
        const encodedArgs = abiCoder.encode(inputs, [
            42n,
            expectedAccountAddress,
            { multiCalls: [] },
        ]) as `0x${string}`;
        const encodedLength = (encodedArgs.length - 2) / 2;
        const offset = abiCoder.encode(['uint256'], [encodedLength]).slice(2);
        expect(offset.length).to.equal(32 * 2);
        // encode our string argument
        const encodedTxId = abiCoder.encode(['string'], [txId]).slice(2 + 32 * 2);
        // stich together the final payload
        const payload = (selector +
            offset +
            encodedArgs.slice(2 + 32 * 2) +
            encodedTxId) as `0x${string}`;

        // Sanity check our encoding
        const decoded = abiCoder.decode(
            ['string', 'address'],
            '0x' + payload.slice(selector.length),
        );
        expect(decoded).to.deep.equal([txId, expectedAccountAddress]);

        const receipt = await route(portfolioLCA).execRaw({
            payload,
            txId,
        });
        receipt.expectOperationSuccess();
    });

    it('should emit an operation error if the instruction is malformed', async () => {
        const fragment = router.interface.getFunction('processRemoteAccountExecuteInstruction')!;
        const selector = fragment.selector as `0x${string}`;
        const txId = padTxId('tx-malformed-instruction', portfolioLCA);
        const encodedArgs = abiCoder.encode(
            ['string', 'address', 'uint256'],
            [txId, expectedAccountAddress, 42n],
        );

        const payload = (selector + encodedArgs.slice(2)) as `0x${string}`;

        const receipt = await route(portfolioLCA).execRaw({
            payload,
            txId,
        });
        receipt.expectOperationFailure();
    });

    it('should report instruction failure when self-call runs out of gas', async () => {
        const lca = 'agoric1oogtest12345678901234567890abcde';

        // Step 1: Create the account so factory.provide is cheap (verify-only)
        const setupReceipt = await route(lca).doRemoteAccountExecute({ multiCalls: [] });
        setupReceipt.expectOperationSuccess();

        // Step 2: Build a heavy multicall — 100 SSTORE calls to a Multicall target.
        // This makes the self-call body expensive, ensuring it runs out of gas
        // when the transaction gas limit is constrained.
        const mc = contractWithTargetAndValue(
            makeEvmContract(multicallAbi),
            multicallTarget.target.toString() as `0x${string}`,
        );
        const heavyCalls: ContractCall[] = Array.from({ length: 100 }, (_, i) =>
            mc.setValue(BigInt(i)),
        );

        const receipt = await route(lca, {
            async doExecute(commandId, sourceChain, sourceAddress, payload) {
                // Estimate the gas needed for a successful execution of the heavy multicall
                const gasEstimate = await this.execute.estimateGas(
                    commandId,
                    sourceChain,
                    sourceAddress,
                    payload,
                );

                // Provide 55% of the estimate — the outer _execute has enough gas to complete,
                // but the self-call's forwarded 63/64ths is insufficient for the 100 SSTORE calls.
                // The self-call OOGs and returns empty revert data. The router emits
                // OperationResult with success=false so observers can detect the failure.
                // Note: The SubcallOutOfGas heuristic does not fire here
                return this.execute(commandId, sourceChain, sourceAddress, payload, {
                    gasLimit: (gasEstimate * 55n) / 100n,
                });
            },
        }).doRemoteAccountExecute({ multiCalls: heavyCalls });

        const event = receipt.expectOperationFailure();
        // Empty reason indicates OOG (no structured error from the self-call)
        expect(event.args.reason).to.equal('0x');
    });

    it('should revert with SubcallOutOfGas when self-call OOGs before nested calls', async () => {
        const lca = 'agoric1subcallooghard12345678901234abcde';

        // Step 1: Pre-create the account so factory.provide follows the cheap
        // verify path on subsequent calls.
        const setupReceipt = await route(lca).doRemoteAccountExecute({ multiCalls: [] });
        setupReceipt.expectOperationSuccess();

        // Step 2: Build a payload with many multicalls. The large ContractCall[]
        // array makes the self-call's ABI calldata validation expensive — Solidity
        // validates all dynamic offsets and lengths at function entry, BEFORE any
        // user code or external calls run. This shifts the gas bottleneck into
        // the self-call, enabling the SubcallOutOfGas heuristic to fire.
        const mc = contractWithTargetAndValue(
            makeEvmContract(multicallAbi),
            multicallTarget.target.toString() as `0x${string}`,
        );
        const heavyCalls: ContractCall[] = Array.from({ length: 500 }, (_, i) =>
            mc.setValue(BigInt(i)),
        );

        const receipt = await route(lca, {
            async doExecute(commandId, sourceChain, sourceAddress, payload) {
                // Estimate the gas needed for a successful execution of the heavy multicall
                const gasEstimate = await this.execute.estimateGas(
                    commandId,
                    sourceChain,
                    sourceAddress,
                    payload,
                );

                // Provide ~43% of the gas needed for success.
                // The outer _execute frame retains enough gas for the heuristic check,
                // but the 63/64ths forwarded to the self-call is insufficient for
                // ABI validation of the 500-element array. The self-call OOGs
                // (empty return data, all forwarded gas consumed), triggering
                // the SubcallOutOfGas heuristic.
                return this.execute(commandId, sourceChain, sourceAddress, payload, {
                    gasLimit: (gasEstimate * 43n) / 100n,
                });
            },
        }).doRemoteAccountExecute({ multiCalls: heavyCalls });

        expect(receipt).to.be.revertedWithCustomError(router, 'SubcallOutOfGas');
    });

    it('should reject direct external call to processRemoteAccountExecuteInstruction', async () => {
        await expect(
            router.processRemoteAccountExecuteInstruction(portfolioLCA, expectedAccountAddress, {
                multiCalls: [],
            }),
        ).to.be.reverted;
    });

    it('should reject direct external call to processProvideRemoteAccountInstruction', async () => {
        await expect(
            router.processProvideRemoteAccountInstruction(portfolioLCA, router.target, {
                depositPermit: [],
                principalAccount: portfolioLCA,
                expectedAccountAddress,
            }),
        ).to.be.reverted;
    });

    it('should reject direct external call to processUpdateOwnerInstruction', async () => {
        await expect(
            router.processUpdateOwnerInstruction(portfolioLCA, expectedAccountAddress, {
                newOwner: addr1.address,
            }),
        ).to.be.reverted;
    });

    it('should reject setSuccessor from non-owner', async () => {
        await expect(
            router.connect(addr1).getFunction('setSuccessor')(addr1.address),
        ).to.be.revertedWithCustomError(router, 'OwnableUnauthorizedAccount');
    });
});

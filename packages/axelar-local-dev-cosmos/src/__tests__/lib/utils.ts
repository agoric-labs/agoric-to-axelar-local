import { encodeFunctionData, keccak256, toBytes, encodeAbiParameters, stringToHex } from 'viem';
import { expect, use as chaiUse } from 'chai';
import { ethers, network } from 'hardhat';
import { Contract, Interface, TransactionReceipt } from 'ethers';

import {
    remoteAccountAxelarRouterABI,
    RouterInstruction,
    RouterOperationPayload,
    SupportedOperations,
} from '../../interfaces/router';
import {
    gmpRouterContract,
    padTxId,
    predictRemoteAccountAddress,
    toInitCodeHash,
} from '../../utils/router';

// ==================== RemoteAccount Helpers ====================

/**
 * Compute CREATE2 address for RemoteAccount
 * Salt is keccak256(principalAccount)
 */
export const computeRemoteAccountAddress = async (
    factoryAddress: string,
    principalAccount: string,
) => {
    const RemoteAccountFactory = await ethers.getContractFactory('RemoteAccount');
    // RemoteAccount constructor takes no arguments
    const remoteAccountInitCodeHash = toInitCodeHash(
        keccak256(RemoteAccountFactory.bytecode as `0x${string}`),
    );

    return predictRemoteAccountAddress({
        factoryAddress: factoryAddress as `0x${string}`,
        remoteAccountInitCodeHash,
        owner: principalAccount as `${string}1${string}`,
    });
};

export const constructContractCall = ({ target, functionSignature, args }) => {
    const [name, paramsRaw] = functionSignature.split('(');
    const params = paramsRaw.replace(')', '').split(',').filter(Boolean);

    return {
        target,
        data: encodeFunctionData({
            abi: [
                {
                    type: 'function',
                    name,
                    inputs: params.map((type, i) => ({ type, name: `arg${i}` })),
                },
            ],
            functionName: name,
            args,
        }),
    };
};

export const approveMessage = async ({
    commandId,
    from,
    sourceAddress,
    targetAddress,
    payload,
    owner,
    AxelarGateway,
    abiCoder,
}) => {
    const params = abiCoder.encode(
        ['string', 'string', 'address', 'bytes32'],
        [from, sourceAddress, targetAddress, payload],
    );
    const data = toBytes(
        abiCoder.encode(
            ['uint256', 'bytes32[]', 'string[]', 'bytes[]'],
            [network.config.chainId, [commandId], ['approveContractCall'], [params]],
        ),
    );

    const hash = keccak256(data);
    const signature = await owner.signMessage(toBytes(hash));
    const signatureBundle = abiCoder.encode(
        ['address[]', 'uint256[]', 'uint256', 'bytes[]'],
        [[owner.address], [1], 1, [signature]],
    );

    const input = abiCoder.encode(['bytes', 'bytes'], [data, signatureBundle]);
    const response = await AxelarGateway.connect(owner).execute(input, {
        gasLimit: BigInt(8e6),
    });
    return response;
};

export const approveMessageWithToken = async ({
    commandId,
    from,
    sourceAddress,
    targetAddress,
    payload,
    destinationTokenSymbol,
    amount,
    owner,
    AxelarGateway,
    abiCoder,
}) => {
    const params = abiCoder.encode(
        ['string', 'string', 'address', 'bytes32', 'string', 'uint256'],
        [from, sourceAddress, targetAddress, payload, destinationTokenSymbol, amount],
    );
    const data = toBytes(
        abiCoder.encode(
            ['uint256', 'bytes32[]', 'string[]', 'bytes[]'],
            [network.config.chainId, [commandId], ['approveContractCallWithMint'], [params]],
        ),
    );

    const hash = keccak256(data);
    const signature = await owner.signMessage(toBytes(hash));
    const signatureBundle = abiCoder.encode(
        ['address[]', 'uint256[]', 'uint256', 'bytes[]'],
        [[owner.address], [1], 1, [signature]],
    );

    const input = abiCoder.encode(['bytes', 'bytes'], [data, signatureBundle]);
    const response = await AxelarGateway.connect(owner).execute(input, {
        gasLimit: BigInt(8e6),
    });
    return response;
};

export const deployToken = async ({
    commandId,
    name,
    symbol,
    decimals,
    cap,
    tokenAddress,
    mintLimit,
    owner,
    AxelarGateway,
    abiCoder,
}) => {
    const params = abiCoder.encode(
        ['string', 'string', 'uint8', 'uint256', 'address', 'uint256'],
        [name, symbol, decimals, cap, tokenAddress, mintLimit],
    );

    const data = toBytes(
        abiCoder.encode(
            ['uint256', 'bytes32[]', 'string[]', 'bytes[]'],
            [network.config.chainId, [commandId], ['deployToken'], [params]],
        ),
    );

    const hash = keccak256(data);
    const signature = await owner.signMessage(toBytes(hash));
    const signatureBundle = abiCoder.encode(
        ['address[]', 'uint256[]', 'uint256', 'bytes[]'],
        [[owner.address], [1], 1, [signature]],
    );

    const input = abiCoder.encode(['bytes', 'bytes'], [data, signatureBundle]);
    const response = await AxelarGateway.connect(owner).execute(input, {
        gasLimit: BigInt(8e6),
    });
    return response;
};

export const encodeMulticallPayload = (calls, txId) => {
    return encodeAbiParameters(
        [
            {
                type: 'tuple',
                name: 'callMessage',
                components: [
                    { name: 'id', type: 'string' },
                    {
                        name: 'calls',
                        type: 'tuple[]',
                        components: [
                            { name: 'target', type: 'address' },
                            { name: 'data', type: 'bytes' },
                        ],
                    },
                ],
            },
        ],
        [{ id: txId, calls }],
    );
};

export const getPayloadHash = (payload: `0x${string}`) => keccak256(toBytes(payload));

let commandIdCounter = 1;
let txIdCounter = 1;

export const getCommandId = () => {
    const commandId = keccak256(stringToHex(String(commandIdCounter)));
    commandIdCounter++;
    return commandId;
};

const nextTxId = () => {
    const txId = `tx${txIdCounter}`;
    txIdCounter++;
    return txId;
};

export type ParsedLog = { name: string; args: Record<string, any> };
const parseLogs = (
    receipt: TransactionReceipt | null,
    contractInterface: Interface,
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
const getResultFromLogs = (logs: ParsedLog[]) => logs.find((e) => e.name === 'OperationResult');

const executeResult = Symbol();

const makeReceiptHelper = ({
    router,
    receipt,
    error,
    txId,
    result,
}: {
    router: Contract;
    receipt: TransactionReceipt | null;
    error: any;
    txId: string;
    result: Promise<unknown>;
}) => {
    const logs = (iface: Interface = router.interface) => parseLogs(receipt, iface);

    const expectTxSuccess = () => {
        expect(error, 'execute reverted').to.equal(undefined);
        expect(receipt?.status, 'missing receipt status').to.equal(1);
    };

    const getOperationResult = () => {
        const event = getResultFromLogs(logs());
        expect(event!.args.txId.hash).to.equal(keccak256(toBytes(txId)));
        return event;
    };
    const expectOperationSuccess = () => {
        expectTxSuccess();
        const event = getOperationResult();
        expect(event, 'OperationResult not found').to.not.equal(null);
        expect(event!.args.success).to.equal(true);
        return event!;
    };
    const expectOperationFailure = () => {
        expectTxSuccess();
        const event = getOperationResult();
        expect(event, 'OperationResult not found').to.not.equal(null);
        expect(event!.args.success).to.equal(false);
        return event!;
    };

    return {
        receipt,
        error,
        txId,
        [executeResult]: result,
        result,
        expectTxSuccess,
        expectTxReverted() {
            expect(error, 'execute should revert').to.not.equal(undefined);
        },
        parseLogs: logs,
        getOperationResult,
        expectOperationSuccess,
        expectOperationFailure,
        parseOperationError(contractInterface: Interface = router.interface) {
            const event = expectOperationFailure();
            return contractInterface.parseError(event.args.reason);
        },
    };
};

const unwrapExecuteResult = (chai, utils) => {
    // We overwrite 'to' because it's the most common entry point
    chai.Assertion.overwriteProperty('to', function (_super) {
        return function () {
            const obj = utils.flag(this, 'object');

            // 1. Pivot Logic: Check if the value needs unwrapping
            if (obj && typeof obj === 'object' && executeResult in obj) {
                const unwrapped = obj[executeResult];

                // 2. Pivot the internal flags to the new value
                this._obj = unwrapped;
                utils.flag(this, 'object', unwrapped);
            }

            // 3. Continue the chain (this allows 'to' to keep working)
            _super.call(this);
        };
    });
};
chaiUse(unwrapExecuteResult);

type InstructionTypeFromOperation<T extends SupportedOperations> =
    T extends `process${infer U}Instruction` ? U : never;

type RoutedOps = {
    [K in SupportedOperations as `do${InstructionTypeFromOperation<K>}`]: (
        instruction: RouterInstruction<K>,
    ) => Promise<ReturnType<typeof makeReceiptHelper>>;
};

export const routed = (
    router: Contract,
    {
        sourceChain,
        owner,
        portfolioContractAccount,
        AxelarGateway,
        abiCoder,
    }: {
        sourceChain: string;
        owner: { address: string; signMessage: (msg: Uint8Array) => Promise<string> };
        portfolioContractAccount: string;
        AxelarGateway: Contract;
        abiCoder: { encode: (types: string[], values: unknown[]) => string };
    },
) => {
    return (
        principalAccount: string,
        overrides: {
            sourceAddress?: string;
            expectedAccountAddress?: `0x${string}`;
            sourceChain?: string;
        } = {},
    ) => {
        const getRemoteAccountAddress = async () => {
            const factoryAddress = await router.factory();
            const derivedAccount = await computeRemoteAccountAddress(
                factoryAddress.toString(),
                principalAccount,
            );
            return principalAccount === portfolioContractAccount
                ? (factoryAddress as `0x${string}`)
                : derivedAccount;
        };

        const execRaw = async ({ payload, txId }: { payload: `0x${string}`; txId: string }) => {
            const resolvedSourceAddress = overrides.sourceAddress ?? principalAccount;
            const commandId = getCommandId();
            const resolvedSourceChain = overrides.sourceChain ?? sourceChain;

            const payloadHash = getPayloadHash(payload);

            await approveMessage({
                commandId,
                from: resolvedSourceChain,
                sourceAddress: resolvedSourceAddress,
                targetAddress: router.target,
                payload: payloadHash,
                owner,
                AxelarGateway,
                abiCoder,
            });

            let receipt;
            let error;
            const result = router.execute(
                commandId,
                resolvedSourceChain,
                resolvedSourceAddress,
                payload,
            );
            try {
                const tx = await result;
                receipt = await tx.wait();
            } catch (err) {
                error = err;
            }

            return makeReceiptHelper({
                router,
                receipt,
                error,
                txId,
                result,
            });
        };

        const exec = async (payload: RouterOperationPayload<SupportedOperations>) => {
            const resolvedSourceAddress = overrides.sourceAddress ?? principalAccount;
            const accountAddress = await getRemoteAccountAddress();
            const expectedAccountAddress = overrides.expectedAccountAddress ?? accountAddress;
            const txId = padTxId(nextTxId(), resolvedSourceAddress);

            const routerFunction = `process${payload.instructionType}Instruction` as const;

            const encodedPayload = gmpRouterContract[routerFunction](
                txId,
                expectedAccountAddress,
                // @ts-expect-error generic
                payload.instruction,
            );

            return execRaw({ payload: encodedPayload, txId });
        };

        const methods = Object.fromEntries(
            remoteAccountAxelarRouterABI
                .filter(
                    (item) =>
                        item.type === 'function' &&
                        item.name?.startsWith('process') &&
                        item.name.endsWith('Instruction'),
                )
                .map((item) => {
                    const operation = item.name as SupportedOperations;
                    const instructionType = operation.replace(
                        /^process|Instruction$/g,
                        '',
                    ) as InstructionTypeFromOperation<typeof operation>;
                    const methodName = `do${instructionType}`;
                    const fn = (instruction: RouterInstruction<typeof operation>) =>
                        exec({ instructionType, instruction } as RouterOperationPayload<
                            typeof operation
                        >);
                    return [methodName, fn];
                }),
        ) as RoutedOps;

        return { ...methods, exec, execRaw, getRemoteAccountAddress };
    };
};

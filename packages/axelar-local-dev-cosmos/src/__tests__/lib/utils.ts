import { encodeFunctionData, keccak256, toBytes, encodeAbiParameters, stringToHex } from 'viem';
import type {
    Abi,
    AbiParameter,
    AbiParameterToPrimitiveType,
    AbiStateMutability,
    Address,
    ContractFunctionArgs,
    ContractFunctionName,
    Hex,
} from 'viem';
import { expect, use as chaiUse } from 'chai';
import { ethers, network } from 'hardhat';
import { Contract, Interface, TransactionReceipt } from 'ethers';

// ==================== RemoteAccount Helpers ====================

/**
 * Compute CREATE2 address for RemoteAccount
 * Salt is keccak256(principalAccount)
 */
export const computeRemoteAccountAddress = async (
    factoryAddress: string,
    principalAccount: string,
) => {
    const salt = ethers.keccak256(ethers.toUtf8Bytes(principalAccount));

    const RemoteAccountFactory = await ethers.getContractFactory('RemoteAccount');
    // RemoteAccount constructor takes no arguments
    const initCodeHash = ethers.keccak256(RemoteAccountFactory.bytecode);

    return ethers.getCreate2Address(factoryAddress, salt, initCodeHash) as `0x${string}`;
};

export const TokenPermissionsComponents = [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
] as const satisfies AbiParameter[];
export const TokenPermissionsInternalTypeName =
    'struct ISignatureTransfer.TokenPermissions' as const;

export const PermitTransferFromComponents = [
    {
        name: 'permitted',
        type: 'tuple',
        internalType: TokenPermissionsInternalTypeName,
        components: TokenPermissionsComponents,
    },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
] as const satisfies AbiParameter[];
export const PermitTransferFromInternalTypeName =
    'struct ISignatureTransfer.PermitTransferFrom' as const;
export type PermitTransferFromStruct = AbiParameterToPrimitiveType<{
    type: 'tuple';
    internalType: typeof PermitTransferFromInternalTypeName;
    components: typeof PermitTransferFromComponents;
}>;

export const contractCallComponents = [
    { name: 'target', type: 'address' },
    { name: 'data', type: 'bytes' },
    { name: 'value', type: 'uint256' },
] as const satisfies AbiParameter[];

export type ContractCall = AbiParameterToPrimitiveType<{
    type: 'tuple';
    components: typeof contractCallComponents;
}>;

export const depositPermitComponents = [
    { name: 'owner', type: 'address' },
    {
        name: 'permit',
        type: 'tuple',
        internalType: PermitTransferFromInternalTypeName,
        components: PermitTransferFromComponents,
    },
    { name: 'witness', type: 'bytes32' },
    { name: 'witnessTypeString', type: 'string' },
    { name: 'signature', type: 'bytes' },
] as const satisfies AbiParameter[];

export type DepositPermit = AbiParameterToPrimitiveType<{
    type: 'tuple';
    components: typeof depositPermitComponents;
}>;

export const routerProcessSharedInputComponents = [
    { name: 'idOrSourceChain', type: 'string' },
    { name: 'expectedAccountAddress', type: 'address' },
] as const satisfies AbiParameter[];

export const ProvideRemoteAccountInstructionComponents = [
    {
        name: 'depositPermit',
        type: 'tuple[]',
        components: depositPermitComponents,
    },
    {
        name: 'principalAccount',
        type: 'string',
    },
    {
        name: 'expectedAccountAddress',
        type: 'address',
    },
] as const satisfies AbiParameter[];
export type ProvideRemoteAccountInstruction = AbiParameterToPrimitiveType<{
    type: 'tuple';
    components: typeof ProvideRemoteAccountInstructionComponents;
}>;

export const RemoteAccountExecuteInstructionComponents = [
    {
        name: 'multiCalls',
        type: 'tuple[]',
        components: contractCallComponents,
    },
] as const satisfies AbiParameter[];
export type RemoteAccountExecuteInstruction = AbiParameterToPrimitiveType<{
    type: 'tuple';
    components: typeof RemoteAccountExecuteInstructionComponents;
}>;

export const updateOwnerInstructionComponents = [
    {
        name: 'newOwner',
        type: 'address',
    },
] as const satisfies AbiParameter[];
export type UpdateOwnerInstruction = AbiParameterToPrimitiveType<{
    type: 'tuple';
    components: typeof updateOwnerInstructionComponents;
}>;

/**
 * ABI inputs for encoding RouterPayload with encodeAbiParameters.
 */
export const processProvideRemoteAccountInstructionInputs = [
    ...routerProcessSharedInputComponents,
    {
        name: 'instruction',
        type: 'tuple',
        components: ProvideRemoteAccountInstructionComponents,
    },
] as const satisfies AbiParameter[];

export const processRemoteAccountExecuteInstructionInputs = [
    ...routerProcessSharedInputComponents,
    {
        name: 'instruction',
        type: 'tuple',
        components: RemoteAccountExecuteInstructionComponents,
    },
] as const satisfies AbiParameter[];

export const processUpdateOwnerInstructionInputs = [
    ...routerProcessSharedInputComponents,
    {
        name: 'instruction',
        type: 'tuple',
        components: updateOwnerInstructionComponents,
    },
] as const satisfies AbiParameter[];

export const remoteAccountAxelarRouterABI = [
    {
        type: 'function',
        name: 'factory',
        inputs: [],
        outputs: [{ name: '', type: 'address' }],
        stateMutability: 'view',
    },
    {
        type: 'function',
        name: 'permit2',
        inputs: [],
        outputs: [{ name: '', type: 'address' }],
        stateMutability: 'view',
    },
    {
        type: 'function',
        name: 'execute',
        inputs: [
            { name: 'commandId', type: 'bytes32' },
            { name: 'sourceChain', type: 'string' },
            { name: 'sourceAddress', type: 'string' },
            { name: 'payload', type: 'bytes' },
        ],
        outputs: [],
        stateMutability: 'nonpayable',
    },
    {
        type: 'function',
        name: 'processProvideRemoteAccountInstruction',
        inputs: processProvideRemoteAccountInstructionInputs,
        outputs: [],
        stateMutability: 'nonpayable',
    },
    {
        type: 'function',
        name: 'processRemoteAccountExecuteInstruction',
        inputs: processRemoteAccountExecuteInstructionInputs,
        outputs: [],
        stateMutability: 'nonpayable',
    },
    {
        type: 'function',
        name: 'processUpdateOwnerInstruction',
        inputs: processUpdateOwnerInstructionInputs,
        outputs: [],
        stateMutability: 'nonpayable',
    },
] as const satisfies Abi;

export type SupportedOperations = Extract<
    (typeof remoteAccountAxelarRouterABI)[number]['name'],
    `process${string}`
>;

type ExtractInstructionTypeFromOperation<T extends string> =
    T extends `process${infer U}Instruction` ? U : never;

export type SupportedInstructions = ExtractInstructionTypeFromOperation<SupportedOperations>;

export type RouterInstruction<T extends SupportedOperations> = {
    [K in T]: AbiParameterToPrimitiveType<
        Extract<(typeof remoteAccountAxelarRouterABI)[number], { name: K }>['inputs'][2]
    >;
}[T];

export type RouterOperationPayload<T extends SupportedOperations> = {
    [K in T]: {
        instructionType: ExtractInstructionTypeFromOperation<K>;
        instruction: RouterInstruction<K>;
    };
}[T];

export type RouterPayloadParams<T extends SupportedOperations = SupportedOperations> = {
    id: string;
    expectedAccountAddress: `0x${string}`;
} & RouterOperationPayload<T>;

/**
 * Encode RouterPayload for RemoteAccountAxelarRouter
 * Encodes as RouterInstruction (single instruction)
 */
export const encodeRouterPayload = ({
    id,
    expectedAccountAddress,
    ...operationPayload
}: RouterPayloadParams) => {
    const functionName = `process${operationPayload.instructionType}Instruction` as const;
    const instruction = operationPayload.instruction;
    return encodeFunctionData({
        abi: remoteAccountAxelarRouterABI,
        functionName,
        args: [id, expectedAccountAddress, instruction as any],
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

type AbiContractArgs<
    TAbi extends Abi,
    Name extends ContractFunctionName<TAbi, AbiStateMutability>,
> =
    ContractFunctionArgs<TAbi, AbiStateMutability, Name> extends readonly unknown[]
        ? ContractFunctionArgs<TAbi, AbiStateMutability, Name>
        : readonly unknown[];

export type AbiContract<TAbi extends Abi, R = void> = {
    [Name in ContractFunctionName<TAbi, AbiStateMutability>]: (
        ...args: AbiContractArgs<TAbi, Name>
    ) => R;
};

/**
 * Build a proxy from a contract ABI whose method returns the ABI encoded call data.
 */
export const makeEvmContract = <TAbi extends Abi>(
    abi: TAbi,
    target: Address,
): AbiContract<TAbi, { target: Address; data: Hex; value: 0n }> => {
    const stubs: Record<string, (...args: unknown[]) => { target: Address; data: Hex; value: 0n }> =
        {};
    for (const item of abi) {
        if (item.type !== 'function') continue;
        // XXX: add and use prepareEncodeFunctionData to vendored viem
        const fn = (...args: unknown[]) => {
            return {
                target,
                // @ts-expect-error generic
                data: encodeFunctionData({ abi, functionName: item.name, args }),
                value: 0n,
            } as const;
        };
        stubs[item.name] ||= fn;
    }
    return stubs as any;
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

export const padTxId = (txId: string, template: string) => {
    const paddingLength = template.length - txId.length;
    if (paddingLength <= 0) throw new Error('Template must be longer than txId');
    return txId + '\0'.repeat(paddingLength);
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
        expect(event!.args.id.hash).to.equal(keccak256(toBytes(txId)));
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

            const encodedPayload = encodeRouterPayload({
                id: txId,
                expectedAccountAddress,
                ...payload,
            });

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

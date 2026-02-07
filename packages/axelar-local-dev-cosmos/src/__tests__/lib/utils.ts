import { encodeFunctionData, keccak256, toBytes, encodeAbiParameters } from 'viem';
import type { Abi, AbiParameter, AbiParameterToPrimitiveType } from 'viem';
import { ethers, network } from 'hardhat';

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

export const getPayloadHash = (payload) => keccak256(toBytes(payload));

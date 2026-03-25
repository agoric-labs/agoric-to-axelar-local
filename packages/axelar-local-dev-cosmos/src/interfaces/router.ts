/**
 * @file ABIs and payload shapes for router-based remote account contracts.
 * @see {@link remoteAccountAxelarRouterABI} {@link remoteAccountABI}
 */
import { PermitTransferFromComponents, PermitTransferFromInternalTypeName } from './permit2';
import type { Abi, AbiParameter, AbiParameterToPrimitiveType } from 'viem';

/**
 * @see {@link ../contracts/interfaces/IRemoteAccount.sol}
 */
export const contractCallComponents = [
    { name: 'target', type: 'address' },
    { name: 'data', type: 'bytes' },
    { name: 'value', type: 'uint192' },
    { name: 'gasLimit', type: 'uint64' },
] as const satisfies AbiParameter[];

export type ContractCall = AbiParameterToPrimitiveType<{
    type: 'tuple';
    components: typeof contractCallComponents;
}>;

/**
 * @see {@link ../contracts/interfaces/IRemoteAccountRouter.sol}
 */
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

/**
 * @see {@link ../contracts/interfaces/IRemoteAccountRouter.sol}
 */
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

export const authorizeRouterInstructionComponents = [
    {
        name: 'router',
        type: 'address',
    },
] as const satisfies AbiParameter[];
export type AuthorizeRouterInstruction = AbiParameterToPrimitiveType<{
    type: 'tuple';
    components: typeof authorizeRouterInstructionComponents;
}>;

export const deauthorizeRouterInstructionComponents = [
    {
        name: 'router',
        type: 'address',
    },
] as const satisfies AbiParameter[];
export type DeauthorizeRouterInstruction = AbiParameterToPrimitiveType<{
    type: 'tuple';
    components: typeof deauthorizeRouterInstructionComponents;
}>;

export const confirmVettingAuthorityInstructionComponents = [
    {
        name: 'authority',
        type: 'address',
    },
] as const satisfies AbiParameter[];
export type ConfirmVettingAuthorityInstruction = AbiParameterToPrimitiveType<{
    type: 'tuple';
    components: typeof confirmVettingAuthorityInstructionComponents;
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

export const processAuthorizeRouterInstructionInputs = [
    ...routerProcessSharedInputComponents,
    {
        name: 'instruction',
        type: 'tuple',
        components: authorizeRouterInstructionComponents,
    },
] as const satisfies AbiParameter[];

export const processDeauthorizeRouterInstructionInputs = [
    ...routerProcessSharedInputComponents,
    {
        name: 'instruction',
        type: 'tuple',
        components: deauthorizeRouterInstructionComponents,
    },
] as const satisfies AbiParameter[];

export const processConfirmVettingAuthorityInstructionInputs = [
    ...routerProcessSharedInputComponents,
    {
        name: 'instruction',
        type: 'tuple',
        components: confirmVettingAuthorityInstructionComponents,
    },
] as const satisfies AbiParameter[];

/**
 * @see {@link ../contracts/interfaces/IRemoteAccountRouter.sol}
 */
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
        name: 'processAuthorizeRouterInstruction',
        inputs: processAuthorizeRouterInstructionInputs,
        outputs: [],
        stateMutability: 'nonpayable',
    },
    {
        type: 'function',
        name: 'processDeauthorizeRouterInstruction',
        inputs: processDeauthorizeRouterInstructionInputs,
        outputs: [],
        stateMutability: 'nonpayable',
    },
    {
        type: 'function',
        name: 'processConfirmVettingAuthorityInstruction',
        inputs: processConfirmVettingAuthorityInstructionInputs,
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
 * @see {@link ../contracts/interfaces/IRemoteAccount.sol}
 */
export const remoteAccountABI = [
    {
        type: 'constructor',
        inputs: [],
        stateMutability: 'nonpayable',
    },
    {
        type: 'function',
        name: 'executeCalls',
        inputs: [
            {
                name: 'calls',
                type: 'tuple[]',
                components: contractCallComponents,
            },
        ],
        outputs: [],
        stateMutability: 'nonpayable',
    },
] as const satisfies Abi;

/**
 * @see {@link ../contracts/interfaces/IRemoteAccountFactory.sol}
 */
export const remoteAccountFactoryABI = [
    {
        type: 'function',
        name: 'provideRemoteAccount',
        inputs: [
            { name: 'principalAccount', type: 'string' },
            { name: 'expectedAddress', type: 'address' },
        ],
        outputs: [{ name: '', type: 'bool' }],
        stateMutability: 'nonpayable',
    },
    {
        type: 'function',
        name: 'isAuthorizedRouter',
        inputs: [{ name: 'caller', type: 'address' }],
        outputs: [{ name: '', type: 'bool' }],
        stateMutability: 'view',
    },
] as const satisfies Abi;

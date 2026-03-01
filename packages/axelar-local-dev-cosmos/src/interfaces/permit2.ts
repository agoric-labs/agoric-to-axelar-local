import type { Abi, AbiParameter, AbiParameterToPrimitiveType } from 'viem';

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

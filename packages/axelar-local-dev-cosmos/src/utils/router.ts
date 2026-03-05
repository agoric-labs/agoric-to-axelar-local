import type { Abi, AbiStateMutability, Address, ContractFunctionName, Hex } from 'viem';
import { getCreate2Address, stringToBytes, hexToBytes, keccak256 } from 'viem';
import type { AbiContract, AbiContractArgs, AbiSend, AbiTagged } from './evm-facade.ts';
import type { ContractCall } from '../interfaces/router.ts';

import { remoteAccountAxelarRouterABI } from '../interfaces/router';
import { makeEvmContract } from './evm-facade';

export const toInitCodeHash = (bytecodeHash: Hex): Uint8Array => hexToBytes(bytecodeHash);

export const predictRemoteAccountAddress = ({
    factoryAddress,
    remoteAccountInitCodeHash,
    owner,
}: {
    factoryAddress: Hex;
    remoteAccountInitCodeHash: Uint8Array;
    owner: `${string}1${string}`;
}): Hex => {
    if (!(owner.length > 0)) throw new Error('Invalid owner address');
    const salt = keccak256(stringToBytes(owner));

    const out = getCreate2Address({
        from: factoryAddress,
        salt,
        bytecodeHash: remoteAccountInitCodeHash,
    });
    return out;
};

export type AbiExtendedContractMethod<TArgs extends readonly unknown[]> = {
    (...args: TArgs): ContractCall;

    with(
        metadata: Partial<Pick<ContractCall, 'value' | 'gasLimit'>>,
    ): (...args: TArgs) => ContractCall;
};

export type AbiExtendedContract<TAbi extends Abi> = {
    [Name in ContractFunctionName<TAbi, AbiStateMutability>]: AbiExtendedContractMethod<
        AbiContractArgs<TAbi, Name>
    >;
} & (Extract<TAbi[number], { type: 'receive' }> extends never
    ? {}
    : { [AbiSend]: AbiExtendedContractMethod<[]> });

type AbiFromContract<T> =
    T extends AbiTagged<infer U> ? U : T extends AbiContract<infer U, Hex> ? U : never;

export const contractWithCallMetadata = <T extends AbiContract<Abi, Hex>>(
    contract: T,
    target: Address,
): AbiExtendedContract<AbiFromContract<T>> => {
    const wrapped = Object.fromEntries(
        Object.entries(contract as AbiContract<Abi, Hex>).map(([fnName, fn]) => {
            const obj: {
                [K in typeof fnName]: AbiExtendedContractMethod<readonly unknown[]>['with'];
            } = {
                [fnName]:
                    ({ value = BigInt(0), gasLimit = BigInt(0) }) =>
                    (...args: readonly unknown[]) => ({
                        target,
                        data: fn(...args),
                        value,
                        gasLimit,
                    }),
            };
            const extFn: AbiExtendedContractMethod<readonly unknown[]> = Object.assign(
                obj[fnName]({}),
                { with: obj[fnName] },
            );

            return [fnName, extFn] as const;
        }),
    );

    return wrapped as AbiExtendedContract<AbiFromContract<T>>;
};

export const gmpRouterContract = makeEvmContract(remoteAccountAxelarRouterABI);

export const padTxId = (txId: string, template: string) => {
    const paddingLength = template.length - txId.length;
    if (paddingLength < 0) throw new Error('Template must be at least as long as txId');
    return txId + '\0'.repeat(paddingLength);
};

import type { Abi, AbiStateMutability, Address, ContractFunctionName, Hex } from 'viem';
import { getCreate2Address, stringToBytes, hexToBytes, keccak256, concat } from 'viem';
import type { AbiContract, AbiContractArgs, AbiSend, AbiTagged } from './evm-facade.ts';
import type { ContractCall } from '../interfaces/router.ts';

import { remoteAccountAxelarRouterABI } from '../interfaces/router';
import { makeEvmContract } from './evm-facade';

/**
 * Compute the EIP-1167 minimal proxy init code hash for a given implementation address.
 * The init code is: 0x3d602d80600a3d3981f3363d3d373d3d3d363d73 ++ implementation ++ 5af43d82803e903d91602b57fd5bf3
 */
export const cloneInitCodeHash = (implementationAddress: Hex): Uint8Array =>
    hexToBytes(
        keccak256(
            concat([
                '0x3d602d80600a3d3981f3363d3d373d3d3d363d73',
                implementationAddress,
                '0x5af43d82803e903d91602b57fd5bf3',
            ]),
        ),
    );

export const predictRemoteAccountAddress = ({
    factoryAddress,
    implementationAddress,
    owner,
}: {
    factoryAddress: Hex;
    implementationAddress: Hex;
    owner: `${string}1${string}`;
}): Hex => {
    if (!(owner.length > 0)) throw new Error('Invalid owner address');
    const salt = keccak256(stringToBytes(owner));

    const out = getCreate2Address({
        from: factoryAddress,
        salt,
        bytecodeHash: cloneInitCodeHash(implementationAddress),
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
    const wrapped: Record<string | symbol, AbiExtendedContractMethod<readonly unknown[]>> = {};
    for (const fnName of Reflect.ownKeys(contract as AbiContract<Abi, Hex>)) {
        const fn = (contract as any)[fnName] as (...args: readonly unknown[]) => Hex;
        const withMetadata: AbiExtendedContractMethod<readonly unknown[]>['with'] =
            ({ value = BigInt(0), gasLimit = BigInt(0) }) =>
            (...args: readonly unknown[]) => ({
                target,
                data: fn(...args),
                value,
                gasLimit,
            });
        wrapped[fnName] = Object.assign(withMetadata({}), { with: withMetadata });
    }

    return wrapped as AbiExtendedContract<AbiFromContract<T>>;
};

export const gmpRouterContract = makeEvmContract(remoteAccountAxelarRouterABI);

export const padTxId = (txId: string, template: string) => {
    const paddingLength = template.length - txId.length;
    if (paddingLength < 0) throw new Error('Template must be at least as long as txId');
    return txId + '\0'.repeat(paddingLength);
};

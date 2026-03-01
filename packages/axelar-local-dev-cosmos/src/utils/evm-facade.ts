import { encodeFunctionData } from 'viem';
import type {
    Abi,
    AbiStateMutability,
    ContractFunctionArgs,
    ContractFunctionName,
    Hex,
} from 'viem';

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
export const makeEvmContract = <TAbi extends Abi>(abi: TAbi): AbiContract<TAbi, Hex> => {
    const stubs: Record<string, (...args: readonly unknown[]) => Hex> = {};
    for (const item of abi) {
        if (item.type !== 'function') continue;
        // XXX: add and use prepareEncodeFunctionData to vendored viem
        const fn = (...args: readonly unknown[]) => {
            // @ts-expect-error generic
            return encodeFunctionData({ abi, functionName: item.name, args });
        };
        if (stubs[item.name]) {
            // `encodeFunctionData` support overloads in most cases, but we need to
            // test disambiguation when the signature has the same number of
            // parameters (but different types).
            throw new Error(
                `ABI overload for ${item.name} requires disambiguation (not supported)`,
            );
        }
        stubs[item.name] = fn;
    }
    return stubs as any;
};

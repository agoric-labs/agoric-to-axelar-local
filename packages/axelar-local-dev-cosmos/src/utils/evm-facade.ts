import { encodeFunctionData } from 'viem';
import type {
    Abi,
    AbiStateMutability,
    ContractFunctionArgs,
    ContractFunctionName,
    Hex,
} from 'viem';

export const AbiSend = Symbol('send');

export type AbiContractArgs<
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

// Phantom tag to preserve ABI inference through intersections.
declare const abiTag: unique symbol;
export type AbiTagged<TAbi extends Abi> = { readonly [abiTag]?: TAbi };

/**
 * Build a proxy from a contract ABI whose method returns the ABI encoded call data.
 */
export const makeEvmContract = <TAbi extends Abi>(
    abi: TAbi,
): AbiContract<TAbi, Hex> &
    AbiTagged<TAbi> &
    (Extract<TAbi[number], { type: 'receive' }> extends never ? {} : { [AbiSend]: () => Hex }) => {
    const stubs: Record<string | symbol, (...args: readonly unknown[]) => Hex> = {};
    for (const item of abi) {
        switch (item.type) {
            case 'receive': {
                const send = (...args: readonly unknown[]): Hex => {
                    if (args.length > 0) {
                        throw new Error('Receive function does not accept arguments');
                    }
                    return '0x';
                };
                stubs[AbiSend] = send;
                break;
            }
            case 'function': {
                if (item.type !== 'function') continue;
                // XXX: add and use prepareEncodeFunctionData to vendored viem
                const obj = {
                    [item.name]: (...args: readonly unknown[]) => {
                        // @ts-expect-error generic
                        return encodeFunctionData({ abi, functionName: item.name, args });
                    },
                };
                if (stubs[item.name]) {
                    // `encodeFunctionData` support overloads in most cases, but we need to
                    // test disambiguation when the signature has the same number of
                    // parameters (but different types).
                    throw new Error(
                        `ABI overload for ${item.name} requires disambiguation (not supported)`,
                    );
                }
                Object.assign(stubs, obj);
                break;
            }
            default:
                continue;
        }
    }
    return stubs as any;
};

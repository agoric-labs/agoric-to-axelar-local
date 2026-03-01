import type { Abi, Address, Hex } from 'viem';
import { getCreate2Address, stringToBytes, hexToBytes, keccak256 } from 'viem';
import type { AbiContract } from './evm-facade.ts';
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

// XXX: extend this helper to support contract.fn.withValue(123n)(...args) or
// similar to support providing explicit value, possibly only for payable methods.
export const contractWithTargetAndValue = <T extends AbiContract<Abi, Hex>>(
    contract: T,
    target: Address,
): T extends AbiContract<infer U, Hex> ? AbiContract<U, ContractCall> : never => {
    const wrapped = Object.fromEntries(
        Object.entries(contract).map(([fnName, fn]) => [
            fnName,
            (...args: unknown[]) =>
                ({ target, data: fn(...args), value: BigInt(0) }) satisfies ContractCall,
        ]),
    );

    return wrapped as any;
};

export const gmpRouterContract = makeEvmContract(remoteAccountAxelarRouterABI);

export const padTxId = (txId: string, template: string) => {
    const paddingLength = template.length - txId.length;
    if (paddingLength < 0) throw new Error('Template must be at least as long as txId');
    return txId + '\0'.repeat(paddingLength);
};

import { Abi } from 'viem';

export const multicallAbi = [
    {
        name: 'setValue',
        type: 'function',
        inputs: [{ name: '_value', type: 'uint256' }],
        outputs: [],
        stateMutability: 'nonpayable',
    },
    {
        name: 'addToValue',
        type: 'function',
        inputs: [{ name: '_amount', type: 'uint256' }],
        outputs: [],
        stateMutability: 'nonpayable',
    },
    {
        name: 'alwaysReverts',
        type: 'function',
        inputs: [],
        outputs: [],
        stateMutability: 'nonpayable',
    },
    {
        name: 'burnGas',
        type: 'function',
        inputs: [{ name: 'n', type: 'uint256' }],
        outputs: [],
        stateMutability: 'nonpayable',
    },
] as const satisfies Abi;

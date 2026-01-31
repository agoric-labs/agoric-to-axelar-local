import { encodeFunctionData, keccak256, toBytes, encodeAbiParameters } from 'viem';
import { ethers, network } from 'hardhat';

// ==================== Types ====================

export interface ContractCall {
    target: `0x${string}`;
    data: `0x${string}`;
}

export interface DepositPermit {
    tokenOwner: `0x${string}`;
    permit: {
        permitted: {
            token: `0x${string}`;
            amount: bigint;
        };
        nonce: bigint;
        deadline: bigint;
    };
    witness: `0x${string}`;
    witnessTypeString: string;
    signature: `0x${string}`;
}

export interface RouterPayloadParams {
    id: string;
    portfolioLCA: string;
    remoteAccountAddress: `0x${string}`;
    provideAccount: boolean;
    depositPermit?: DepositPermit[];
    multiCalls?: ContractCall[];
}

// ==================== RemoteAccount Helpers ====================

/**
 * Compute CREATE2 address for RemoteAccount
 * Salt is keccak256(principalCaip2 + ':' + principalAccount)
 */
export const computeRemoteAccountAddress = async (
    factoryAddress: string,
    principalCaip2: string,
    principalAccount: string,
) => {
    const salt = ethers.solidityPackedKeccak256(
        ['string', 'string', 'string'],
        [principalCaip2, ':', principalAccount],
    );

    const RemoteAccountFactory = await ethers.getContractFactory('RemoteAccount');
    const constructorArgs = ethers.AbiCoder.defaultAbiCoder().encode(
        ['string', 'string'],
        [principalCaip2, principalAccount],
    );
    const initCode = ethers.solidityPacked(
        ['bytes', 'bytes'],
        [RemoteAccountFactory.bytecode, constructorArgs],
    );
    const initCodeHash = ethers.keccak256(initCode);

    return ethers.getCreate2Address(factoryAddress, salt, initCodeHash) as `0x${string}`;
};

/**
 * Encode RouterPayload for PortfolioRouter
 * Encodes as RouterInstruction[] (array of instructions)
 */
export const encodeRouterPayload = ({
    id,
    portfolioLCA,
    remoteAccountAddress,
    provideAccount,
    depositPermit = [],
    multiCalls = [],
}: RouterPayloadParams) => {
    return encodeAbiParameters(
        [
            {
                type: 'tuple[]',
                components: [
                    { name: 'id', type: 'string' },
                    { name: 'portfolioLCA', type: 'string' },
                    { name: 'remoteAccountAddress', type: 'address' },
                    { name: 'provideAccount', type: 'bool' },
                    {
                        name: 'depositPermit',
                        type: 'tuple[]',
                        components: [
                            { name: 'tokenOwner', type: 'address' },
                            {
                                name: 'permit',
                                type: 'tuple',
                                components: [
                                    {
                                        name: 'permitted',
                                        type: 'tuple',
                                        components: [
                                            { name: 'token', type: 'address' },
                                            { name: 'amount', type: 'uint256' },
                                        ],
                                    },
                                    { name: 'nonce', type: 'uint256' },
                                    { name: 'deadline', type: 'uint256' },
                                ],
                            },
                            { name: 'witness', type: 'bytes32' },
                            { name: 'witnessTypeString', type: 'string' },
                            { name: 'signature', type: 'bytes' },
                        ],
                    },
                    {
                        name: 'multiCalls',
                        type: 'tuple[]',
                        components: [
                            { name: 'target', type: 'address' },
                            { name: 'data', type: 'bytes' },
                        ],
                    },
                ],
            },
        ],
        [
            [
                {
                    id,
                    portfolioLCA,
                    remoteAccountAddress,
                    provideAccount,
                    depositPermit,
                    multiCalls,
                },
            ],
        ],
    );
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

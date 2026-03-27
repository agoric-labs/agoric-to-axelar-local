import '@nomicfoundation/hardhat-ethers';
import { Contract } from 'ethers';
import { ethers, network, run } from 'hardhat';

const { concat, getAddress, keccak256, zeroPadValue } = ethers;

// see https://github.com/pcaversaccio/createx?tab=readme-ov-file#createx-deployments
export const CREATEX_ADDRESS = '0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed';
// see https://github.com/pcaversaccio/createx?tab=readme-ov-file#security-considerations
const CREATEX_RUNTIME_CODEHASH =
    '0xbd8a7ea8cfca7b4e5f5041d7d4b17bc317c5ce42cfbc42066a00cf26b43eb53f';

// see https://github.com/pcaversaccio/createx?tab=readme-ov-file#abi-application-binary-interface
const CREATEX_ABI = [
    'function deployCreate2(bytes32 salt, bytes memory initCode) external payable returns (address)',
    'function computeCreate2Address(bytes32 salt, bytes32 initCodeHash) external view returns (address)',
    'function deployCreate3(bytes32 salt, bytes memory initCode) external payable returns (address)',
    'function computeCreate3Address(bytes32 salt) external view returns (address)',
    'event ContractCreation(address indexed newContract, bytes32 indexed salt)',
];

/**
 * Build a 32-byte CreateX permissioned salt.
 * The `hashInput` is hashed to derive the 11-byte suffix, so the salt
 * changes whenever the input changes (e.g. when bytecode is upgraded).
 */
export const buildPermissionedSalt = (deployer: string, hashInput: string): string => {
    const normalizedDeployer = getAddress(deployer).slice(2).toLowerCase();
    const inputHash = keccak256(hashInput).slice(2);
    const suffix = inputHash.slice(0, 22); // 11 bytes = 22 hex chars

    /**
     * Permissioned salt layout:
     * - 20 bytes: deployer address
     * - 1 byte: permission marker (00)
     * - 11 bytes: hashInput-derived suffix
     */
    const salt = `0x${normalizedDeployer}00${suffix}`;
    if (salt.length !== 66) {
        throw new Error(`Invalid salt length: ${salt}`);
    }
    return salt;
};

/**
 * Replicate CreateX's `_guard` for the permissioned-salt case.
 */
const computeGuardedSalt = (deployer: string, rawSalt: string): string => {
    const deployerWord = zeroPadValue(deployer, 32);
    return keccak256(concat([deployerWord, rawSalt]));
};

export const validateCreateX = async (): Promise<void> => {
    const runtimeCode = await ethers.provider.getCode(CREATEX_ADDRESS);
    if (runtimeCode === '0x') {
        throw new Error(`CreateX not found at ${CREATEX_ADDRESS} on ${network.name}`);
    }
    const codeHash = keccak256(runtimeCode);
    if (codeHash !== CREATEX_RUNTIME_CODEHASH) {
        throw new Error(
            `CreateX bytecode mismatch on ${network.name}\n` +
                `  expected: ${CREATEX_RUNTIME_CODEHASH}\n` +
                `  got:      ${codeHash}`,
        );
    }
};

export const getCreateX = (signer: any): Contract => {
    return new Contract(CREATEX_ADDRESS, CREATEX_ABI, signer);
};

export interface DeployResult {
    address: string;
    alreadyDeployed: boolean;
}

type DeployViaCreateXArgs = {
    createX: Contract;
    deployer: string;
    rawSalt: string;
    initCode: string;
    label: string;
} & ({ mode: 'create2' } | { mode: 'create3' });

const computeExpectedAddress = async (
    createX: Contract,
    deployer: string,
    rawSalt: string,
    initCode: string,
    mode: 'create2' | 'create3',
): Promise<string> => {
    const guardedSalt = computeGuardedSalt(deployer, rawSalt);
    if (mode === 'create2') {
        const initCodeHash = keccak256(initCode);
        return await createX.computeCreate2Address(guardedSalt, initCodeHash);
    }
    return await createX.computeCreate3Address(guardedSalt);
};

export const deployViaCreateX = async (args: DeployViaCreateXArgs): Promise<DeployResult> => {
    const { createX, deployer, rawSalt, initCode, label, mode } = args;
    const expectedAddress = await computeExpectedAddress(
        createX,
        deployer,
        rawSalt,
        initCode,
        mode,
    );

    const existingCode = await ethers.provider.getCode(expectedAddress);
    if (existingCode !== '0x') {
        console.log(`  ${label}: ${expectedAddress} (exists, skipped)`);
        return { address: expectedAddress, alreadyDeployed: true };
    }

    const tx =
        mode === 'create2'
            ? await createX.deployCreate2(rawSalt, initCode)
            : await createX.deployCreate3(rawSalt, initCode);
    const receipt = await tx.wait(5);

    // Verify address from ContractCreation event
    const eventTopic = createX.interface.getEvent('ContractCreation')!.topicHash;
    const creationLog = receipt.logs.find(
        (log: any) =>
            log.topics[0] === eventTopic &&
            log.address.toLowerCase() === CREATEX_ADDRESS.toLowerCase(),
    );
    if (creationLog) {
        const parsed = createX.interface.parseLog({
            topics: creationLog.topics,
            data: creationLog.data,
        });
        const actualAddress = parsed?.args?.newContract;
        if (actualAddress && actualAddress.toLowerCase() !== expectedAddress.toLowerCase()) {
            throw new Error(
                `${label}: address mismatch — expected ${expectedAddress}, got ${actualAddress}`,
            );
        }
    } else {
        console.warn(`  ⚠ ${label}: ContractCreation event not found in receipt logs`);
    }

    console.log(`  ${label}: ${expectedAddress} (deployed, tx ${receipt.hash})`);
    return { address: expectedAddress, alreadyDeployed: false };
};

export const verifyOnExplorer = async ({
    address,
    constructorArgs,
    contract,
}: {
    address: string;
    constructorArgs: unknown[];
    contract: string;
}): Promise<void> => {
    try {
        await run('verify:verify', { address, constructorArgs, contract });
        console.log(`  Verified ${contract}`);
    } catch (error: any) {
        const msg: string = error.message ?? '';
        if (msg.includes('Already Verified') || msg.includes('already verified')) {
            console.log(`  Already verified: ${contract}`);
        } else {
            console.warn(`  Verification failed (non-fatal): ${msg}`);
        }
    }
};

import '@nomicfoundation/hardhat-ethers';
import { Contract } from 'ethers';
import { ethers, network, run } from 'hardhat';

const { concat, getAddress, keccak256, toUtf8Bytes, zeroPadValue } = ethers;

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
 * Build a 32-byte CreateX unpermissioned salt.
 * First 20 bytes are zero (cross-chain safe, any deployer can use).
 * Remaining 12 bytes are derived from the keccak256 hash of `input` (UTF-8 encoded).
 */
export const buildSalt = (input: string): string => {
    const inputHash = keccak256(toUtf8Bytes(input)).slice(2);
    const suffix = inputHash.slice(0, 24); // 12 bytes = 24 hex chars
    const salt = `0x${'00'.repeat(20)}${suffix}`;
    if (salt.length !== 66) {
        throw new Error(`Invalid salt length: ${salt}`);
    }
    return salt;
};

/**
 * Replicate CreateX's `_guard` logic.
 * - Zero-prefixed salt (bytes 0–19 all zero): returned as-is (unpermissioned).
 * - Deployer-prefixed + 0x00 marker (byte 20): hashed with deployer (permissioned).
 * - Deployer-prefixed + non-0x00 marker: returned as-is.
 */
const computeGuardedSalt = (deployer: string, rawSalt: string): string => {
    const saltPrefix = rawSalt.slice(2, 42).toLowerCase();
    const isZeroPrefixed = saltPrefix === '00'.repeat(20);
    if (isZeroPrefixed) {
        return rawSalt;
    }
    const markerByte = rawSalt.slice(42, 44);
    if (markerByte === '00') {
        const deployerWord = zeroPadValue(deployer, 32);
        return keccak256(concat([deployerWord, rawSalt]));
    }
    return rawSalt;
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

    if (mode === 'create3') {
        // Enforce permissioned salt for Create3: deployer address (bytes 0–19) + 0x00 marker (byte 20).
        // This prevents redeployment to the same address by a different deployer.
        const saltDeployer = rawSalt.slice(2, 42).toLowerCase();
        const markerByte = rawSalt.slice(42, 44);
        if (saltDeployer !== deployer.toLowerCase().slice(2) || markerByte !== '00') {
            throw new Error(
                `${label}: Create3 requires a permissioned salt (deployer prefix + 0x00 marker)`,
            );
        }
    }

    const expectedAddress = await computeExpectedAddress(
        createX,
        deployer,
        rawSalt,
        initCode,
        mode,
    );

    const existingCode = await ethers.provider.getCode(expectedAddress);
    if (existingCode !== '0x') {
        if (mode === 'create3') {
            // For Create3, the address depends only on deployer + salt (not bytecode),
            // so a wrong salt could collide with a previously deployed different contract.
            // Simulate constructor execution to get expected runtime bytecode (including immutables)
            // and compare against what's on-chain.
            const expectedRuntimeCode = await ethers.provider.call({ data: initCode });
            const existingCodeHash = keccak256(existingCode);
            const expectedCodeHash = keccak256(expectedRuntimeCode);
            if (existingCodeHash !== expectedCodeHash) {
                throw new Error(
                    `${label}: runtime bytecode mismatch at ${expectedAddress}\n` +
                        `  expected code hash: ${expectedCodeHash}\n` +
                        `  on-chain code hash: ${existingCodeHash}`,
                );
            }
        }
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
        await run('verify:verify', { address, constructorArguments: constructorArgs, contract });
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

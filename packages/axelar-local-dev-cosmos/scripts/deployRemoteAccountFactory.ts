import '@nomicfoundation/hardhat-ethers';
import { Contract } from 'ethers';
import { ethers, network, run } from 'hardhat';

const { concat, getAddress, isAddress, keccak256, toUtf8Bytes, zeroPadValue } = ethers;

// see https://github.com/pcaversaccio/createx?tab=readme-ov-file#createx-deployments
const CREATEX_ADDRESS = '0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed';
// see https://github.com/pcaversaccio/createx?tab=readme-ov-file#security-considerations
const CREATEX_RUNTIME_CODEHASH =
    '0xbd8a7ea8cfca7b4e5f5041d7d4b17bc317c5ce42cfbc42066a00cf26b43eb53f';

// see https://github.com/pcaversaccio/createx?tab=readme-ov-file#abi-application-binary-interface
const CREATEX_ABI = [
    'function deployCreate2(bytes32 salt, bytes memory initCode) external payable returns (address)',
    'function computeCreate2Address(bytes32 salt, bytes32 initCodeHash) external view returns (address)',
    'event ContractCreation(address indexed newContract, bytes32 indexed salt)',
];

/**
 * Build a 32-byte CreateX salt
 */
const buildPermissionedSalt = (deployer: string, label: string): string => {
    const normalizedDeployer = getAddress(deployer).slice(2).toLowerCase();
    const labelHash = keccak256(toUtf8Bytes(label)).slice(2);
    const suffix = labelHash.slice(0, 22); // 11 bytes = 22 hex chars

    /**
     * Permissioned salt layout:
     * - 20 bytes: deployer address
     * - 1 byte: permission marker (00)
     * - 11 bytes: label-derived suffix
     */
    const salt = `0x${normalizedDeployer}00${suffix}`;
    if (salt.length !== 66) {
        throw new Error(`Invalid salt length: ${salt}`);
    }
    return salt;
};

/**
 * Replicate CreateX's `_guard` for the permissioned-salt case
 */
const computeGuardedSalt = (deployer: string, rawSalt: string): string => {
    const deployerWord = zeroPadValue(deployer, 32);
    return keccak256(concat([deployerWord, rawSalt]));
};

const computeExpectedAddress = async (
    createX: Contract,
    deployer: string,
    rawSalt: string,
    initCode: string,
): Promise<string> => {
    const guardedSalt = computeGuardedSalt(deployer, rawSalt);
    const initCodeHash = keccak256(initCode);
    return await createX.computeCreate2Address(guardedSalt, initCodeHash);
};

const validateCreateX = async (): Promise<void> => {
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

interface DeployResult {
    address: string;
    alreadyDeployed: boolean;
}

const deployViaCreateX = async ({
    createX,
    deployer,
    rawSalt,
    initCode,
    label,
}: {
    createX: Contract;
    deployer: string;
    rawSalt: string;
    initCode: string;
    label: string;
}): Promise<DeployResult> => {
    const expectedAddress = await computeExpectedAddress(createX, deployer, rawSalt, initCode);

    const existingCode = await ethers.provider.getCode(expectedAddress);
    if (existingCode !== '0x') {
        console.log(`  ${label}: ${expectedAddress} (exists, skipped)`);
        return { address: expectedAddress, alreadyDeployed: true };
    }

    const tx = await createX.deployCreate2(rawSalt, initCode);
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
    }

    console.log(`  ${label}: ${expectedAddress} (deployed, tx ${receipt.hash})`);
    return { address: expectedAddress, alreadyDeployed: false };
};

const verifyOnExplorer = async ({
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

const main = async () => {
    const { PRINCIPAL_CAIP2, PRINCIPAL_ACCOUNT, VETTING_AUTHORITY } = process.env;
    if (!PRINCIPAL_CAIP2 || !PRINCIPAL_ACCOUNT || !VETTING_AUTHORITY) {
        throw new Error('Missing env: PRINCIPAL_CAIP2, PRINCIPAL_ACCOUNT, or VETTING_AUTHORITY');
    }
    if (!isAddress(VETTING_AUTHORITY)) {
        throw new Error(`Invalid VETTING_AUTHORITY: ${VETTING_AUTHORITY}`);
    }

    const [deployer] = await ethers.getSigners();
    const deployerAddress = await deployer.getAddress();
    const { chainId } = await ethers.provider.getNetwork();

    console.log(`\nCreateX CREATE2 Deploy — ${network.name} (${chainId})`);
    console.log(`  Deployer:          ${deployerAddress}`);
    console.log(`  Principal CAIP2:   ${PRINCIPAL_CAIP2}`);
    console.log(`  Principal Account: ${PRINCIPAL_ACCOUNT}`);
    console.log(`  Vetting Authority: ${VETTING_AUTHORITY}\n`);

    await validateCreateX();
    const createX = new Contract(CREATEX_ADDRESS, CREATEX_ABI, deployer);

    // Step 1: RemoteAccount (implementation)
    console.log('RemoteAccount (implementation):');
    const RemoteAccountCF = await ethers.getContractFactory('RemoteAccount');
    const implRawSalt = buildPermissionedSalt(deployerAddress, 'RemoteAccount');
    const implResult = await deployViaCreateX({
        createX,
        deployer: deployerAddress,
        rawSalt: implRawSalt,
        initCode: RemoteAccountCF.bytecode,
        label: 'RemoteAccount',
    });

    // Step 2: RemoteAccountFactory
    console.log('RemoteAccountFactory:');
    const FactoryCF = await ethers.getContractFactory('RemoteAccountFactory');
    const factoryDeployTx = await FactoryCF.getDeployTransaction(
        PRINCIPAL_CAIP2,
        PRINCIPAL_ACCOUNT,
        implResult.address,
        VETTING_AUTHORITY,
    );
    if (!factoryDeployTx.data) {
        throw new Error('Failed to encode RemoteAccountFactory initCode');
    }
    const factoryRawSalt = buildPermissionedSalt(
        deployerAddress,
        `RemoteAccountFactory_${implResult.address}`,
    );
    const factoryResult = await deployViaCreateX({
        createX,
        deployer: deployerAddress,
        rawSalt: factoryRawSalt,
        initCode: factoryDeployTx.data,
        label: 'RemoteAccountFactory',
    });

    // Verification — always attempt, even for already-deployed contracts,
    // so a previous deploy whose verification failed can be retried.
    await verifyOnExplorer({
        address: implResult.address,
        constructorArgs: [],
        contract: 'src/contracts/RemoteAccount.sol:RemoteAccount',
    });
    await verifyOnExplorer({
        address: factoryResult.address,
        constructorArgs: [
            PRINCIPAL_CAIP2,
            PRINCIPAL_ACCOUNT,
            implResult.address,
            VETTING_AUTHORITY,
        ],
        contract: 'src/contracts/RemoteAccountFactory.sol:RemoteAccountFactory',
    });
};

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

import '@nomicfoundation/hardhat-ethers';
import { Contract } from 'ethers';
import { ethers, network, run } from 'hardhat';

const { concat, getAddress, isAddress, keccak256, zeroPadValue } = ethers;

// see https://github.com/pcaversaccio/createx?tab=readme-ov-file#createx-deployments
const CREATEX_ADDRESS = '0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed';
// see https://github.com/pcaversaccio/createx?tab=readme-ov-file#security-considerations
const CREATEX_RUNTIME_CODEHASH =
    '0xbd8a7ea8cfca7b4e5f5041d7d4b17bc317c5ce42cfbc42066a00cf26b43eb53f';

const CREATEX_ABI = [
    'function deployCreate3(bytes32 salt, bytes memory initCode) external payable returns (address)',
    'function computeCreate3Address(bytes32 salt) external view returns (address)',
    'event ContractCreation(address indexed newContract, bytes32 indexed salt)',
];

/**
 * Build a 32-byte CreateX permissioned salt derived from the initCode.
 * This ensures the salt changes whenever the bytecode or constructor args change.
 */
const buildPermissionedSalt = (deployer: string, initCode: string): string => {
    const normalizedDeployer = getAddress(deployer).slice(2).toLowerCase();
    const initCodeHash = keccak256(initCode).slice(2);
    const suffix = initCodeHash.slice(0, 22); // 11 bytes = 22 hex chars

    /**
     * Permissioned salt layout:
     * - 20 bytes: deployer address
     * - 1 byte: permission marker (00)
     * - 11 bytes: initCode-derived suffix
     */
    const salt = `0x${normalizedDeployer}00${suffix}`;
    if (salt.length !== 66) {
        throw new Error(`Invalid salt length: ${salt}`);
    }
    return salt;
};

/**
 * Replicate CreateX's `_guard` for the permissioned-salt case.
 * CREATE3 address depends only on deployer + salt, not initCode.
 */
const computeGuardedSalt = (deployer: string, rawSalt: string): string => {
    const deployerWord = zeroPadValue(deployer, 32);
    return keccak256(concat([deployerWord, rawSalt]));
};

const computeExpectedCreate3Address = async (
    createX: Contract,
    deployer: string,
    rawSalt: string,
): Promise<string> => {
    const guardedSalt = computeGuardedSalt(deployer, rawSalt);
    return await createX.computeCreate3Address(guardedSalt);
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

const deployViaCreate3 = async ({
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
    const expectedAddress = await computeExpectedCreate3Address(createX, deployer, rawSalt);

    const existingCode = await ethers.provider.getCode(expectedAddress);
    if (existingCode !== '0x') {
        console.log(`  ${label}: ${expectedAddress} (exists, skipped)`);
        return { address: expectedAddress, alreadyDeployed: true };
    }

    const tx = await createX.deployCreate3(rawSalt, initCode);
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

const vetRouter = async (routerAddress: string, factoryAddress: string): Promise<void> => {
    const [deployer] = await ethers.getSigners();
    const factory = await ethers.getContractAt('RemoteAccountFactory', factoryAddress);

    const [status, numberOfRouters, vettingAuthority] = await Promise.all([
        factory.getRouterStatus(routerAddress),
        factory.numberOfAuthorizedRouters(),
        factory.vettingAuthority(),
    ]);

    console.log(`\nPost-deployment vetting:`);
    console.log(`  Router:            ${routerAddress}`);
    console.log(`  Status in factory: ${status}`);
    console.log(`  Authorized routers: ${numberOfRouters}`);
    console.log(`  Vetting authority: ${vettingAuthority}`);

    if (status !== 0n) {
        console.log('  Router status already set, skipping vetting.');
    } else if (vettingAuthority !== deployer.address) {
        console.warn('  Deployer is not the vetting authority. Skipping vetting.');
    } else if (numberOfRouters > 0n) {
        console.log('  Vetting router (not initial — must be enabled through an existing router).');
        const vetTx = await factory.vetRouter(routerAddress);
        const vetReceipt = await vetTx.wait();
        console.log(`  vetRouter tx: ${vetReceipt.hash} (status: ${vetReceipt.status})`);
    } else {
        console.log('  Vetting and enabling initial router.');
        const vetTx = await factory.vetInitialRouter(routerAddress);
        const vetReceipt = await vetTx.wait();
        console.log(`  vetInitialRouter tx: ${vetReceipt.hash} (status: ${vetReceipt.status})`);
    }
};

const main = async () => {
    const { GATEWAY_CONTRACT, AXELAR_SOURCE_CHAIN, FACTORY_CONTRACT, PERMIT2_CONTRACT } =
        process.env;
    if (!GATEWAY_CONTRACT || !AXELAR_SOURCE_CHAIN || !FACTORY_CONTRACT || !PERMIT2_CONTRACT) {
        throw new Error(
            'Missing env: GATEWAY_CONTRACT, AXELAR_SOURCE_CHAIN, FACTORY_CONTRACT, or PERMIT2_CONTRACT',
        );
    }
    if (!isAddress(GATEWAY_CONTRACT)) {
        throw new Error(`Invalid GATEWAY_CONTRACT: ${GATEWAY_CONTRACT}`);
    }
    if (!isAddress(FACTORY_CONTRACT)) {
        throw new Error(`Invalid FACTORY_CONTRACT: ${FACTORY_CONTRACT}`);
    }
    if (!isAddress(PERMIT2_CONTRACT)) {
        throw new Error(`Invalid PERMIT2_CONTRACT: ${PERMIT2_CONTRACT}`);
    }

    const [deployer] = await ethers.getSigners();
    const deployerAddress = await deployer.getAddress();
    const { chainId } = await ethers.provider.getNetwork();

    console.log(`\nCreateX CREATE3 Deploy — ${network.name} (${chainId})`);
    console.log(`  Deployer:          ${deployerAddress}`);
    console.log(`  Gateway:           ${GATEWAY_CONTRACT}`);
    console.log(`  Source Chain:      ${AXELAR_SOURCE_CHAIN}`);
    console.log(`  Factory:           ${FACTORY_CONTRACT}`);
    console.log(`  Permit2:           ${PERMIT2_CONTRACT}\n`);

    await validateCreateX();
    const createX = new Contract(CREATEX_ADDRESS, CREATEX_ABI, deployer);

    // Deploy RemoteAccountAxelarRouter via CREATE3
    console.log('RemoteAccountAxelarRouter:');
    const RouterCF = await ethers.getContractFactory('RemoteAccountAxelarRouter');
    const routerDeployTx = await RouterCF.getDeployTransaction(
        GATEWAY_CONTRACT,
        AXELAR_SOURCE_CHAIN,
        FACTORY_CONTRACT,
        PERMIT2_CONTRACT,
    );
    if (!routerDeployTx.data) {
        throw new Error('Failed to encode RemoteAccountAxelarRouter initCode');
    }
    // Use bytecode only (not full initCode) so the salt is chain-independent.
    // Constructor args include the gateway address which differs per chain,
    // but CREATE3 address depends only on deployer + salt, not initCode.
    const rawSalt = buildPermissionedSalt(deployerAddress, RouterCF.bytecode);
    const routerResult = await deployViaCreate3({
        createX,
        deployer: deployerAddress,
        rawSalt,
        initCode: routerDeployTx.data,
        label: 'RemoteAccountAxelarRouter',
    });

    // Verification
    await verifyOnExplorer({
        address: routerResult.address,
        constructorArgs: [
            GATEWAY_CONTRACT,
            AXELAR_SOURCE_CHAIN,
            FACTORY_CONTRACT,
            PERMIT2_CONTRACT,
        ],
        contract: 'src/contracts/RemoteAccountAxelarRouter.sol:RemoteAccountAxelarRouter',
    });

    // Vet router in factory
    await vetRouter(routerResult.address, FACTORY_CONTRACT);
};

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

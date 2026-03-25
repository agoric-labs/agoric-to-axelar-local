/**
 * Idempotent deployment of RemoteAccountImplementation and RemoteAccountFactory
 * via CREATE2 using Nick's deterministic deployer
 * (0x4e59b44847b379578588920cA78FbF26c0B4956C).
 *
 * The script computes the expected CREATE2 addresses from the current params
 * and bytecode, checks if the contracts are already on-chain, and only deploys
 * what's missing. Changing params (e.g. principal, vetting authority) or
 * bumping the salt version automatically produces new addresses.
 *
 * Required env vars:
 *   PRINCIPAL_CAIP2, PRINCIPAL_ACCOUNT, VETTING_AUTHORITY
 */
import '@nomicfoundation/hardhat-ethers';
import hre from 'hardhat';
import { config } from 'dotenv';

config();

/**
 * Nick Johnson's deterministic deployment proxy.
 * A minimal CREATE2 factory (69 bytes) deployed at the same address on all major EVM chains.
 * Unlike EIP-2470, this contract reverts on CREATE2 failure (no silent address(0) returns).
 *
 * Source (Yul):  https://github.com/Arachnid/deterministic-deployment-proxy/blob/master/source/deterministic-deployment-proxy.yul
 * Protocol:      calldata = salt (32 bytes) ++ initCode
 * EIP reference: EIP-2470 is a related standard; this proxy predates it.
 */
const DETERMINISTIC_DEPLOYER = '0x4e59b44847b379578588920cA78FbF26c0B4956C';

/**
 * Expected runtime bytecode of Nick's deployer, from the published deployment transaction.
 * Used to verify the on-chain contract is genuine before trusting it with deployments.
 */
const EXPECTED_DEPLOYER_BYTECODE =
    '0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3';

/** Fixed salts for reproducible addresses. Bump the version to rotate addresses. */
const IMPL_SALT = hre.ethers.keccak256(hre.ethers.toUtf8Bytes('agoric.RemoteAccount.v1'));
const FACTORY_SALT = hre.ethers.keccak256(hre.ethers.toUtf8Bytes('agoric.RemoteAccountFactory.v1'));

/**
 * Deploy a contract via the deterministic deployer if not already present.
 * @returns The deployed contract address.
 */
const deployCreate2 = async (salt: string, initCode: string, label: string): Promise<string> => {
    const expectedAddress = hre.ethers.getCreate2Address(
        DETERMINISTIC_DEPLOYER,
        salt,
        hre.ethers.keccak256(initCode),
    );

    // With CREATE2, this address is determined by the deployer, salt, and init code hash.
    // If code already exists here, then a deployment with these same CREATE2 inputs has
    // already succeeded, so we can treat this as idempotent.
    const existingCode = await hre.ethers.provider.getCode(expectedAddress);
    if (existingCode !== '0x') {
        console.log(`${label} already deployed at ${expectedAddress}, skipping.`);
        return expectedAddress;
    }

    console.log(`Deploying ${label} to ${expectedAddress}...`);
    const [deployer] = await hre.ethers.getSigners();
    const txData = hre.ethers.concat([salt, initCode]);
    // Gas estimation can underestimate for the deterministic deployer because it
    // cannot fully simulate the inner CREATE/CREATE2 opcode cost (especially on
    // L2s like Base). We estimate explicitly and add a 30 % buffer.
    const estimatedGas = await deployer.estimateGas({
        to: DETERMINISTIC_DEPLOYER,
        data: txData,
    });
    const gasLimit = (estimatedGas * 130n) / 100n;
    const tx = await deployer.sendTransaction({
        to: DETERMINISTIC_DEPLOYER,
        data: txData,
        gasLimit,
    });
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
        throw new Error(`${label} deployment tx reverted: ${receipt?.hash ?? 'unknown tx hash'}`);
    }
    console.log(`  tx: ${receipt.hash}`);

    const deployedCode = await hre.ethers.provider.getCode(expectedAddress);
    if (deployedCode === '0x') {
        throw new Error(`${label} was not deployed at expected address ${expectedAddress}`);
    }
    console.log(`  ${label} deployed successfully.`);
    return expectedAddress;
};

const verifyContract = async (
    address: string,
    constructorArguments: readonly unknown[],
    label: string,
) => {
    try {
        await hre.run('verify:verify', { address, constructorArguments });
        console.log(`  ${label} verified.`);
    } catch (e: any) {
        if (e.message?.includes('Already Verified') || e.message?.includes('already verified')) {
            console.log(`  ${label} already verified.`);
        } else {
            console.warn(`  ${label} verification failed:`, e.message);
        }
    }
};

const assertDeterministicDeployerExists = async () => {
    const code = await hre.ethers.provider.getCode(DETERMINISTIC_DEPLOYER);
    if (code === '0x') {
        throw new Error(
            `Deterministic deployer not found at ${DETERMINISTIC_DEPLOYER} on network ${hre.network.name}`,
        );
    }
    if (code !== EXPECTED_DEPLOYER_BYTECODE) {
        throw new Error(
            `Bytecode mismatch at ${DETERMINISTIC_DEPLOYER} on network ${hre.network.name}. ` +
                `Expected Nick's deployer but found unknown contract.`,
        );
    }
};

const main = async () => {
    const { PRINCIPAL_CAIP2, PRINCIPAL_ACCOUNT, VETTING_AUTHORITY } = process.env;
    if (!PRINCIPAL_CAIP2 || !PRINCIPAL_ACCOUNT || !VETTING_AUTHORITY) {
        throw new Error(
            'Missing required env vars: PRINCIPAL_CAIP2, PRINCIPAL_ACCOUNT, VETTING_AUTHORITY',
        );
    }
    if (!hre.ethers.isAddress(VETTING_AUTHORITY)) {
        throw new Error(`Invalid VETTING_AUTHORITY address: ${VETTING_AUTHORITY}`);
    }

    await assertDeterministicDeployerExists();

    console.log('Deploying with CREATE2:');
    console.log('  Principal CAIP2:', PRINCIPAL_CAIP2);
    console.log('  Principal Account:', PRINCIPAL_ACCOUNT);
    console.log('  Vetting Authority:', VETTING_AUTHORITY);
    console.log();

    // --- RemoteAccountImplementation (no constructor args) ---
    const implArtifact = await hre.artifacts.readArtifact('RemoteAccount');
    const implAddress = await deployCreate2(
        IMPL_SALT,
        implArtifact.bytecode,
        'RemoteAccountImplementation',
    );

    // --- RemoteAccountFactory ---
    const factoryArtifact = await hre.artifacts.readArtifact('RemoteAccountFactory');
    const factoryInterface = new hre.ethers.Interface(factoryArtifact.abi);
    const constructorArgs = factoryInterface.encodeDeploy([
        PRINCIPAL_CAIP2,
        PRINCIPAL_ACCOUNT,
        implAddress,
        VETTING_AUTHORITY,
    ]);
    const factoryInitCode = factoryArtifact.bytecode + constructorArgs.slice(2);
    const factoryAddress = await deployCreate2(
        FACTORY_SALT,
        factoryInitCode,
        'RemoteAccountFactory',
    );

    console.log();
    console.log('=== Deployment Summary ===');
    console.log(`RemoteAccountImplementation: ${implAddress}`);
    console.log(`RemoteAccountFactory:        ${factoryAddress}`);

    // --- Verification ---
    if (hre.network.name !== 'hardhat' && hre.network.name !== 'localhost') {
        console.log();
        console.log('Verifying contracts...');
        await verifyContract(implAddress, [], 'RemoteAccountImplementation');
        await verifyContract(
            factoryAddress,
            [PRINCIPAL_CAIP2, PRINCIPAL_ACCOUNT, implAddress, VETTING_AUTHORITY],
            'RemoteAccountFactory',
        );
    }
};

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

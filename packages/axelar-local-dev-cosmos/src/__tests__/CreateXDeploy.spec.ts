import { expect } from 'chai';
import { ethers } from 'hardhat';
import '@nomicfoundation/hardhat-chai-matchers';

import { buildSalt, buildPermissionedSalt, computeGuardedSalt } from '../../scripts/createx-utils';

/**
 * Tests for CreateX deployment properties that were previously verified
 * manually on testnets: address determinism, salt differentiation,
 * CREATE3 bytecode independence, and idempotency.
 */
describe('CreateX deployment properties', () => {
    let createX: any;
    let deployerAddress: string;

    before(async () => {
        const [deployer] = await ethers.getSigners();
        deployerAddress = await deployer.getAddress();

        // CreateXHarness inherits from CreateX, so it has all CreateX functionality
        const HarnessFactory = await ethers.getContractFactory('CreateXHarness');
        createX = await HarnessFactory.deploy();
    });

    /** Helper: compute the CREATE2 address that CreateX would produce. */
    const computeCreate2Address = async (rawSalt: string, initCode: string): Promise<string> => {
        const guardedSalt = computeGuardedSalt(deployerAddress, rawSalt);
        const initCodeHash = ethers.keccak256(initCode);
        return await createX.computeCreate2Address(guardedSalt, initCodeHash);
    };

    /** Helper: compute the CREATE3 address that CreateX would produce. */
    const computeCreate3Address = async (rawSalt: string): Promise<string> => {
        const guardedSalt = computeGuardedSalt(deployerAddress, rawSalt);
        return await createX.computeCreate3Address(guardedSalt);
    };

    const YMAX0_LCA = 'agoric18ek5td2h397cmejnlndes50k84ywx82kau7aff80t74fcxmjnzqstjclj0';
    const YMAX1_LCA = 'agoric1wl2529tfdlfvure7mw6zteam02prgaz88p0jru4tlzuxdawrdyys6jlmnq';

    describe('CREATE2: different LCA inputs produce different addresses', () => {
        it('ymax0 and ymax1 LCAs yield different RemoteAccount addresses', async () => {
            const RemoteAccountCF = await ethers.getContractFactory('RemoteAccount');
            const initCode = RemoteAccountCF.bytecode;

            const addr0 = await computeCreate2Address(
                buildSalt(ethers.solidityPacked(['string'], [YMAX0_LCA])),
                initCode,
            );
            const addr1 = await computeCreate2Address(
                buildSalt(ethers.solidityPacked(['string'], [YMAX1_LCA])),
                initCode,
            );

            expect(addr0).to.not.equal(addr1);
        });

        it('ymax0 and ymax1 LCAs yield different RemoteAccountFactory addresses', async () => {
            // Use a dummy impl address — what matters is the salt differs
            const dummyImpl = ethers.ZeroAddress;
            const FactoryCF = await ethers.getContractFactory('RemoteAccountFactory');

            const initCode0 = (
                await FactoryCF.getDeployTransaction(
                    'cosmos:agoricdev-25',
                    YMAX0_LCA,
                    dummyImpl,
                    deployerAddress,
                )
            ).data;
            const initCode1 = (
                await FactoryCF.getDeployTransaction(
                    'cosmos:agoricdev-25',
                    YMAX1_LCA,
                    dummyImpl,
                    deployerAddress,
                )
            ).data;

            const addr0 = await computeCreate2Address(
                buildSalt(ethers.solidityPacked(['string'], [YMAX0_LCA])),
                initCode0,
            );
            const addr1 = await computeCreate2Address(
                buildSalt(ethers.solidityPacked(['string'], [YMAX1_LCA])),
                initCode1,
            );

            expect(addr0).to.not.equal(addr1);
        });
    });

    describe('CREATE3: same salt yields same address regardless of initCode', () => {
        it('different constructor args (gateway, permit2) do not change the address', async () => {
            const factoryAddress = '0x' + 'ab'.repeat(20);

            const RouterCF = await ethers.getContractFactory('RemoteAccountAxelarRouter');

            // Simulate two chains with different gateway and permit2 addresses
            const gatewayChainA = '0x' + '11'.repeat(20);
            const gatewayChainB = '0x' + '22'.repeat(20);
            const permit2ChainA = '0x' + '33'.repeat(20);
            const permit2ChainB = '0x' + '44'.repeat(20);

            // Salt includes bytecode + source chain + factory (NOT gateway/permit2)
            const saltInput = ethers.solidityPacked(
                ['bytes', 'string', 'address'],
                [RouterCF.bytecode, 'agoric', factoryAddress],
            );
            const rawSalt = buildPermissionedSalt(deployerAddress, saltInput);

            // CREATE3 address depends only on salt, not initCode
            const addr = await computeCreate3Address(rawSalt);

            // Compute initCode for both "chains" — different constructor args
            const initCodeA = (
                await RouterCF.getDeployTransaction(
                    gatewayChainA,
                    'agoric',
                    factoryAddress,
                    permit2ChainA,
                )
            ).data;
            const initCodeB = (
                await RouterCF.getDeployTransaction(
                    gatewayChainB,
                    'agoric',
                    factoryAddress,
                    permit2ChainB,
                )
            ).data;

            // initCode differs between chains
            expect(initCodeA).to.not.equal(initCodeB);

            // Deploy with initCodeA — the actual address must match the prediction
            const tx = await createX['deployCreate3(bytes32,bytes)'](rawSalt, initCodeA);
            const receipt = await tx.wait();
            const deployedAddress =
                receipt.contractAddress ??
                receipt.logs.find((l: any) => l.fragment?.name === 'ContractCreation')?.args?.[0];

            expect(deployedAddress.toLowerCase()).to.equal(addr.toLowerCase());
        });
    });

    describe('CREATE2: idempotency — deploy then verify code exists', () => {
        it('deploys a contract and finds code at the predicted address', async () => {
            const RemoteAccountCF = await ethers.getContractFactory('RemoteAccount');
            const initCode = RemoteAccountCF.bytecode;
            const rawSalt = buildSalt(ethers.solidityPacked(['string'], ['idempotency-test']));

            const expectedAddress = await computeCreate2Address(rawSalt, initCode);

            // No code before deploy
            expect(await ethers.provider.getCode(expectedAddress)).to.equal('0x');

            // Deploy — use full signature to disambiguate overloaded function
            await createX['deployCreate2(bytes32,bytes)'](rawSalt, initCode);

            // Code exists after deploy and matches expected runtime bytecode
            const deployedCode = await ethers.provider.getCode(expectedAddress);
            expect(deployedCode).to.not.equal('0x');
            const expectedRuntime = await ethers.provider.call({ data: initCode });
            expect(ethers.keccak256(deployedCode)).to.equal(ethers.keccak256(expectedRuntime));

            // Deploying again with same salt reverts (CreateX prevents duplicate CREATE2)
            await expect(createX['deployCreate2(bytes32,bytes)'](rawSalt, initCode)).to.be.reverted;
        });
    });

    describe('CREATE3: idempotency — deploy then verify code exists', () => {
        it('deploys a contract and finds code at the predicted address', async () => {
            const RemoteAccountCF = await ethers.getContractFactory('RemoteAccount');
            const initCode = RemoteAccountCF.bytecode;
            const rawSalt = buildPermissionedSalt(
                deployerAddress,
                ethers.hexlify(ethers.toUtf8Bytes('idempotency-create3-test')),
            );

            const expectedAddress = await computeCreate3Address(rawSalt);

            // No code before deploy
            expect(await ethers.provider.getCode(expectedAddress)).to.equal('0x');

            // Deploy — use full signature to disambiguate overloaded function
            await createX['deployCreate3(bytes32,bytes)'](rawSalt, initCode);

            // Code exists after deploy and matches expected runtime bytecode
            const deployedCode = await ethers.provider.getCode(expectedAddress);
            expect(deployedCode).to.not.equal('0x');
            const expectedRuntime = await ethers.provider.call({ data: initCode });
            expect(ethers.keccak256(deployedCode)).to.equal(ethers.keccak256(expectedRuntime));

            // Deploying again with same salt reverts (proxy address already occupied)
            await expect(createX['deployCreate3(bytes32,bytes)'](rawSalt, initCode)).to.be.reverted;
        });
    });

    describe('CREATE3: different deployers produce different addresses', () => {
        it('permissioned salt binds the address to the deployer', async () => {
            const [, otherSigner] = await ethers.getSigners();
            const otherAddress = await otherSigner.getAddress();

            const hashInput = ethers.solidityPacked(
                ['bytes', 'string', 'address'],
                [ethers.randomBytes(50), 'agoric', deployerAddress],
            );

            // Same hash input, different deployers
            const saltA = buildPermissionedSalt(deployerAddress, hashInput);
            const saltB = buildPermissionedSalt(otherAddress, hashInput);

            const addrA = await computeCreate3Address(saltA);
            // computeCreate3Address uses deployerAddress internally, so compute B manually
            const guardedSaltB = computeGuardedSalt(otherAddress, saltB);
            const addrB = await createX.computeCreate3Address(guardedSaltB);

            expect(addrA).to.not.equal(addrB);
        });
    });
});

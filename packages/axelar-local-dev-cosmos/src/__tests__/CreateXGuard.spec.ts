import { expect } from 'chai';
import { ethers } from 'hardhat';
import '@nomicfoundation/hardhat-chai-matchers';

import { buildSalt, buildPermissionedSalt, computeGuardedSalt } from '../../scripts/createx-utils';

describe('CreateX _guard replication', () => {
    let harness: any;
    let deployerAddress: string;

    before(async () => {
        const [deployer] = await ethers.getSigners();
        deployerAddress = await deployer.getAddress();

        const HarnessFactory = await ethers.getContractFactory('CreateXHarness');
        harness = await HarnessFactory.deploy();
    });

    describe('buildPermissionedSalt (deployer-prefixed + 0x00 marker)', () => {
        // buildPermissionedSalt expects hex BytesLike input (0x-prefixed) since it
        // passes hashInput directly to keccak256. In production, callers use
        // solidityPacked output which is always 0x-prefixed.
        it('matches _guard for solidityPacked input', async () => {
            const input = ethers.solidityPacked(
                ['bytes', 'string', 'address'],
                [ethers.randomBytes(100), 'agoric', deployerAddress],
            );
            const rawSalt = buildPermissionedSalt(deployerAddress, input);
            const tsGuarded = computeGuardedSalt(deployerAddress, rawSalt);
            const solGuarded = await harness.exposedGuard(rawSalt);
            expect(tsGuarded).to.equal(solGuarded);
        });

        it('matches _guard for short hex input', async () => {
            const rawSalt = buildPermissionedSalt(deployerAddress, '0xdeadbeef');
            const tsGuarded = computeGuardedSalt(deployerAddress, rawSalt);
            const solGuarded = await harness.exposedGuard(rawSalt);
            expect(tsGuarded).to.equal(solGuarded);
        });

        it('matches _guard for long hex input', async () => {
            const input = ethers.hexlify(ethers.randomBytes(256));
            const rawSalt = buildPermissionedSalt(deployerAddress, input);
            const tsGuarded = computeGuardedSalt(deployerAddress, rawSalt);
            const solGuarded = await harness.exposedGuard(rawSalt);
            expect(tsGuarded).to.equal(solGuarded);
        });
    });

    describe('buildSalt (zero-prefixed + 0x00 marker)', () => {
        const inputs = [
            'agoric1wl2529tfdlfvure7mw6zteam02prgaz88p0jru4tlzuxdawrdyys6jlmnq',
            'agoric13ecz27mm2ug5kv96jyal2k6z8874mxzs4m4yuet36s4nqdl0ey6qr09p74',
            'simple-string',
        ];

        for (const input of inputs) {
            it(`matches _guard for input: ${input.slice(0, 40)}...`, async () => {
                const rawSalt = buildSalt(ethers.solidityPacked(['string'], [input]));
                const tsGuarded = computeGuardedSalt(deployerAddress, rawSalt);
                const solGuarded = await harness.exposedGuard(rawSalt);
                expect(tsGuarded).to.equal(solGuarded);
            });
        }
    });

    describe('salt structure validation', () => {
        it('buildSalt produces correct layout: 20 zero bytes + 0x00 marker + 11 bytes', () => {
            const salt = buildSalt(ethers.solidityPacked(['string'], ['test']));
            // 20 zero bytes (address)
            expect(salt.slice(2, 42)).to.equal('00'.repeat(20));
            // 0x00 marker byte
            expect(salt.slice(42, 44)).to.equal('00');
            // total length: 0x + 64 hex chars
            expect(salt.length).to.equal(66);
        });

        it('buildPermissionedSalt produces correct layout: deployer + 0x00 marker + 11 bytes', () => {
            const salt = buildPermissionedSalt(deployerAddress, '0xdeadbeef');
            // deployer address prefix
            expect(salt.slice(2, 42).toLowerCase()).to.equal(
                deployerAddress.slice(2).toLowerCase(),
            );
            // 0x00 marker byte
            expect(salt.slice(42, 44)).to.equal('00');
            // total length
            expect(salt.length).to.equal(66);
        });

        it('rejects salt with non-deployer, non-zero prefix', () => {
            const badSalt = '0x' + 'ab'.repeat(20) + '00' + 'ff'.repeat(11);
            expect(() => computeGuardedSalt(deployerAddress, badSalt)).to.throw(
                'Invalid salt prefix',
            );
        });

        it('rejects salt with non-0x00 marker byte', () => {
            const badSalt = '0x' + '00'.repeat(20) + '01' + 'ff'.repeat(11);
            expect(() => computeGuardedSalt(deployerAddress, badSalt)).to.throw(
                'Unsupported marker byte',
            );
        });
    });
});

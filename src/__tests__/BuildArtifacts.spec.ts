import { expect } from 'chai';
import { artifacts } from 'hardhat';
import { keccak256 } from 'ethers';

// Contracts that are deployed on-chain directly by a deployment script (an ignition
// module, scripts/deployRemoteAccountFactory.ts, or scripts/deployPortfolioRouter.ts).
// The compiler embeds each contract's relative source path into its metadata, which
// in turn affects the compiled bytecode. So a change here — even one that doesn't
// touch a contract's Solidity source, like renaming or moving its file — changes
// what would be deployed on-chain. Pin the hashes so any such change is caught.
const DEPLOYED_CONTRACTS: Record<
  string,
  { bytecodeHash: string; deployedBytecodeHash: string }
> = {
  'src/contracts/Factory.sol:Factory': {
    bytecodeHash: '0xf3f9ed7a2e4cb03ec992a85ceadc4856d226c312496146c1a99c4d61376afeef',
    deployedBytecodeHash: '0x4a1ae71f626c0658bb615176c1a5a86aa0c4390032df644f55a0e252b0cbc087',
  },
  'src/contracts/DepositFactory.sol:DepositFactory': {
    bytecodeHash: '0x5f2a1b784e509db31bea926e281fb98a52b541c20b3e23ba2285e4434aeae10b',
    deployedBytecodeHash: '0xffb4047d946b283d9bea2882904d7db9aae4d504a531f900de3e28fa6fdc4933',
  },
  'src/contracts/WalletHelper.sol:WalletHelper': {
    bytecodeHash: '0xe37f21d49b00a04cf822cb5c9513409174c99ae8cbfc171bf485293cab32a3f9',
    deployedBytecodeHash: '0x759df68f054d551525c59cc35bf2be71350509801d34a4f849efad6a9827d777',
  },
  'src/contracts/RemoteAccount.sol:RemoteAccount': {
    bytecodeHash: '0x6830e34702a6bcbe47073049245c4e60efe4114056404a36ad813e4fdf641ebf',
    deployedBytecodeHash: '0x8c4d4a0db1b9dd41ddc1e149e118c26a121cd600d3c7437cca51a8939f287deb',
  },
  'src/contracts/RemoteAccountFactory.sol:RemoteAccountFactory': {
    bytecodeHash: '0xc226f54bb578c950cac1e879e5147cf5aee053645f282dcfc4f3664e9336e797',
    deployedBytecodeHash: '0x8b0861a40f86bf81b9047ce7868ad3b0a6a3ab1373bba83ad9bda08de74bcc0c',
  },
  'src/contracts/RemoteAccountAxelarRouter.sol:RemoteAccountAxelarRouter': {
    bytecodeHash: '0x48157ae7e737ff4bd8bdb7651f79c9cfa84b25cbb3d2fd24936acdae6d634eb2',
    deployedBytecodeHash: '0xb83b6089408f81b305f769dedb1c0b5056fc8db3a5bc99d2ae2e2877168324c7',
  },
};

describe('Build artifact reproducibility', () => {
  for (const [fullyQualifiedName, expected] of Object.entries(DEPLOYED_CONTRACTS)) {
    it(`${fullyQualifiedName} bytecode is unchanged`, async () => {
      const artifact = await artifacts.readArtifact(fullyQualifiedName);

      expect(keccak256(artifact.bytecode), 'init code (creation bytecode) hash').to.equal(
        expected.bytecodeHash,
      );
      expect(
        keccak256(artifact.deployedBytecode),
        'runtime (deployed) bytecode hash',
      ).to.equal(expected.deployedBytecodeHash);
    });
  }
});

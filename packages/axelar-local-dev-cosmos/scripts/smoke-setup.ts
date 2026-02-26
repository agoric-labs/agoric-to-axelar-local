import { ethers } from 'hardhat';

async function main() {
  const [creator, tim, reporter, p75] = await ethers.getSigners();

  const MockERC20 = await ethers.getContractFactory('MockERC20');
  const usdc = await MockERC20.connect(creator).deploy('Mock USDC', 'USDC', 6);
  const usdcDeployTx = usdc.deploymentTransaction();
  const usdcDeployReceipt = await usdcDeployTx?.wait();
  await usdc.waitForDeployment();

  const Factory = await ethers.getContractFactory('YmaxVaultFactory');
  const factory = await Factory.connect(creator).deploy(await reporter.getAddress());
  const factoryDeployTx = factory.deploymentTransaction();
  const factoryDeployReceipt = await factoryDeployTx?.wait();
  await factory.waitForDeployment();

  const createTx = await factory.connect(creator).createVault(
    await usdc.getAddress(),
    'Chris Vault Share',
    'CVSH',
    await p75.getAddress(),
    50_000n,
    2000,
    500,
    8n * 60n * 60n,
  );
  const receipt = await createTx.wait();
  const createBlock = receipt?.blockNumber
    ? await ethers.provider.getBlock(receipt.blockNumber)
    : undefined;

  const parsed = receipt!.logs
    .map(log => {
      try {
        return factory.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find(p => p?.name === 'VaultCreated');

  const vault = parsed?.args.vault as string;

  const mintTx = await usdc.connect(creator).mint(await tim.getAddress(), 100_000_000n);
  const mintReceipt = await mintTx.wait();
  const mintBlock = mintReceipt?.blockNumber
    ? await ethers.provider.getBlock(mintReceipt.blockNumber)
    : undefined;

  const createdLog = receipt!.logs
    .map(log => {
      try {
        return factory.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find(p => p?.name === 'VaultCreated');

  console.log(JSON.stringify({
    chain: 'localhost',
    startedAtIso: new Date().toISOString(),
    usdc: await usdc.getAddress(),
    factory: await factory.getAddress(),
    vault,
    tx: {
      usdcDeploy: {
        hash: usdcDeployTx?.hash,
        blockNumber: usdcDeployReceipt?.blockNumber,
      },
      factoryDeploy: {
        hash: factoryDeployTx?.hash,
        blockNumber: factoryDeployReceipt?.blockNumber,
      },
      createVault: {
        hash: createTx.hash,
        blockNumber: receipt?.blockNumber,
        blockTimestamp: createBlock?.timestamp,
        blockIsoTime: createBlock
          ? new Date(createBlock.timestamp * 1000).toISOString()
          : undefined,
      },
      mintToTim: {
        hash: mintTx.hash,
        blockNumber: mintReceipt?.blockNumber,
        blockTimestamp: mintBlock?.timestamp,
        blockIsoTime: mintBlock
          ? new Date(mintBlock.timestamp * 1000).toISOString()
          : undefined,
      },
    },
    events: {
      vaultCreated: createdLog
        ? {
            vault: createdLog.args.vault?.toString(),
            creator: createdLog.args.creator?.toString(),
            ownerPortfolioAccount: createdLog.args.ownerPortfolioAccount?.toString(),
            asset: createdLog.args.asset?.toString(),
            name: createdLog.args.name?.toString(),
            symbol: createdLog.args.symbol?.toString(),
          }
        : null,
    },
    creator: await creator.getAddress(),
    tim: await tim.getAddress(),
    timPrivateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    reporter: await reporter.getAddress(),
    p75: await p75.getAddress(),
    mintedToTim: '100000000',
  }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

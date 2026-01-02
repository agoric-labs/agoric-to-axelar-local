import AxelarGasService from "@axelar-network/axelar-cgp-solidity/artifacts/contracts/gas-service/AxelarGasService.sol/AxelarGasService.json";
import { expect } from "chai";
import { ethers } from "hardhat";
import { keccak256, stringToHex, toBytes } from "viem";
import "@nomicfoundation/hardhat-chai-matchers";
import { approveMessage, deployToken } from "./lib/utils";

const computeFactoryCreate2Address = async (
  factoryFactoryAddress: string,
  gatewayAddress: string,
  gasServiceAddress: string,
  permit2Address: string,
  owner: string,
) => {
  const salt = ethers.solidityPackedKeccak256(["string"], [owner]);

  // Get the Factory contract bytecode and constructor args
  const FactoryFactory = await ethers.getContractFactory("Factory");
  const constructorArgs = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "address", "string"],
    [gatewayAddress, gasServiceAddress, permit2Address, owner],
  );
  const initCode = ethers.solidityPacked(
    ["bytes", "bytes"],
    [FactoryFactory.bytecode, constructorArgs],
  );
  const initCodeHash = ethers.keccak256(initCode);

  return ethers.getCreate2Address(factoryFactoryAddress, salt, initCodeHash);
};

const computeWalletCreate2Address = async (
  factoryAddress: string,
  gatewayAddress: string,
  gasServiceAddress: string,
  owner: string,
) => {
  const salt = ethers.solidityPackedKeccak256(["string"], [owner]);

  // Get the Wallet contract bytecode and constructor args
  const WalletFactory = await ethers.getContractFactory("Wallet");
  const constructorArgs = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "string"],
    [gatewayAddress, gasServiceAddress, owner],
  );
  const initCode = ethers.solidityPacked(
    ["bytes", "bytes"],
    [WalletFactory.bytecode, constructorArgs],
  );
  const initCodeHash = ethers.keccak256(initCode);

  return ethers.getCreate2Address(factoryAddress, salt, initCodeHash);
};

describe("FactoryFactory", () => {
  let owner,
    addr1,
    factoryFactory,
    axelarGatewayMock,
    axelarGasServiceMock,
    permit2Mock;

  const abiCoder = new ethers.AbiCoder();

  const sourceChain = "agoric";
  const factoryOwner = "agoric1wrfh296eu2z34p6pah7q04jjuyj3mxu9v98277";

  let commandIdCounter = 1;
  const getCommandId = () => {
    const commandId = keccak256(stringToHex(String(commandIdCounter)));
    commandIdCounter++;
    return commandId;
  };

  before(async () => {
    [owner, addr1] = await ethers.getSigners();

    const GasServiceFactory = await ethers.getContractFactory(
      AxelarGasService.abi,
      AxelarGasService.bytecode,
    );

    axelarGasServiceMock = await GasServiceFactory.deploy(owner.address);

    const TokenDeployerFactory =
      await ethers.getContractFactory("TokenDeployer");
    const tokenDeployer = await TokenDeployerFactory.deploy();

    const AuthFactory = await ethers.getContractFactory("AxelarAuthWeighted");
    const authContract = await AuthFactory.deploy([
      abiCoder.encode(
        ["address[]", "uint256[]", "uint256"],
        [[owner.address], [1], 1],
      ),
    ]);

    const AxelarGatewayFactory =
      await ethers.getContractFactory("AxelarGateway");
    axelarGatewayMock = await AxelarGatewayFactory.deploy(
      authContract.target,
      tokenDeployer.target,
    );

    // Deploy a mock Permit2 contract
    const MockPermit2Factory = await ethers.getContractFactory("MockPermit2");
    permit2Mock = await MockPermit2Factory.deploy();
    await permit2Mock.waitForDeployment();

    const Contract = await ethers.getContractFactory("FactoryFactory");
    factoryFactory = await Contract.deploy(
      axelarGatewayMock.target,
      axelarGasServiceMock.target,
      permit2Mock.target,
    );
    await factoryFactory.waitForDeployment();

    await deployToken({
      commandId: getCommandId(),
      name: "Universal Stablecoin",
      symbol: "USDC",
      decimals: 18,
      cap: 1000000,
      tokenAddress: "0x0000000000000000000000000000000000000000",
      mintLimit: 1000000,
      owner,
      AxelarGateway: axelarGatewayMock,
      abiCoder,
    });
  });

  it("should create a new Factory using FactoryFactory", async () => {
    const commandId = getCommandId();

    const payload = abiCoder.encode([], []);
    const payloadHash = keccak256(toBytes(payload));

    await approveMessage({
      commandId,
      from: sourceChain,
      sourceAddress: factoryOwner,
      targetAddress: factoryFactory.target,
      payload: payloadHash,
      owner,
      AxelarGateway: axelarGatewayMock,
      abiCoder,
    });

    // Compute the expected CREATE2 address for Factory
    const expectedFactoryAddress = await computeFactoryCreate2Address(
      factoryFactory.target.toString(),
      axelarGatewayMock.target.toString(),
      axelarGasServiceMock.target.toString(),
      permit2Mock.target.toString(),
      factoryOwner,
    );

    const tx = await factoryFactory.execute(
      commandId,
      sourceChain,
      factoryOwner,
      payload,
    );

    await expect(tx)
      .to.emit(factoryFactory, "FactoryCreated")
      .withArgs(expectedFactoryAddress, factoryOwner, "agoric", factoryOwner);

    // Verify the Factory was actually deployed at the expected address
    const code = await ethers.provider.getCode(expectedFactoryAddress);
    expect(code).to.not.equal("0x");
  });

  it("should verify Factory has correct owner", async () => {
    // Get the Factory contract at the CREATE2 address
    const expectedFactoryAddress = await computeFactoryCreate2Address(
      factoryFactory.target.toString(),
      axelarGatewayMock.target.toString(),
      axelarGasServiceMock.target.toString(),
      permit2Mock.target.toString(),
      factoryOwner,
    );

    const FactoryContract = await ethers.getContractFactory("Factory");
    const factory = FactoryContract.attach(expectedFactoryAddress);

    // Verify the owner
    const owner = await factory.owner();
    expect(owner).to.equal(factoryOwner);
  });

  it("should test full hierarchy: FactoryFactory -> Factory -> Wallet", async () => {
    // Get the Factory contract
    const expectedFactoryAddress = await computeFactoryCreate2Address(
      factoryFactory.target.toString(),
      axelarGatewayMock.target.toString(),
      axelarGasServiceMock.target.toString(),
      permit2Mock.target.toString(),
      factoryOwner,
    );

    const FactoryContract = await ethers.getContractFactory("Factory");
    const factory = FactoryContract.attach(expectedFactoryAddress);

    // Now create a Wallet using the Factory
    const commandId = getCommandId();
    const payload = abiCoder.encode([], []);
    const payloadHash = keccak256(toBytes(payload));

    await approveMessage({
      commandId,
      from: sourceChain,
      sourceAddress: factoryOwner, // Factory owner must match
      targetAddress: factory.target,
      payload: payloadHash,
      owner,
      AxelarGateway: axelarGatewayMock,
      abiCoder,
    });

    // Compute the expected CREATE2 address for Wallet
    const expectedWalletAddress = await computeWalletCreate2Address(
      factory.target.toString(),
      axelarGatewayMock.target.toString(),
      axelarGasServiceMock.target.toString(),
      factoryOwner,
    );

    const tx = await factory.execute(
      commandId,
      sourceChain,
      factoryOwner,
      payload,
    );

    await expect(tx)
      .to.emit(factory, "SmartWalletCreated")
      .withArgs(expectedWalletAddress, factoryOwner, "agoric", factoryOwner);

    // Verify the Wallet was deployed
    const code = await ethers.provider.getCode(expectedWalletAddress);
    expect(code).to.not.equal("0x");
  });

  it("FactoryFactory should fail when source chain is not agoric", async () => {
    const commandId = getCommandId();

    const payload = abiCoder.encode([], []);
    const payloadHash = keccak256(toBytes(payload));

    const wrongSourceChain = "ethereum"; // Wrong source chain
    const sourceAddr = "agoric1differentaddress000000000000000000";

    await approveMessage({
      commandId,
      from: wrongSourceChain,
      sourceAddress: sourceAddr,
      targetAddress: factoryFactory.target,
      payload: payloadHash,
      owner,
      AxelarGateway: axelarGatewayMock,
      abiCoder,
    });

    // This should fail because source chain is not "agoric"
    await expect(
      factoryFactory.execute(commandId, wrongSourceChain, sourceAddr, payload),
    ).to.be.revertedWithCustomError(factoryFactory, "InvalidSourceChain");
  });

  it("Factory should fail when caller is not the owner", async () => {
    // Get the Factory contract
    const expectedFactoryAddress = await computeFactoryCreate2Address(
      factoryFactory.target.toString(),
      axelarGatewayMock.target.toString(),
      axelarGasServiceMock.target.toString(),
      permit2Mock.target.toString(),
      factoryOwner,
    );

    const FactoryContract = await ethers.getContractFactory("Factory");
    const factory = FactoryContract.attach(expectedFactoryAddress);

    // Try to create a Wallet with a different owner
    const commandId = getCommandId();
    const payload = abiCoder.encode([], []);
    const payloadHash = keccak256(toBytes(payload));

    const unauthorizedAddress = "agoric1unauthorizedaddress00000000000000";

    await approveMessage({
      commandId,
      from: sourceChain,
      sourceAddress: unauthorizedAddress,
      targetAddress: factory.target,
      payload: payloadHash,
      owner,
      AxelarGateway: axelarGatewayMock,
      abiCoder,
    });

    // This should fail because sourceAddress is not the factory owner
    await expect(
      factory.execute(commandId, sourceChain, unauthorizedAddress, payload),
    ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
  });

  it("should verify CREATE2 determinism for Factory", async () => {
    // Same owner should always generate same Factory address
    const address1 = await computeFactoryCreate2Address(
      factoryFactory.target.toString(),
      axelarGatewayMock.target.toString(),
      axelarGasServiceMock.target.toString(),
      permit2Mock.target.toString(),
      factoryOwner,
    );

    const address2 = await computeFactoryCreate2Address(
      factoryFactory.target.toString(),
      axelarGatewayMock.target.toString(),
      axelarGasServiceMock.target.toString(),
      permit2Mock.target.toString(),
      factoryOwner,
    );

    expect(address1).to.equal(address2);

    // Different owner should generate different address
    const differentOwner = "agoric1differentowner00000000000000000000";
    const address3 = await computeFactoryCreate2Address(
      factoryFactory.target.toString(),
      axelarGatewayMock.target.toString(),
      axelarGasServiceMock.target.toString(),
      permit2Mock.target.toString(),
      differentOwner,
    );

    expect(address1).to.not.equal(address3);
  });
});

import AxelarGasService from "@axelar-network/axelar-cgp-solidity/artifacts/contracts/gas-service/AxelarGasService.sol/AxelarGasService.json";
import { expect } from "chai";
import { ethers } from "hardhat";
import { keccak256, stringToHex, toBytes } from "viem";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { Contract, LogDescription, Log } from "ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import {
  approveMessage,
  constructContractCall,
  deployToken,
  encodeMulticallPayload,
  getPayloadHash,
} from "./lib/utils";

const computeCreate2Address = async (
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

const createRemoteEVMAccount = async (
  axelarGatewayMock: Contract,
  ownerAddress: string,
  sourceAddress: string,
) => {
  const WalletFactory = await ethers.getContractFactory("Wallet");
  const wallet = await WalletFactory.deploy(
    axelarGatewayMock.target,
    ownerAddress,
    sourceAddress,
  );
  await wallet.waitForDeployment();
  return wallet;
};

describe("Factory", () => {
  let owner: HardhatEthersSigner,
    addr1: HardhatEthersSigner,
    factory: Contract,
    axelarGatewayMock: Contract,
    axelarGasServiceMock: Contract,
    permit2Mock: Contract;

  const abiCoder = new ethers.AbiCoder();

  const sourceChain = "agoric";
  const sourceAddress = "agoric1wrfh296eu2z34p6pah7q04jjuyj3mxu9v98277";

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

    const MockPermit2Factory = await ethers.getContractFactory("MockPermit2");
    permit2Mock = await MockPermit2Factory.deploy();
    await permit2Mock.waitForDeployment();

    const Contract = await ethers.getContractFactory("Factory");
    factory = await Contract.deploy(
      axelarGatewayMock.target,
      axelarGasServiceMock.target,
      permit2Mock.target,
    );
    await factory.waitForDeployment();

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

  it("fund Factory with ETH to pay for gas", async () => {
    const provider = ethers.provider;

    const factoryAddress = await factory.getAddress();
    const balanceBefore = await provider.getBalance(factoryAddress);
    expect(balanceBefore).to.equal(ethers.parseEther("0"));

    const tx = await owner.sendTransaction({
      to: factoryAddress,
      value: ethers.parseEther("5.0"),
    });
    await tx.wait();

    const receipt = await provider.getTransactionReceipt(tx.hash);
    const iface = (await ethers.getContractFactory("Factory")).interface;
    const receivedEvent = receipt?.logs
      .map((log: Log) => {
        try {
          return iface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find(
        (parsed: LogDescription | null) => parsed && parsed.name === "Received",
      );

    expect(receivedEvent).to.not.be.undefined;
    expect(receivedEvent?.args.sender).to.equal(owner.address);
    expect(receivedEvent?.args.amount).to.equal(ethers.parseEther("5.0"));

    const balanceAfter = await provider.getBalance(factoryAddress);
    expect(balanceAfter).to.equal(ethers.parseEther("5.0"));
  });

  it("should create a new remote wallet using Factory", async () => {
    const commandId = getCommandId();

    const payload = abiCoder.encode([], []);
    const payloadHash = keccak256(toBytes(payload));

    await approveMessage({
      commandId,
      from: sourceChain,
      sourceAddress,
      targetAddress: factory.target,
      payload: payloadHash,
      owner,
      AxelarGateway: axelarGatewayMock,
      abiCoder,
    });

    // Compute the expected CREATE2 address
    const expectedWalletAddress = await computeCreate2Address(
      factory.target.toString(),
      axelarGatewayMock.target.toString(),
      axelarGasServiceMock.target.toString(),
      sourceAddress,
    );

    const tx = await factory.execute(
      commandId,
      sourceChain,
      sourceAddress,
      payload,
    );

    await expect(tx)
      .to.emit(factory, "SmartWalletCreated")
      .withArgs(expectedWalletAddress, sourceAddress, "agoric", sourceAddress);
  });

  it("should use the remote wallet to call other contracts", async () => {
    // Deploy Multicall.sol
    const MulticallFactory = await ethers.getContractFactory("Multicall");
    const multicall = await MulticallFactory.deploy();
    await multicall.waitForDeployment();

    const wallet = await createRemoteEVMAccount(
      axelarGatewayMock,
      owner.address,
      sourceAddress,
    );

    // Test ContractCall
    const multicallAddress = await multicall.getAddress();
    const abiEncodedContractCalls = [
      constructContractCall({
        target: multicallAddress,
        functionSignature: "setValue(uint256)",
        args: [10],
      }),
      constructContractCall({
        target: multicallAddress,
        functionSignature: "addToValue(uint256)",
        args: [17],
      }),
    ];
    const multicallPayload = encodeMulticallPayload(
      abiEncodedContractCalls,
      "tx1",
    );
    const payloadHash = getPayloadHash(multicallPayload);

    const commandId1 = getCommandId();
    await approveMessage({
      commandId: commandId1,
      from: sourceChain,
      sourceAddress,
      targetAddress: wallet.target,
      payload: payloadHash,
      owner,
      AxelarGateway: axelarGatewayMock,
      abiCoder,
    });

    const execTx = await wallet.execute(
      commandId1,
      sourceChain,
      sourceAddress,
      multicallPayload,
    );

    const receipt = await execTx.wait();
    const walletInterface = wallet.interface;

    // Check CallStatus events for each call
    const callStatusEvents = receipt?.logs
      .map((log: Log) => {
        try {
          return walletInterface.parseLog(log);
        } catch {
          return null;
        }
      })
      .filter(
        (parsed: LogDescription | null) =>
          parsed && parsed.name === "CallStatus",
      );

    expect(callStatusEvents).to.have.lengthOf(2);
    expect(callStatusEvents[0]?.args.callIndex).to.equal(0);
    expect(callStatusEvents[0]?.args.target).to.equal(multicallAddress);
    expect(callStatusEvents[0]?.args.success).to.be.true;

    expect(callStatusEvents[1]?.args.callIndex).to.equal(1);
    expect(callStatusEvents[1]?.args.target).to.equal(multicallAddress);
    expect(callStatusEvents[1]?.args.success).to.be.true;

    // Check MulticallStatus event
    await expect(execTx)
      .to.emit(wallet, "MulticallStatus")
      .withArgs("tx1", true, 2);

    const value = await multicall.getValue();
    expect(value).to.equal(27);
  });

  it("wallet contract should fail when source chain is not agoric", async () => {
    // Deploy Multicall.sol
    const MulticallFactory = await ethers.getContractFactory("Multicall");
    const multicall = await MulticallFactory.deploy();
    await multicall.waitForDeployment();

    const wallet = await createRemoteEVMAccount(
      axelarGatewayMock,
      owner.address,
      sourceAddress,
    );

    // Test ContractCall
    const multicallAddress = await multicall.getAddress();
    const abiEncodedContractCalls = [
      constructContractCall({
        target: multicallAddress,
        functionSignature: "setValue(uint256)",
        args: [10],
      }),
      constructContractCall({
        target: multicallAddress,
        functionSignature: "addToValue(uint256)",
        args: [17],
      }),
    ];
    const multicallPayload = encodeMulticallPayload(
      abiEncodedContractCalls,
      "tx1",
    );
    const payloadHash = getPayloadHash(multicallPayload);
    const wrongSourceChain = "ethereum"; // Wrong source chain

    const commandId1 = getCommandId();
    await approveMessage({
      commandId: commandId1,
      from: wrongSourceChain,
      sourceAddress,
      targetAddress: wallet.target,
      payload: payloadHash,
      owner,
      AxelarGateway: axelarGatewayMock,
      abiCoder,
    });

    // This should fail because source chain is not "agoric"
    await expect(
      wallet.execute(
        commandId1,
        wrongSourceChain,
        sourceAddress,
        multicallPayload,
      ),
    ).to.be.revertedWithCustomError(wallet, "InvalidSourceChain");
  });

  it("factory contract should fail when source chain is not agoric", async () => {
    const commandId = getCommandId();

    const payload = abiCoder.encode([], []);
    const payloadHash = keccak256(toBytes(payload));

    const wrongSourceChain = "ethereum"; // Wrong source chain
    const sourceAddr = "agoric1ee9hr0jyrxhy999y755mp862ljgycmwyp4pl7q";

    await approveMessage({
      commandId,
      from: wrongSourceChain,
      sourceAddress: sourceAddr,
      targetAddress: factory.target,
      payload: payloadHash,
      owner,
      AxelarGateway: axelarGatewayMock,
      abiCoder,
    });

    // This should fail because source chain is not "agoric"
    await expect(
      factory.execute(commandId, wrongSourceChain, sourceAddr, payload),
    ).to.be.revertedWithCustomError(factory, "InvalidSourceChain");
  });

  it("should create wallet and deposit tokens using Permit2", async () => {
    const commandId = getCommandId();
    const uniqueOwner = "agoric1permit2test001";

    // Deploy a mock ERC20 token
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    const mockToken = await MockERC20Factory.deploy("Mock Token", "MOCK", 18);
    await mockToken.waitForDeployment();

    // Mint tokens to addr1 (the tokenOwner)
    const depositAmount = ethers.parseEther("100");
    await mockToken.mint(addr1.address, depositAmount);
    expect(await mockToken.balanceOf(addr1.address)).to.equal(depositAmount);

    // Approve Permit2 to spend tokens on behalf of addr1
    await mockToken.connect(addr1).approve(permit2Mock.target, depositAmount);

    // Prepare Permit2 permit struct
    const permit = {
      permitted: {
        token: await mockToken.getAddress(),
        amount: depositAmount,
      },
      nonce: 1,
      deadline: Math.floor(Date.now() / 1000) + 5 * 60, // 5 min from now
    };

    // Create a mock signature (MockPermit2 validates length but not actual signature)
    const mockSignature = ethers.hexlify(ethers.randomBytes(65));

    // Encode CreateAndDepositPayload
    const createAndDepositPayload = abiCoder.encode(
      [
        "tuple(string ownerStr, address tokenOwner, tuple(tuple(address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit, bytes signature)",
      ],
      [
        {
          ownerStr: uniqueOwner,
          tokenOwner: addr1.address,
          permit: permit,
          signature: mockSignature,
        },
      ],
    );

    const payloadHash = keccak256(toBytes(createAndDepositPayload));

    await approveMessage({
      commandId,
      from: sourceChain,
      sourceAddress: uniqueOwner,
      targetAddress: factory.target,
      payload: payloadHash,
      owner,
      AxelarGateway: axelarGatewayMock,
      abiCoder,
    });

    // Compute the expected CREATE2 address
    const expectedWalletAddress = await computeCreate2Address(
      factory.target.toString(),
      axelarGatewayMock.target.toString(),
      axelarGasServiceMock.target.toString(),
      uniqueOwner,
    );

    const tx = await factory.execute(
      commandId,
      sourceChain,
      uniqueOwner,
      createAndDepositPayload,
    );

    // Verify SmartWalletCreated event was emitted
    await expect(tx)
      .to.emit(factory, "SmartWalletCreated")
      .withArgs(expectedWalletAddress, uniqueOwner, "agoric", uniqueOwner);

    // Verify tokens were transferred to the new wallet
    expect(await mockToken.balanceOf(expectedWalletAddress)).to.equal(
      depositAmount,
    );
    expect(await mockToken.balanceOf(addr1.address)).to.equal(0);
  });

  it("should fail createAndDeposit when deadline has expired", async () => {
    const commandId = getCommandId();
    const uniqueOwner = "agoric1expiredtest002";

    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    const mockToken = await MockERC20Factory.deploy("Mock Token", "MOCK", 18);
    await mockToken.waitForDeployment();

    const depositAmount = ethers.parseEther("100");
    await mockToken.mint(addr1.address, depositAmount);
    await mockToken.connect(addr1).approve(permit2Mock.target, depositAmount);

    const permit = {
      permitted: {
        token: await mockToken.getAddress(),
        amount: depositAmount,
      },
      nonce: 10,
      deadline: Math.floor(Date.now() / 1000) - 60 * 60, // Expired - substract 1 hour from current time
    };

    const mockSignature = ethers.hexlify(ethers.randomBytes(65));

    const createAndDepositPayload = abiCoder.encode(
      [
        "tuple(string ownerStr, address tokenOwner, tuple(tuple(address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit, bytes signature)",
      ],
      [
        {
          ownerStr: uniqueOwner,
          tokenOwner: addr1.address,
          permit: permit,
          signature: mockSignature,
        },
      ],
    );

    const payloadHash = keccak256(toBytes(createAndDepositPayload));

    await approveMessage({
      commandId,
      from: sourceChain,
      sourceAddress: uniqueOwner,
      targetAddress: factory.target,
      payload: payloadHash,
      owner,
      AxelarGateway: axelarGatewayMock,
      abiCoder,
    });

    await expect(
      factory.execute(
        commandId,
        sourceChain,
        uniqueOwner,
        createAndDepositPayload,
      ),
    ).to.be.revertedWithCustomError(permit2Mock, "SignatureExpired");
  });

  it("should fail createAndDeposit when nonce is reused", async () => {
    const commandId1 = getCommandId();
    const commandId2 = getCommandId();

    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    const mockToken = await MockERC20Factory.deploy("Mock Token", "MOCK", 18);
    await mockToken.waitForDeployment();

    const depositAmount = ethers.parseEther("50");
    await mockToken.mint(addr1.address, depositAmount * 2n);
    await mockToken
      .connect(addr1)
      .approve(permit2Mock.target, depositAmount * 2n);

    const reusedNonce = 100;
    const deadline = Math.floor(Date.now() / 1000) + 3600;

    // First transaction with nonce 100
    const permit1 = {
      permitted: {
        token: await mockToken.getAddress(),
        amount: depositAmount,
      },
      nonce: reusedNonce,
      deadline: deadline,
    };

    const mockSignature1 = ethers.hexlify(ethers.randomBytes(65));

    const payload1 = abiCoder.encode(
      [
        "tuple(string ownerStr, address tokenOwner, tuple(tuple(address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit, bytes signature)",
      ],
      [
        {
          ownerStr: "agoric1user1",
          tokenOwner: addr1.address,
          permit: permit1,
          signature: mockSignature1,
        },
      ],
    );

    const payloadHash1 = keccak256(toBytes(payload1));

    await approveMessage({
      commandId: commandId1,
      from: sourceChain,
      sourceAddress: "agoric1user1",
      targetAddress: factory.target,
      payload: payloadHash1,
      owner,
      AxelarGateway: axelarGatewayMock,
      abiCoder,
    });

    // First transaction should succeed
    await factory.execute(commandId1, sourceChain, "agoric1user1", payload1);

    // Second transaction with the SAME nonce 100
    const permit2 = {
      permitted: {
        token: await mockToken.getAddress(),
        amount: depositAmount,
      },
      nonce: reusedNonce,
      deadline: deadline,
    };

    const mockSignature2 = ethers.hexlify(ethers.randomBytes(65));

    const payload2 = abiCoder.encode(
      [
        "tuple(string ownerStr, address tokenOwner, tuple(tuple(address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit, bytes signature)",
      ],
      [
        {
          ownerStr: "agoric1user2",
          tokenOwner: addr1.address,
          permit: permit2,
          signature: mockSignature2,
        },
      ],
    );

    const payloadHash2 = keccak256(toBytes(payload2));

    await approveMessage({
      commandId: commandId2,
      from: sourceChain,
      sourceAddress: "agoric1user2",
      targetAddress: factory.target,
      payload: payloadHash2,
      owner,
      AxelarGateway: axelarGatewayMock,
      abiCoder,
    });

    // Second transaction should fail due to nonce reuse
    await expect(
      factory.execute(commandId2, sourceChain, "agoric1user2", payload2),
    ).to.be.revertedWithCustomError(permit2Mock, "InvalidNonce");
  });

  it("should correctly distinguish between empty and non-empty payload", async () => {
    const commandId1 = getCommandId();
    const commandId2 = getCommandId();

    // Test 1: Empty payload should trigger simple wallet creation
    const emptyPayload = abiCoder.encode([], []);
    const emptyPayloadHash = keccak256(toBytes(emptyPayload));

    const sourceAddress = "agoric1testuser123";

    await approveMessage({
      commandId: commandId1,
      from: sourceChain,
      sourceAddress,
      targetAddress: factory.target,
      payload: emptyPayloadHash,
      owner,
      AxelarGateway: axelarGatewayMock,
      abiCoder,
    });

    const expectedWalletAddress1 = await computeCreate2Address(
      factory.target.toString(),
      axelarGatewayMock.target.toString(),
      axelarGasServiceMock.target.toString(),
      sourceAddress,
    );

    const tx1 = await factory.execute(
      commandId1,
      sourceChain,
      sourceAddress,
      emptyPayload,
    );

    await expect(tx1)
      .to.emit(factory, "SmartWalletCreated")
      .withArgs(expectedWalletAddress1, sourceAddress, "agoric", sourceAddress);

    // Test 2: Non-empty payload should trigger createAndDeposit flow
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    const mockToken = await MockERC20Factory.deploy("Mock Token", "MOCK", 18);
    await mockToken.waitForDeployment();

    const depositAmount = ethers.parseEther("50");
    await mockToken.mint(addr1.address, depositAmount);
    await mockToken.connect(addr1).approve(permit2Mock.target, depositAmount);

    const ownerStr = "agoric1testuser456";

    const permit = {
      permitted: {
        token: await mockToken.getAddress(),
        amount: depositAmount,
      },
      nonce: 200,
      deadline: Math.floor(Date.now() / 1000) + 60 * 60,
    };

    const mockSignature = ethers.hexlify(ethers.randomBytes(65));

    const nonEmptyPayload = abiCoder.encode(
      [
        "tuple(string ownerStr, address tokenOwner, tuple(tuple(address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit, bytes signature)",
      ],
      [
        {
          ownerStr,
          tokenOwner: addr1.address,
          permit: permit,
          signature: mockSignature,
        },
      ],
    );

    const nonEmptyPayloadHash = keccak256(toBytes(nonEmptyPayload));

    await approveMessage({
      commandId: commandId2,
      from: sourceChain,
      sourceAddress: ownerStr,
      targetAddress: factory.target,
      payload: nonEmptyPayloadHash,
      owner,
      AxelarGateway: axelarGatewayMock,
      abiCoder,
    });

    const expectedWalletAddress2 = await computeCreate2Address(
      factory.target.toString(),
      axelarGatewayMock.target.toString(),
      axelarGasServiceMock.target.toString(),
      ownerStr,
    );

    // This should succeed and create wallet + deposit tokens
    const tx2 = await factory.execute(
      commandId2,
      sourceChain,
      ownerStr,
      nonEmptyPayload,
    );

    await expect(tx2)
      .to.emit(factory, "SmartWalletCreated")
      .withArgs(expectedWalletAddress2, ownerStr, "agoric", ownerStr);

    // Verify tokens were deposited
    expect(await mockToken.balanceOf(expectedWalletAddress2)).to.equal(
      depositAmount,
    );
  });
});

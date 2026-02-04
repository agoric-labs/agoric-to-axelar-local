// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import { AxelarExecutable } from '@updated-axelar-network/axelar-gmp-sdk-solidity/contracts/executable/AxelarExecutable.sol';
import { Ownable } from '@openzeppelin/contracts/access/Ownable.sol';
import { IRemoteAccountFactory } from './interfaces/IRemoteAccountFactory.sol';
import { IRemoteAccount, ContractCall } from './interfaces/IRemoteAccount.sol';
import { IRemoteAccountRouter, IPermit2, DepositPermit, RemoteAccountInstruction, UpdateOwnerInstruction, ProvideForRouterInstruction } from './interfaces/IRemoteAccountRouter.sol';

/**
 * @title RemoteAccountAxelarRouter
 * @notice The single AxelarExecutable entry point for all remote account operations
 * @dev Handles account creation, deposits, and multicalls atomically.
 *      Each RemoteAccount is owned by this router, enabling future migration
 *      by deploying a new router and transferring ownership.
 *
 *      Migration to a new router can be done via multicall:
 *      Agoric sends a message with multiCalls containing:
 *        target: remoteAccountAddress
 *        data: abi.encodeCall(Ownable.transferOwnership, (newRouterAddress))
 *      This makes RemoteAccount call itself to transfer ownership to the new router.
 */
contract RemoteAccountAxelarRouter is AxelarExecutable, IRemoteAccountRouter {
    IRemoteAccountFactory public immutable override factory;
    IPermit2 public immutable override permit2;

    string private axelarSourceChain;
    bytes32 private immutable axelarSourceChainHash;

    address private immutable ownerAuthority;
    address public replacementOwner;

    error InvalidSourceChain(string expected, string actual);
    error InvalidSourceAddress(string expected, string actual);
    error InvalidRemoteAccount(address account);

    error UnauthorizedAuthority(address expected, address actual);

    event Received(address indexed sender, uint256 amount);

    /**
     * @param axelarGateway The Axelar gateway address
     * @param axelarSourceChain_ The source chain name
     * @param factory_ The RemoteAccountFactory address
     * @param permit2_ The Permit2 contract address
     * @param ownerAuthority_ The address authorized to designate a new owner
     */
    constructor(
        address axelarGateway,
        string memory axelarSourceChain_,
        address factory_,
        address permit2_,
        address ownerAuthority_
    ) AxelarExecutable(axelarGateway) {
        factory = IRemoteAccountFactory(factory_);
        permit2 = IPermit2(permit2_);

        ownerAuthority = ownerAuthority_;

        axelarSourceChain = axelarSourceChain_;
        axelarSourceChainHash = keccak256(bytes(axelarSourceChain_));
    }

    /**
     * @notice Internal handler for Axelar GMP messages
     * @dev Validates source chain and address, then processes the payload
     * @param sourceChain The source chain (must be "agoric")
     * @param sourceAddress The source address (must be agoricLCA)
     * @param payload The encoded RouterPayload
     */
    function _execute(
        bytes32 /*commandId*/,
        string calldata sourceChain,
        string calldata sourceAddress,
        bytes calldata payload
    ) internal override {
        if (keccak256(bytes(sourceChain)) != axelarSourceChainHash) {
            revert InvalidSourceChain(axelarSourceChain, sourceChain);
        }

        string memory txId;
        address expectedAddress;

        bytes4 selector = bytes4(payload[:4]);
        bytes calldata encodedArgs = payload[4:];

        bytes memory rewrittenPayload;

        // Parse and validate structure of message
        if (selector == IRemoteAccountRouter.processRemoteAccountInstruction.selector) {
            RemoteAccountInstruction memory instruction;
            (txId, expectedAddress, instruction) = abi.decode(
                encodedArgs,
                (string, address, RemoteAccountInstruction)
            );
            rewrittenPayload = abi.encodeCall(
                IRemoteAccountRouter.processRemoteAccountInstruction,
                (sourceAddress, expectedAddress, instruction)
            );
        } else if (selector == IRemoteAccountRouter.processUpdateOwnerInstruction.selector) {
            UpdateOwnerInstruction memory instruction;
            (txId, expectedAddress, instruction) = abi.decode(
                encodedArgs,
                (string, address, UpdateOwnerInstruction)
            );
            rewrittenPayload = abi.encodeCall(
                IRemoteAccountRouter.processUpdateOwnerInstruction,
                (sourceAddress, expectedAddress, instruction)
            );
        } else if (selector == IRemoteAccountRouter.processProvideForRouterInstruction.selector) {
            ProvideForRouterInstruction memory instruction;
            (txId, expectedAddress, instruction) = abi.decode(
                encodedArgs,
                (string, address, ProvideForRouterInstruction)
            );
            rewrittenPayload = abi.encodeCall(
                IRemoteAccountRouter.processProvideForRouterInstruction,
                (sourceAddress, expectedAddress, instruction)
            );
        } else {
            revert InvalidPayload(selector);
        }

        (bool success, bytes memory result) = address(this).call(rewrittenPayload);
        emit OperationResult(txId, sourceAddress, expectedAddress, success, result);
    }

    /**
     * @notice Process the remote account instruction in order: deposit -> provide -> multicall
     * @dev This is an external function which can only be called by this contract
     * Used to create a call stack that can be reverted atomically
     * @param sourceAddress The principal account address of the remote account
     * @param expectedAccountAddress The expected account address corresponding to the source address
     * @param instruction The decoded RemoteAccountInstruction
     */
    function processRemoteAccountInstruction(
        string calldata sourceAddress,
        address expectedAccountAddress,
        RemoteAccountInstruction calldata instruction
    ) external override {
        require(msg.sender == address(this));

        bool hasDeposit = instruction.depositPermit.length > 0;
        bool hasMultiCalls = instruction.multiCalls.length > 0;

        // Transfer first to avoid expensive creation if deposit fails
        if (hasDeposit) {
            // Verify that the instruction is well formed
            require(instruction.depositPermit.length == 1);
            DepositPermit calldata deposit = instruction.depositPermit[0];

            // Use structured call (not generic encoded payload) to ensure transfer
            // destination matches the verified accountAddress from the instruction.
            IPermit2.SignatureTransferDetails memory details = IPermit2.SignatureTransferDetails({
                // We will check address matches expectations after transfer
                to: expectedAccountAddress,
                requestedAmount: deposit.permit.permitted.amount
            });
            permit2.permitWitnessTransferFrom(
                deposit.permit,
                details,
                deposit.tokenOwner,
                deposit.witness,
                deposit.witnessTypeString,
                deposit.signature
            );
        }

        // Provide or verify the remote account matches the source principal and owner
        factory.provide(sourceAddress, address(this), expectedAccountAddress);

        if (hasMultiCalls) {
            IRemoteAccount(expectedAccountAddress).executeCalls(instruction.multiCalls);
        }
    }

    /**
     * @notice Process the update owner instruction
     * @dev This is an external function which can only be called by this contract
     * Used to create a call stack that can be reverted atomically
     * @param sourceAddress The principal account address of the owned contract
     * @param expectedAccountAddress The expected contract address corresponding to the principal address
     * @param instruction The decoded UpdateOwnerInstruction
     */
    function processUpdateOwnerInstruction(
        string calldata sourceAddress,
        address expectedAccountAddress,
        UpdateOwnerInstruction calldata instruction
    ) external override {
        require(msg.sender == address(this));

        address newOwner = instruction.newOwner;

        if (newOwner != replacementOwner) {
            revert Ownable.OwnableInvalidOwner(newOwner);
        }

        // Provide or verify the remote account matches the source principal and owner
        factory.provide(sourceAddress, address(this), expectedAccountAddress);

        Ownable(expectedAccountAddress).transferOwnership(newOwner);
    }

    /**
     * @notice Process the arbitrary creation of a remote account
     * @dev This is an external function which can only be called by this contract
     *      Used to create a call stack that can be reverted atomically
     *      Only the factory's principal can invoke this operation
     * @param sourceAddress The principal account address of the factory
     * @param factoryAddress The address of the factory
     * @param instruction The decoded RemoteAccountInstruction
     */
    function processProvideForRouterInstruction(
        string calldata sourceAddress,
        address factoryAddress,
        ProvideForRouterInstruction calldata instruction
    ) external override {
        require(msg.sender == address(this));

        // Check the factory's principal is the source
        require(factoryAddress == address(factory));
        require(factory.getRemoteAccountAddress(sourceAddress) == factoryAddress);

        // NOTE: this allows the factory's principal to create a remote account for any principal account,
        // without proof that it holds the principal account

        factory.provideForRouter(
            instruction.principalAccount,
            instruction.router,
            instruction.expectedAccountAddress
        );
    }

    function replaceOwner(address newOwner) external {
        if (msg.sender != ownerAuthority) {
            revert UnauthorizedAuthority(ownerAuthority, msg.sender);
        }
        replacementOwner = newOwner;
    }

    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    fallback() external payable {
        emit Received(msg.sender, msg.value);
    }
}

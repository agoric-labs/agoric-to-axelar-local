// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import { AxelarExecutable } from '@updated-axelar-network/axelar-gmp-sdk-solidity/contracts/executable/AxelarExecutable.sol';
import { IRemoteAccountFactory } from './interfaces/IRemoteAccountFactory.sol';
import { IReplaceableOwner } from './interfaces/IReplaceableOwner.sol';
import { IRemoteAccount, ContractCall } from './interfaces/IRemoteAccount.sol';
import { IRemoteAccountRouter, IPermit2, DepositPermit, RouterInstruction } from './interfaces/IRemoteAccountRouter.sol';

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
    IReplaceableOwner private replacementOwner_;

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

        // Parse and validate structure of message
        RouterInstruction memory instruction = abi.decode(payload, (RouterInstruction));

        try this.processInstruction(sourceAddress, instruction) {
            emit OperationResult(instruction.id, true, '');
        } catch (bytes memory reason) {
            emit OperationResult(instruction.id, false, reason);
        }
    }

    /**
     * @notice Process the router instruction in order: deposit -> provide -> multicall
     * @dev This is an external function which can only be called by this contract
     * Used to create a call stack that can be reverted atomically
     * @param instruction The decoded RouterInstruction
     */
    function processInstruction(
        string calldata sourceAddress,
        RouterInstruction calldata instruction
    ) external {
        require(msg.sender == address(this));

        address expectedAccountAddress = instruction.expectedAccountAddress;

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

    function replacementOwner() external view override returns (IReplaceableOwner) {
        return replacementOwner_;
    }

    function replaceOwner(address newOwner) external {
        if (msg.sender != ownerAuthority) {
            revert UnauthorizedAuthority(ownerAuthority, msg.sender);
        }
        replacementOwner_ = IReplaceableOwner(newOwner);
    }

    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    fallback() external payable {
        emit Received(msg.sender, msg.value);
    }
}

// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import { AxelarExecutable } from '@updated-axelar-network/axelar-gmp-sdk-solidity/contracts/executable/AxelarExecutable.sol';
import { Ownable } from '@openzeppelin/contracts/access/Ownable.sol';
import { IRemoteAccountFactory } from './interfaces/IRemoteAccountFactory.sol';
import { IRemoteAccount, ContractCall } from './interfaces/IRemoteAccount.sol';
import { ImmutableOwnable } from './ImmutableOwnable.sol';
import { IRemoteAccountRouter, IPermit2, DepositPermit, DepositInstruction, RemoteAccountInstruction, UpdateOwnerInstruction } from './interfaces/IRemoteAccountRouter.sol';

/**
 * @title RemoteAccountAxelarRouter
 * @notice The single AxelarExecutable entry point for all remote account operations
 * @dev Handles account creation, deposits, and multicalls atomically.
 *      Each RemoteAccount and the factory is owned by this router, enabling future migration
 *      by deploying a new router and transferring ownership.
 *
 *      Migration to a new router is done in 2 steps:
 *      - owner of the current router designates a successor
 *      - each principal of contracts owned by this router (RemoteAccount and Factory)
 *        sends an UpdateOwner instruction to the current router asking to update their
 *        owner to that recorded successor.
 *      We use an immutable owner for the router, changing owner requires designating a
 *      successor router with a different owner. This way a leak of owner credentials
 *      does not grant exclusive access to the router's successor mechanism, maintaining
 *      the possibility to transition owned contracts to a rightful successor.
 */
contract RemoteAccountAxelarRouter is AxelarExecutable, ImmutableOwnable, IRemoteAccountRouter {
    IRemoteAccountFactory public immutable override factory;
    IPermit2 public immutable override permit2;

    string private axelarSourceChain;
    bytes32 private immutable axelarSourceChainHash;

    address public successor;

    error InvalidSourceChain(string expected, string actual);
    error InvalidPayload(bytes4 selector);

    event Received(address indexed sender, uint256 amount);

    error UnauthorizedCaller(string source);

    /**
     * @param axelarGateway The Axelar gateway address
     * @param axelarSourceChain_ The source chain name
     * @param factory_ The RemoteAccountFactory address
     * @param permit2_ The Permit2 contract address
     * @param owner The address authorized to designate a successor
     */
    constructor(
        address axelarGateway,
        string memory axelarSourceChain_,
        address factory_,
        address permit2_,
        address owner
    ) AxelarExecutable(axelarGateway) ImmutableOwnable(owner) {
        factory = IRemoteAccountFactory(factory_);
        permit2 = IPermit2(permit2_);

        axelarSourceChain = axelarSourceChain_;
        axelarSourceChainHash = keccak256(bytes(axelarSourceChain_));
    }

    /**
     * @notice Internal handler for Axelar GMP messages
     * @dev Validates source chain, then decodes the payload and processes it
     *      The source address is validated against the payload data by each processor.
     * @param sourceChain The source chain (must match configured axelarSourceChain)
     * @param sourceAddress The source address
     * @param payload The router instruction encoded as a call selector with a signature in the
     *                form of (string txId, address expectedAccountAddress, Instruction instruction)
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

        // Parse and validate the payload as a 4-byte ABI function selector (see
        // https://docs.soliditylang.org/en/latest/abi-spec.html#function-selector
        // ) for a function of this contract, followed by relevant data that has
        // the same typing as arguments to that function but contains a source
        // chain transaction id in place of `sourceAddress` (which is
        // communicated to this function as a separate argument), and translate
        // the result into an actual encoded function call.
        // Using such a function-call payload encoding potentially allows
        // explorers to show more details about it, and simplifies the implementation
        // of the sender, which can rely on the contract ABI.
        // Note that the second argument of all functions is `expectedAddress`,
        // relevant to RemoteAccountFactory and included in the emitted
        // OperationResult event.
        // The transaction id is included in the OperationResult event, allowing a
        // resolver to observe/trace transactions.
        string memory txId;
        address expectedAddress;

        bytes4 selector = bytes4(payload[:4]);
        bytes calldata encodedArgs = payload[4:];

        bytes memory rewrittenPayload;

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
        } else if (selector == IRemoteAccountRouter.processDepositInstruction.selector) {
            DepositInstruction memory instruction;
            (txId, expectedAddress, instruction) = abi.decode(
                encodedArgs,
                (string, address, DepositInstruction)
            );
            rewrittenPayload = abi.encodeCall(
                IRemoteAccountRouter.processDepositInstruction,
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
        } else {
            revert InvalidPayload(selector);
        }

        // Call the function and emit an event describing the result.
        (bool success, bytes memory result) = address(this).call(rewrittenPayload);
        // Note that this is a transport-level event applicable to any input.
        emit OperationResult(txId, sourceAddress, expectedAddress, success, result);
    }

    /**
     * @notice Process a deposit instruction, making sure the target account is provisioned
     * @dev This is an external function which can only be called by this contract
     *      Used to create a call stack that can be reverted atomically
     *      Only the factory's principal can invoke this operation to ensure only the
     *      controller can redeem signed permits.
     *      The depositPermit in the instruction is optional to allow the controller to
     *      use the factory's public provide mechanism.
     * @param sourceAddress Must be the principal account address of the factory
     * @param factoryAddress The address of the factory
     * @param instruction The decoded DepositInstruction
     */
    function processDepositInstruction(
        string calldata sourceAddress,
        address factoryAddress,
        DepositInstruction calldata instruction
    ) external override {
        require(msg.sender == address(this));

        // Check the factory's principal is the source
        if (factoryAddress != address(factory)) {
            revert UnauthorizedCaller(sourceAddress);
        }
        factory.verifyFactoryPrincipalAccount(sourceAddress);

        require(instruction.expectedAccountAddress != factoryAddress);

        // NOTE: this allows the factory's principal to provision and deposit
        // into any remote account without proof that it holds the corresponding
        // principal account. Unfortunately there are no built-in capabilities
        // over GMP, and implementing one would require some stateful mechanism.

        // Transfer first to avoid expensive creation if deposit fails (e.g. insufficient funds,
        // expired permit).
        // The subsequent provide call will revert this deposit if the expectedAccountAddress
        // does not derive from the designated principal account.
        if (instruction.depositPermit.length > 0) {
            // Verify that the instruction is well formed
            require(instruction.depositPermit.length == 1);
            DepositPermit calldata deposit = instruction.depositPermit[0];

            // Use structured call (not generic encoded payload) to ensure transfer
            // destination matches the verified accountAddress from the instruction.
            IPermit2.SignatureTransferDetails memory details = IPermit2.SignatureTransferDetails({
                // We will check address matches expectations after transfer
                to: instruction.expectedAccountAddress,
                requestedAmount: deposit.permit.permitted.amount
            });
            permit2.permitWitnessTransferFrom(
                deposit.permit,
                details,
                deposit.owner,
                deposit.witness,
                deposit.witnessTypeString,
                deposit.signature
            );
        }

        factory.provide(
            instruction.principalAccount,
            address(this),
            instruction.expectedAccountAddress
        );
    }

    /**
     * @notice Process the remote account instruction provide -> multicall
     * @dev This is an external function which can only be called by this contract
     *      Used to create a call stack that can be reverted atomically
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

        // Provide or verify the remote account matches the source principal and its owner is this router
        factory.provide(sourceAddress, address(this), expectedAccountAddress);

        if (instruction.multiCalls.length > 0) {
            IRemoteAccount(expectedAccountAddress).executeCalls(instruction.multiCalls);
        }
    }

    /**
     * @notice Process the update owner instruction
     * @dev This is an external function which can only be called by this contract
     *      Used to create a call stack that can be reverted atomically
     *      The owned contract can be a RemoteAccount or the factory
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

        if (newOwner != successor) {
            revert Ownable.OwnableInvalidOwner(newOwner);
        }

        if (newOwner == address(0)) {
            revert Ownable.OwnableInvalidOwner(address(0));
        }

        if (expectedAccountAddress == address(factory)) {
            // Verify the factory's principal matches the expected source address
            // No need to check the factory's current owner as the transfer will fail if we're not the owner
            factory.verifyFactoryPrincipalAccount(sourceAddress);
        } else {
            // Provide or verify the remote account matches the source principal and owner
            // The factory does an owner check as part of this, even though transfer would also check it.
            factory.provide(sourceAddress, address(this), expectedAccountAddress);
        }

        Ownable(expectedAccountAddress).transferOwnership(newOwner);
    }

    function setSuccessor(address newSuccessor) external onlyOwner {
        successor = newSuccessor;
    }

    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    fallback() external payable {
        emit Received(msg.sender, msg.value);
    }
}

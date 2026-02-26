// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import { AxelarExecutable } from '@updated-axelar-network/axelar-gmp-sdk-solidity/contracts/executable/AxelarExecutable.sol';
import { Ownable } from '@openzeppelin/contracts/access/Ownable.sol';
import { IRemoteAccountFactory } from './interfaces/IRemoteAccountFactory.sol';
import { IRemoteAccount, ContractCall } from './interfaces/IRemoteAccount.sol';
import { ImmutableOwnable } from './ImmutableOwnable.sol';
import { IRemoteAccountRouter, IPermit2, DepositPermit, ProvideRemoteAccountInstruction, RemoteAccountExecuteInstruction, UpdateOwnerInstruction } from './interfaces/IRemoteAccountRouter.sol';

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
     * @notice Patch the first string slot in an ABI-encoded payload with a source string from calldata
     * @dev This is a low-level function that uses inline assembly to directly
     * manipulate the target payload in memory. It assumes the payload is an
     * ABI-encoded function call where the first argument is a string, and it
     * replaces that argument with the provided source string from calldata.
     * The function also includes safety checks to ensure the payload is
     * well-formed and that the length of the source string matches the length
     * of the existing string in the payload.
     * @param targetPayload The ABI-encoded function call payload in memory,
     *        which will be modified in place.
     * @param sourceString The source string as calldata bytes.
     */
    function patchFirstString(
        bytes memory targetPayload,
        bytes calldata sourceString
    ) internal pure {
        assembly {
            // 1. Minimum Payload Check: 4 (selector) + 32 (offset) = 36 bytes (0x24)
            let payloadTotalLen := mload(targetPayload)
            if lt(payloadTotalLen, 0x24) {
                revert(0, 0)
            }

            // 2. Get the pointer to the start of the ABI arguments (after the 4-byte selector)
            let argsBase := add(targetPayload, 0x24)

            // 3. Read the offset for the first argument (stored at the first 32-byte slot)
            let stringOffset := mload(argsBase)

            // 4. Calculate the absolute memory position of the string's length word
            // Base + Offset (Relative to Base)
            let lengthWordPos := add(argsBase, stringOffset)

            // 5. Safety: Ensure lengthWordPos is still within the targetPayload bounds
            if gt(add(stringOffset, 0x20), payloadTotalLen) {
                revert(0, 0)
            }

            // 6. Read existing length and verify it matches the source exactly
            let existingLen := mload(lengthWordPos)
            if iszero(eq(existingLen, sourceString.length)) {
                revert(0, 0)
            }

            // 7. Perform the Overwrite
            // The data starts exactly 32 bytes (0x20) after the length word
            let dataStartPos := add(lengthWordPos, 0x20)

            calldatacopy(dataStartPos, sourceString.offset, sourceString.length)
        }
    }

    /**
     * @notice Validate that the provided selector is a known process instruction selector
     * @dev Reverts if the selector does not match any of the supported instruction selectors.
     *      The checks are arranged in decreasing order of expected frequency.
     * @param selector The instruction selector to validate
     */
    function checkInstructionSelector(bytes4 selector) internal pure {
        if (
            selector != RemoteAccountAxelarRouter.processRemoteAccountExecuteInstruction.selector &&
            selector != RemoteAccountAxelarRouter.processProvideRemoteAccountInstruction.selector &&
            selector != RemoteAccountAxelarRouter.processUpdateOwnerInstruction.selector
        ) {
            revert InvalidInstructionSelector(selector);
        }
    }

    /**
     * @notice Calls the instruction processor function after patching the source address inside the encoded call data
     * @dev The call will fail if the encoded call is not well formed (e.g.
     *      invalid instruction selector or first argument is not a string /
     *      bytes of the same length as the source address).
     *      The function returns the success status and result of the call,
     *      and reverts if an out of gas situation is detected.
     * @param encodedCall The encoded call data to process
     * @param sourceAddress The source address to patch into the encoded call data
     */
    function processInstruction(
        bytes calldata encodedCall,
        string calldata sourceAddress
    ) internal returns (bool success, bytes memory result) {
        bytes memory rewrittenCall = encodedCall;
        patchFirstString(rewrittenCall, bytes(sourceAddress));

        uint256 gasBefore = gasleft();
        (success, result) = address(this).call(rewrittenCall);
        uint256 gasAfter = gasleft();

        if (!success && result.length == 0 && gasAfter <= (gasBefore / 64)) {
            // The call likely ran out of gas.
            revert SubcallOutOfGas();
        }
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

        // Parse the payload as an ABI-encoded function call (see
        // https://docs.soliditylang.org/en/latest/abi-spec.html) whose arguments
        // start with a string (the transaction id) followed by an address (the
        // expected account address). The first argument is then replaced with
        // the source address provided to this function (after checking the
        // length matches) and the resulting payload is used to dynamically call
        // the process function in this contract.
        // Using such a function-call payload encoding potentially allows
        // explorers to show more details about it, and simplifies the
        // implementation of both the sender, which can rely on the contract ABI,
        // and this receiver, which can avoid fully decoding the payload.
        // The recommendation is to pad the transaction id argument with 0-bytes
        // to match the length of the address and minimize gas costs.
        // The transaction id is included in the OperationResult event, allowing a
        // resolver to observe/trace transactions.
        // Note that the second argument of all functions is `expectedAddress`,
        // relevant to RemoteAccountFactory and also included in the emitted
        // OperationResult event.

        bytes4 selector = bytes4(payload[:4]);
        bytes calldata encodedArgs = payload[4:];

        // Validate the selector before decoding and dispatching to a non existent processor function.
        checkInstructionSelector(selector);

        // Decode the common part of the arguments in the encoded call data.
        // This also serves as a validation that the payload is well formed.
        (string memory txId, address expectedAddress) = abi.decode(encodedArgs, (string, address));

        // Call the process function then emit an event describing the result.
        // This reverts if an out of gas situation is detected so relayers can resubmit with more gas.
        (bool success, bytes memory result) = processInstruction(payload, sourceAddress);

        // Note that this is a transport-level event applicable to any instruction.
        emit OperationResult(
            txId,
            sourceAddress,
            sourceAddress,
            expectedAddress,
            selector,
            success,
            result
        );
    }

    /**
     * @notice Process a provision instruction, optionally processing a deposit permit
     * @dev This is an external function which can only be called by this contract
     *      Used to create a call stack that can be reverted atomically
     *      Only the factory's principal can invoke this operation to ensure only the
     *      controller can redeem signed permits.
     *      The depositPermit in the instruction is optional to allow the controller to
     *      use the factory's public provide mechanism without fund transfer.
     * @param sourceAddress Must be the principal account address of the factory
     * @param factoryAddress The address of the factory
     * @param instruction The decoded ProvideRemoteAccountInstruction
     */
    function processProvideRemoteAccountInstruction(
        string calldata sourceAddress,
        address factoryAddress,
        ProvideRemoteAccountInstruction calldata instruction
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
        // does not match the address derived from the designated principal account.
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
     * @param instruction The decoded RemoteAccountExecuteInstruction
     */
    function processRemoteAccountExecuteInstruction(
        string calldata sourceAddress,
        address expectedAccountAddress,
        RemoteAccountExecuteInstruction calldata instruction
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
}

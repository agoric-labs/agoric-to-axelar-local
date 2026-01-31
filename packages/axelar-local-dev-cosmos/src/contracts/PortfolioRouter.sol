// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import { AxelarExecutable } from '@updated-axelar-network/axelar-gmp-sdk-solidity/contracts/executable/AxelarExecutable.sol';
import { IRemoteAccountFactory } from './interfaces/IRemoteAccountFactory.sol';
import { IRemoteRepresentative } from './interfaces/IRemoteRepresentative.sol';
import { IReplaceableOwner } from './interfaces/IReplaceableOwner.sol';
import { IRemoteAccount, ContractCall } from './interfaces/IRemoteAccount.sol';
import { IPortfolioRouter, IPermit2, DepositPermit, RouterInstruction } from './interfaces/IPortfolioRouter.sol';
import { RemoteRepresentative } from './RemoteRepresentative.sol';

/**
 * @title PortfolioRouter
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
contract PortfolioRouter is AxelarExecutable, RemoteRepresentative, IPortfolioRouter {
    IRemoteAccountFactory public immutable override factory;
    IPermit2 public immutable override permit2;

    string private axelarSourceChain;
    bytes32 private immutable axelarSourceChainHash;

    bytes32 private immutable portfolioContractAddressHash;

    address private immutable ownerAuthority;
    IReplaceableOwner private replacementOwner_;

    error InvalidSourceChain(string expected, string actual);
    error InvalidSourceAddress(string expected, string actual);

    error UnauthorizedAuthority(address expected, address actual);

    event Received(address indexed sender, uint256 amount);

    /**
     * @param axelarGateway The Axelar gateway address
     * @param axelarSourceChain_ The source chain name
     * @param portfolioContractCaip2 The CAIP-2 of the portfolio contract
     * @param portfolioContractAccount The account of the portfolio contract
     * @param factory_ The RemoteAccountFactory address
     * @param permit2_ The Permit2 contract address
     * @param ownerAuthority_ The address authorized to replace the owner
     */
    constructor(
        address axelarGateway,
        string memory axelarSourceChain_,
        string memory portfolioContractCaip2,
        string memory portfolioContractAccount,
        address factory_,
        address permit2_,
        address ownerAuthority_
    )
        AxelarExecutable(axelarGateway)
        RemoteRepresentative(portfolioContractCaip2, portfolioContractAccount)
    {
        factory = IRemoteAccountFactory(factory_);
        permit2 = IPermit2(permit2_);

        ownerAuthority = ownerAuthority_;

        axelarSourceChain = axelarSourceChain_;
        axelarSourceChainHash = keccak256(bytes(axelarSourceChain_));

        portfolioContractAddressHash = keccak256(bytes(portfolioContractAccount));

        require(
            IRemoteRepresentative(factory_).isPrincipal(
                portfolioContractCaip2,
                portfolioContractAccount
            )
        );
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

        if (keccak256(bytes(sourceAddress)) != portfolioContractAddressHash) {
            (, string memory portfolioContractAddress) = principal();
            revert InvalidSourceAddress(portfolioContractAddress, sourceAddress);
        }

        // Parse and validate structure of message
        RouterInstruction[] memory instructions = abi.decode(payload, (RouterInstruction[]));

        uint256 len = instructions.length;
        for (uint256 i = 0; i < len; i++) {
            try this.processInstruction(instructions[i]) {
                emit OperationSuccess(instructions[i].id);
            } catch (bytes memory reason) {
                emit OperationError(instructions[i].id, reason);
            }
        }
    }

    /**
     * @notice Process the router instruction in order: deposit -> provide -> multicall
     * @dev This is an external function which can only be called by this contract
     * Used to create a call stack that can be reverted atomically
     * @param instruction The decoded RouterInstruction
     */
    function processInstruction(RouterInstruction calldata instruction) external {
        require(msg.sender == address(this));

        address accountAddress = instruction.remoteAccountAddress;

        if (instruction.depositPermit.length > 0) {
            // Verify that the instruction is well formed
            require(instruction.depositPermit.length == 1);
            DepositPermit calldata deposit = instruction.depositPermit[0];

            IPermit2.SignatureTransferDetails memory details = IPermit2.SignatureTransferDetails({
                to: accountAddress,
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

        (string memory portfolioCaip2, ) = principal();
        string calldata portfolioAccount = instruction.portfolioLCA;

        if (instruction.provideAccount) {
            factory.provide(portfolioCaip2, portfolioAccount, address(this), accountAddress);
        }

        if (instruction.multiCalls.length > 0) {
            IRemoteAccount(accountAddress).executeCalls(
                portfolioCaip2,
                portfolioAccount,
                instruction.multiCalls
            );
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

// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import { AxelarExecutable } from '@updated-axelar-network/axelar-gmp-sdk-solidity/contracts/executable/AxelarExecutable.sol';
import { IRemoteAccountFactory } from './interfaces/IRemoteAccountFactory.sol';
import { IRemoteAccount, ContractCall } from './interfaces/IRemoteAccount.sol';
import { IPortfolioRouter, IPermit2, DepositPermit, RouterPayload } from './interfaces/IPortfolioRouter.sol';

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
contract PortfolioRouter is AxelarExecutable, IPortfolioRouter {
    string private _agoricLCA; // immutable
    bytes32 private immutable _agoricLCAHash;
    IRemoteAccountFactory public immutable override factory;
    IPermit2 public immutable override permit2;

    string private constant EXPECTED_SOURCE_CHAIN = 'agoric';
    bytes32 private constant EXPECTED_SOURCE_CHAIN_HASH = keccak256(bytes(EXPECTED_SOURCE_CHAIN));

    event Received(address indexed sender, uint256 amount);

    /**
     * @param gateway_ The Axelar gateway address
     * @param factory_ The RemoteAccountFactory address
     * @param permit2_ The Permit2 contract address
     * @param agoricLCA_ The authorized Agoric LCA (source address)
     */
    constructor(
        address gateway_,
        address factory_,
        address permit2_,
        string memory agoricLCA_
    ) AxelarExecutable(gateway_) {
        factory = IRemoteAccountFactory(factory_);
        permit2 = IPermit2(permit2_);
        _agoricLCA = agoricLCA_;
        _agoricLCAHash = keccak256(bytes(_agoricLCA));
    }

    /**
     * @notice Returns the authorized Agoric LCA
     */
    function agoricLCA() external view override returns (string memory) {
        return _agoricLCA;
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
        if (keccak256(bytes(sourceChain)) != EXPECTED_SOURCE_CHAIN_HASH) {
            revert InvalidSourceChain(EXPECTED_SOURCE_CHAIN, sourceChain);
        }

        if (keccak256(bytes(sourceAddress)) != _agoricLCAHash) {
            revert InvalidSourceAddress(_agoricLCA, sourceAddress);
        }

        // Parse and validate structure of message
        RouterPayload memory p = abi.decode(payload, (RouterPayload));
        if (p.depositPermit.length > 0) {
            require(p.depositPermit.length == 1);
        }

        try this.processPayload(p) {
            // success
        } catch (bytes memory reason) {
            emit OperationError('process', reason);
        }
    }

    /**
     * @notice Process the router payload in order: deposit -> provide -> multicall
     * @dev This is an external function which can only be called by this contract
     * Used to create a call stack that can be reverted atomically
     * @param p The decoded RouterPayload
     */
    function processPayload(RouterPayload calldata p) external {
        require(msg.sender == address(this));

        address accountAddress = p.remoteAccountAddress;

        if (p.depositPermit.length > 0) {
            _executeDeposit(p.id, accountAddress, p.depositPermit[0]);
        }

        if (p.provideAccount) {
            _provideAccount(p.id, p.portfolioLCA, accountAddress);
        }

        if (p.multiCalls.length > 0) {
            _executeMulticall(p.id, p.portfolioLCA, accountAddress, p.multiCalls);
        }
    }

    /**
     * @notice Execute a Permit2 deposit to the remote account
     * @param id The unique identifier for this operation
     * @param accountAddress The destination RemoteAccount
     * @param deposit The deposit permit data
     */
    function _executeDeposit(
        string memory id,
        address accountAddress,
        DepositPermit memory deposit
    ) internal {
        IPermit2.SignatureTransferDetails memory details = IPermit2.SignatureTransferDetails({
            to: accountAddress,
            requestedAmount: deposit.permit.permitted.amount
        });

        try
            permit2.permitWitnessTransferFrom(
                deposit.permit,
                details,
                deposit.tokenOwner,
                deposit.witness,
                deposit.witnessTypeString,
                deposit.signature
            )
        {
            emit DepositStatus(id, true, '');
        } catch (bytes memory reason) {
            emit DepositStatus(id, false, reason);
        }
    }

    function _provideAccount(
        string memory id,
        string memory portfolioLCA,
        address accountAddress
    ) internal {
        try factory.provide(portfolioLCA, accountAddress, address(this)) returns (bool created) {
            emit RemoteAccountStatus(id, true, created, accountAddress, portfolioLCA, '');
        } catch (bytes memory reason) {
            emit RemoteAccountStatus(id, false, false, accountAddress, portfolioLCA, reason);
        }
    }

    /**
     * @notice Execute multicall on the remote account
     * @param id The unique identifier for this batch of calls
     * @param portfolioLCA The controller string for authorization
     * @param accountAddress The RemoteAccount to execute calls on
     * @param calls The array of calls to execute
     */
    function _executeMulticall(
        string memory id,
        string memory portfolioLCA,
        address accountAddress,
        ContractCall[] memory calls
    ) internal {
        try IRemoteAccount(accountAddress).executeCalls(portfolioLCA, calls) {
            emit MulticallStatus(id, true, '');
        } catch (bytes memory reason) {
            emit MulticallStatus(id, false, reason);
        }
    }

    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    fallback() external payable {
        emit Received(msg.sender, msg.value);
    }
}

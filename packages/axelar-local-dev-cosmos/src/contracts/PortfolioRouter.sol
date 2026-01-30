// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import {AxelarExecutable} from "@updated-axelar-network/axelar-gmp-sdk-solidity/contracts/executable/AxelarExecutable.sol";
import {IRemoteAccountFactory} from "./interfaces/IRemoteAccountFactory.sol";
import {IRemoteAccount, ContractCall} from "./interfaces/IRemoteAccount.sol";
import {IPortfolioRouter, IPermit2, DepositPermit, RouterPayload} from "./interfaces/IPortfolioRouter.sol";

/**
 * @title PortfolioRouter
 * @notice The single AxelarExecutable entry point for all remote account operations
 * @dev Handles account creation, deposits, and multicalls atomically.
 *      Each RemoteAccount is owned by this router, enabling future migration
 *      by deploying a new router and transferring ownership.
 */
contract PortfolioRouter is AxelarExecutable, IPortfolioRouter {
    string private _agoricLCA;
    IRemoteAccountFactory public immutable override factory;
    IPermit2 public immutable override permit2;

    string private constant EXPECTED_SOURCE_CHAIN = "agoric";
    bytes32 private constant EXPECTED_SOURCE_CHAIN_HASH =
        keccak256(bytes(EXPECTED_SOURCE_CHAIN));

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

        if (keccak256(bytes(sourceAddress)) != keccak256(bytes(_agoricLCA))) {
            revert InvalidSourceAddress(_agoricLCA, sourceAddress);
        }

        RouterPayload memory p = abi.decode(payload, (RouterPayload));

        _processPayload(p);
    }

    /**
     * @notice Process the router payload in order: provide -> deposit -> multicall
     * @dev Uses try/catch with OperationError events for debugging
     * @param p The decoded RouterPayload
     */
    function _processPayload(RouterPayload memory p) internal {
        address accountAddress = p.remoteAccountAddress;

        if (p.provideAccount) {
            try
                factory.provide(p.portfolioLCA, accountAddress, address(this))
            returns (address provided) {
                accountAddress = provided;
                emit AccountProvided(accountAddress, p.portfolioLCA);
            } catch (bytes memory reason) {
                emit OperationError("provide", reason);
            }
        }

        if (p.depositPermit.tokenOwner != address(0)) {
            _executeDeposit(accountAddress, p.depositPermit);
        }

        if (p.multiCalls.length > 0) {
            _executeMulticall(accountAddress, p.portfolioLCA, p.multiCalls);
        }
    }

    /**
     * @notice Execute a Permit2 deposit to the remote account
     * @param accountAddress The destination RemoteAccount
     * @param deposit The deposit permit data
     */
    function _executeDeposit(
        address accountAddress,
        DepositPermit memory deposit
    ) internal {
        IPermit2.SignatureTransferDetails memory details = IPermit2
            .SignatureTransferDetails({
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
            emit DepositExecuted(
                accountAddress,
                deposit.tokenOwner,
                deposit.permit.permitted.token,
                deposit.permit.permitted.amount
            );
        } catch (bytes memory reason) {
            emit OperationError("deposit", reason);
        }
    }

    /**
     * @notice Execute multicall on the remote account
     * @param accountAddress The RemoteAccount to execute calls on
     * @param portfolioLCA The controller string for authorization
     * @param calls The array of calls to execute
     */
    function _executeMulticall(
        address accountAddress,
        string memory portfolioLCA,
        ContractCall[] memory calls
    ) internal {
        try IRemoteAccount(accountAddress).executeCalls(portfolioLCA, calls) {
            emit CallsExecuted(accountAddress, calls.length);
        } catch (bytes memory reason) {
            emit OperationError("executeCalls", reason);
        }
    }

    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    fallback() external payable {
        emit Received(msg.sender, msg.value);
    }
}

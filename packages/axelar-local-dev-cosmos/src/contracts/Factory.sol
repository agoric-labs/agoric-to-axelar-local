// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import { IRemoteAccountFactory } from './interfaces/IRemoteAccountFactory.sol';
import { RemoteAccount } from './RemoteAccount.sol';

/**
 * @title Factory (RemoteAccountFactory)
 * @notice A simplified CREATE2 factory for deploying RemoteAccount contracts
 * @dev The PortfolioRouter calls provide() to create/verify RemoteAccounts.
 */
contract Factory is IRemoteAccountFactory {
    bytes32 public immutable override remoteAccountCodeHash;

    event Received(address indexed sender, uint256 amount);

    constructor() {
        remoteAccountCodeHash = keccak256(type(RemoteAccount).creationCode);
    }

    /**
     * @notice Check if a valid RemoteAccount exists at the given address
     * @dev Verifies codehash, controller, and owner for defense in depth
     * @param accountAddress The address to check
     * @param expectedController The expected controller string
     * @param expectedOwner The expected owner address
     * @return true if valid account exists with matching controller and owner
     */
    function _isValidExistingAccount(
        address accountAddress,
        string calldata expectedController,
        address expectedOwner
    ) internal view returns (bool) {
        if (accountAddress.codehash != remoteAccountCodeHash) {
            return false;
        }

        try RemoteAccount(payable(accountAddress)).controller() returns (
            string memory existingController
        ) {
            if (keccak256(bytes(existingController)) != keccak256(bytes(expectedController))) {
                return false;
            }
        } catch {
            return false;
        }

        try RemoteAccount(payable(accountAddress)).owner() returns (address existingOwner) {
            if (existingOwner != expectedOwner) {
                return false;
            }
        } catch {
            return false;
        }

        return true;
    }

    /**
     * @notice Provide a RemoteAccount - creates if new, verifies if exists
     * @dev Idempotent: calling multiple times with same params is safe
     * @param portfolioLCA The controller string for the RemoteAccount
     * @param expectedAddress The expected CREATE2 address (for verification)
     * @param routerAddress The owner address (PortfolioRouter)
     * @return The address of the RemoteAccount (created or existing)
     */
    function provide(
        string calldata portfolioLCA,
        address expectedAddress,
        address routerAddress
    ) external override returns (bool) {
        bytes32 salt = keccak256(bytes(portfolioLCA));

        try new RemoteAccount{ salt: salt }(portfolioLCA) returns (RemoteAccount account) {
            address newAccount = address(account);
            if (newAccount != expectedAddress) {
                revert AddressMismatch(expectedAddress, newAccount);
            }
            // Immediately transfer ownership
            // not using constructor args so that address only depends on immutable controller
            // and not on transferable owner
            newAccount.transferOwnership(routerAddress);

            return true;
        } catch {
            if (_isValidExistingAccount(expectedAddress, portfolioLCA, routerAddress)) {
                return false;
            }

            revert InvalidAccountAtAddress(expectedAddress);
        }
    }

    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    fallback() external payable {
        emit Received(msg.sender, msg.value);
    }
}

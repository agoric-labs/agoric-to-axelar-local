// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import { IRemoteAccountFactory } from './interfaces/IRemoteAccountFactory.sol';
import { RemoteAccount } from './RemoteAccount.sol';

/**
 * @title RemoteAccountFactory
 * @notice A simplified CREATE2 factory for deploying RemoteAccount contracts
 * @dev The PortfolioRouter calls provide() to create/verify RemoteAccounts.
 */
contract RemoteAccountFactory is IRemoteAccountFactory {
    event Received(address indexed sender, uint256 amount);

    /**
     * @notice Check if a valid RemoteAccount exists at the given address
     * @dev Verifies code exists, controller, and owner for defense in depth
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
        if (accountAddress.code.length == 0) {
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
     * @dev Idempotent: calling multiple times with same params is safe.
     *      Salt includes routerAddress to prevent front-running attacks.
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
        // Security: routerAddress is included in salt to prevent front-running attacks.
        // Since provide() is public, without this an attacker could:
        // 1. Monitor mempool for router's provide() calls
        // 2. Front-run with their own address as owner
        // 3. Steal ownership of the RemoteAccount meant for the router
        // By including routerAddress in salt, each router gets a unique address
        // for the same portfolioLCA, making front-running ineffective.
        bytes32 salt = keccak256(abi.encodePacked(portfolioLCA, routerAddress));

        try new RemoteAccount{ salt: salt }(portfolioLCA) returns (RemoteAccount account) {
            address newAccount = address(account);
            if (newAccount != expectedAddress) {
                revert AddressMismatch(expectedAddress, newAccount);
            }
            // Immediately transfer ownership
            // not using constructor args so that address only depends on immutable controller
            // and not on transferable owner
            account.transferOwnership(routerAddress);

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

// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import {IRemoteAccountFactory} from "./interfaces/IRemoteAccountFactory.sol";
import {RemoteAccount} from "./RemoteAccount.sol";

/**
 * @title Factory (RemoteAccountFactory)
 * @notice A simplified CREATE2 factory for deploying RemoteAccount contracts
 * @dev No longer an AxelarExecutable - just a plain factory contract.
 *      The PortfolioRouter calls provide() to create/verify RemoteAccounts.
 */
contract Factory is IRemoteAccountFactory {
    bytes32 public immutable override remoteAccountCodeHash;

    event Received(address indexed sender, uint256 amount);

    constructor() {
        remoteAccountCodeHash = keccak256(type(RemoteAccount).creationCode);
    }

    /**
     * @notice Compute the CREATE2 address for a RemoteAccount
     * @param portfolioLCA The controller string (used as salt via keccak256)
     * @param routerAddress The owner address (PortfolioRouter)
     * @return The deterministic address where the RemoteAccount will be deployed
     */
    function computeAddress(
        string calldata portfolioLCA,
        address routerAddress
    ) public view override returns (address) {
        bytes32 salt = keccak256(bytes(portfolioLCA));
        bytes memory constructorArgs = abi.encode(routerAddress, portfolioLCA);
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(type(RemoteAccount).creationCode, constructorArgs)
        );
        return
            address(
                uint160(
                    uint256(
                        keccak256(
                            abi.encodePacked(
                                bytes1(0xff),
                                address(this),
                                salt,
                                initCodeHash
                            )
                        )
                    )
                )
            );
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
        if (accountAddress.code.length == 0) {
            return false;
        }

        try RemoteAccount(payable(accountAddress)).controller() returns (
            string memory existingController
        ) {
            if (
                keccak256(bytes(existingController)) !=
                keccak256(bytes(expectedController))
            ) {
                return false;
            }
        } catch {
            return false;
        }

        try RemoteAccount(payable(accountAddress)).owner() returns (
            address existingOwner
        ) {
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
    ) external override returns (address) {
        bytes32 salt = keccak256(bytes(portfolioLCA));

        try new RemoteAccount{salt: salt}(routerAddress, portfolioLCA) returns (
            RemoteAccount account
        ) {
            address newAccount = address(account);
            if (newAccount != expectedAddress) {
                revert AddressMismatch(expectedAddress, newAccount);
            }

            emit RemoteAccountProvided(
                newAccount,
                portfolioLCA,
                routerAddress,
                true
            );
            return newAccount;
        } catch {
            if (
                _isValidExistingAccount(
                    expectedAddress,
                    portfolioLCA,
                    routerAddress
                )
            ) {
                emit RemoteAccountProvided(
                    expectedAddress,
                    portfolioLCA,
                    routerAddress,
                    false
                );
                return expectedAddress;
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

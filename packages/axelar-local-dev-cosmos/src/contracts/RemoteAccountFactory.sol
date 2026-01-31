// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import { IRemoteAccountFactory } from './interfaces/IRemoteAccountFactory.sol';
import { RemoteAccount } from './RemoteAccount.sol';

/**
 * @title RemoteAccountFactory
 * @notice A CREATE2 factory for deploying RemoteAccount contracts
 * @dev The RemoteAccountFactory is a non-replaceable contract deploying
        RemoteAccount contracts at predictable addresses on behalf of a portfolio
        manager contract designated as principal. It is itself a RemoteAccount
        whose owner is the current PortfolioRouter for that principal contract.
        Besides creating RemoteAccount for the owner router, it can be invoked
        publicly to manually create RemoteAccount configured with the current
        router owner, as well as RemoteAccount for an arbitrary router through
        relayed 
        calls provide() to create/verify RemoteAccounts.
 */
contract RemoteAccountFactory is RemoteAccount, IRemoteAccountFactory {
    /**
     * @param principalCaip2 The caip2 of the principal for this RemoteAccountFactory
     * @param principalAccount The address of the principal for this RemoteAccountFactory
     */
    constructor(
        string memory principalCaip2,
        string memory principalAccount
    ) RemoteAccount(principalCaip2, principalAccount) {}

    /**
     * @notice Check if a valid RemoteAccount exists at the given address
     * @dev Verifies code exists, principal, and owner for defense in depth
     * @param accountAddress The address to check
     * @param principalCaip2 The expected CAIP2 of the principal
     * @param principalAccount The expected account of the principal
     * @param routerOwner The expected address of the current owner
     * @return true if valid account exists with matching principal and owner
     */
    function _isValidExistingAccount(
        address accountAddress,
        string calldata principalCaip2,
        string calldata principalAccount,
        address routerOwner
    ) internal view returns (bool) {
        if (accountAddress.code.length == 0) {
            return false;
        }

        // Redundant check since principal defines the address of the RemoteAccount
        try
            RemoteAccount(payable(accountAddress)).isPrincipal(principalCaip2, principalAccount)
        returns (bool isPrincipal) {
            if (!isPrincipal) {
                return false;
            }
        } catch {
            return false;
        }

        try RemoteAccount(payable(accountAddress)).owner() returns (address existingOwner) {
            if (existingOwner != routerOwner) {
                return false;
            }
        } catch {
            return false;
        }

        return true;
    }

    /**
     * @notice Provide a RemoteAccount - creates if new, verifies if exists
     * @dev Idempotent: calling multiple times with same params is safe as
     *      long as the current owner matches between the factory and remote account.
     * @param principalCaip2 The caip2 of the principal for the RemoteAccount
     * @param principalAccount The address of the principal for the RemoteAccount
     * @param expectedRouter The expected address of the router, must be current router of the factory
     * @param expectedAddress The expected CREATE2 address (for verification)
     * @return true if the RemoteAccount was created, false if it was pre-existing
     */
    function provide(
        string calldata principalCaip2,
        string calldata principalAccount,
        address expectedRouter,
        address expectedAddress
    ) external override returns (bool) {
        if (owner() != expectedRouter) {
            revert UnauthorizedRouter(expectedRouter);
        }
        return _provideForRouter(principalCaip2, principalAccount, expectedRouter, expectedAddress);
    }

    /**
     * @notice Provide a RemoteAccount - creates if new, verifies if exists
     * @dev Idempotent: calling multiple times with same params succeeds as
     *      long as the RemoteAccount's current owner matches the provided routerAddress.
     *      This allows an executeCall to create a RemoteAccount with an arbitrary
     *      router address may, allowing the portfolio manager which is the principal of
            this factory to create remote accounts for alternative routers it may use.
     * @param principalCaip2 The caip2 of the principal for the RemoteAccount
     * @param principalAccount The address of the principal for the RemoteAccount
     * @param routerAddress The address of the router to use as owner of the RemoteAccount
     * @param expectedAddress The expected CREATE2 address (for verification)
     * @return true if the RemoteAccount was created, false if it was pre-existing
     */
    function provideForRouter(
        string calldata principalCaip2,
        string calldata principalAccount,
        address routerAddress,
        address expectedAddress
    ) external returns (bool) {
        require(_msgSender() == address(this));
        return _provideForRouter(principalCaip2, principalAccount, routerAddress, expectedAddress);
    }

    /**
     * @notice Provide a RemoteAccount - creates if new, verifies if exists
     * @dev Idempotent: calling multiple times with same params succeeds as
     *      long as the RemoteAccount's current owner matches the provided routerAddress.
     *      This must not be exposed publicly without controls as an arbitrary
     *      router address may prevent the portfolio manager from reaching the
     *      RemoteAccount if it does not have access to that router.
     * @param principalCaip2 The caip2 of the principal for the RemoteAccount
     * @param principalAccount The address of the principal for the RemoteAccount
     * @param routerAddress The address of the router to use as owner of the RemoteAccount
     * @param expectedAddress The expected CREATE2 address (for verification)
     * @return true if the RemoteAccount was created, false if it was pre-existing
     */
    function _provideForRouter(
        string calldata principalCaip2,
        string calldata principalAccount,
        address routerAddress,
        address expectedAddress
    ) internal returns (bool) {
        // Do not include the router address to keep the remote account address independent
        // from the current router setup.
        bytes32 salt = keccak256(abi.encodePacked(principalCaip2, ':', principalAccount));

        try new RemoteAccount{ salt: salt }(principalCaip2, principalAccount) returns (
            RemoteAccount account
        ) {
            address newAccount = address(account);
            if (newAccount != expectedAddress) {
                revert AddressMismatch(expectedAddress, newAccount);
            }
            // Immediately transfer ownership to router
            // not using constructor args so that address only depends on immutable controller
            // and not on transferable owner
            account.transferOwnership(routerAddress);

            return true;
        } catch {
            if (
                _isValidExistingAccount(
                    expectedAddress,
                    principalCaip2,
                    principalAccount,
                    routerAddress
                )
            ) {
                return false;
            }

            revert InvalidAccountAtAddress(expectedAddress);
        }
    }

    receive() external payable override {
        emit Received(msg.sender, msg.value);
    }

    fallback() external payable override {
        emit Received(msg.sender, msg.value);
    }
}

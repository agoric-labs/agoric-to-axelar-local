// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import { IRemoteAccountFactory } from './interfaces/IRemoteAccountFactory.sol';
import { IRemoteAccount, ContractCall } from './interfaces/IRemoteAccount.sol';
import { RemoteRepresentative } from './RemoteRepresentative.sol';
import { OwnableByReplaceableOwner } from './OwnableByReplaceableOwner.sol';
import { RemoteAccount } from './RemoteAccount.sol';

/**
 * @title RemoteAccountFactory
 * @notice A CREATE2 factory for deploying RemoteAccount contracts
 * @dev The RemoteAccountFactory is a non-replaceable contract deploying
        RemoteAccount contracts at predictable addresses on behalf of a portfolio
        manager contract designated as principal. It implements IRemoteAccount
        but restricts executeCalls to only target itself, providing a controlled
        interface for the principal to invoke factory methods like provideForRouter.
        Besides creating RemoteAccount for the owner router, it can be invoked
        publicly to manually create RemoteAccount configured with the current
        router owner, as well as RemoteAccount for an arbitrary router through
        relayed calls to provideForRouter() via executeCalls.
 */
contract RemoteAccountFactory is
    RemoteRepresentative,
    OwnableByReplaceableOwner,
    IRemoteAccount,
    IRemoteAccountFactory
{
    event Received(address indexed sender, uint256 amount);

    error InvalidCallTarget(address target);

    /**
     * @param principalCaip2 The caip2 of the principal for this RemoteAccountFactory
     * @param principalAccount The address of the principal for this RemoteAccountFactory
     */
    constructor(
        string memory principalCaip2,
        string memory principalAccount
    )
        RemoteRepresentative(principalCaip2, principalAccount)
        OwnableByReplaceableOwner(_msgSender())
    {}

    /**
     * @notice Replace the owner with the specified address
     * @dev External function checking that the caller is this contract itself
     *      before invoking the replace owner behavior of OwnableByReplaceableOwner
     *      which checks that the current owner has designated the new owner as
     *      its replacement. Allows executeCalls to replace ownership, enforcing
     *      that both the principal and the owner agree.
     */
    function replaceOwner(address newOwner) external {
        // Allows the multicall to update the contract ownership
        require(_msgSender() == address(this));
        _replaceOwner(newOwner);
    }

    /**
     * @notice Execute a batch of calls on behalf of the controller
     * @dev Requires router ownership check AND principal is the source of calls (defense in depth).
     *      All call targets MUST be address(this) - the factory only allows calls to itself.
     * @param sourceCaip2 The caip2 of the source issuing the calls command
     * @param sourceAccount The account of the source issuing calls command
     * @param calls Array of contract calls to execute (all targets must be address(this))
     */
    function executeCalls(
        string calldata sourceCaip2,
        string calldata sourceAccount,
        ContractCall[] calldata calls
    ) external override onlyOwner checkPrincipal(sourceCaip2, sourceAccount) {
        uint256 len = calls.length;
        for (uint256 i = 0; i < len; ) {
            if (calls[i].target != address(this)) {
                revert InvalidCallTarget(calls[i].target);
            }

            (bool success, bytes memory reason) = calls[i].target.call(calls[i].data);

            if (!success) {
                revert ContractCallFailed(i, reason);
            }

            unchecked {
                ++i;
            }
        }
    }

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
     *      router address, allowing the portfolio manager which is the principal of
     *      this factory to create remote accounts for alternative routers it may use.
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

            emit RemoteAccountCreated(
                newAccount,
                string.concat(principalCaip2, ':', principalAccount),
                routerAddress
            );

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

    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    fallback() external payable {
        emit Received(msg.sender, msg.value);
    }
}

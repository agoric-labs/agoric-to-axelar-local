// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import { Create2 } from '@openzeppelin/contracts/utils/Create2.sol';
import { IRemoteAccountFactory } from './interfaces/IRemoteAccountFactory.sol';
import { IRemoteAccount, ContractCall } from './interfaces/IRemoteAccount.sol';
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
contract RemoteAccountFactory is OwnableByReplaceableOwner, IRemoteAccount, IRemoteAccountFactory {
    // Store the principal details of this factory purely for reference
    string public factoryPrincipalCaip2;
    string public factoryPrincipalAccount;

    bytes32 private immutable _principalSalt;
    bytes32 private immutable _remoteAccountBytecodeHash;

    event Received(address indexed sender, uint256 amount);

    error InvalidCallTarget(address target);

    /**
     * @param factoryPrincipalCaip2_ The caip2 of the principal for this RemoteAccountFactory
     * @param factoryPrincipalAccount_ The address of the principal for this RemoteAccountFactory
     */
    constructor(
        string memory factoryPrincipalCaip2_,
        string memory factoryPrincipalAccount_
    ) OwnableByReplaceableOwner(_msgSender()) {
        factoryPrincipalCaip2 = factoryPrincipalCaip2_;
        factoryPrincipalAccount = factoryPrincipalAccount_;
        _principalSalt = keccak256(bytes(factoryPrincipalAccount_)); // _getSalt(factoryPrincipalAccount_);
        _remoteAccountBytecodeHash = keccak256(type(RemoteAccount).creationCode);
    }

    function _getSalt(string calldata principalAccount) internal pure returns (bytes32) {
        return keccak256(bytes(principalAccount));
    }

    /**
     * @notice Compute the CREATE2 address for a RemoteAccount deployed by this factory
     * @param salt The salt generated from the principal for the RemoteAccount
     * @return The deterministic address where the RemoteAccount is deployed
     */
    function _getRemoteAccountAddress(bytes32 salt) internal view returns (address) {
        return Create2.computeAddress(salt, _remoteAccountBytecodeHash);
    }

    /**
     * @notice Compute the CREATE2 address for a RemoteAccount deployed by this factory
     * @param principalAccount The address of the principal for the RemoteAccount
     * @return The deterministic address where the RemoteAccount is deployed
     */
    function getRemoteAccountAddress(
        string calldata principalAccount
    ) public view override returns (address) {
        bytes32 salt = _getSalt(principalAccount);
        if (salt == _principalSalt) {
            return address(this);
        }
        return _getRemoteAccountAddress(salt);
    }

    /**
     * @notice Check if a valid RemoteAccount exists at the given address
     * @dev Verifies code exists, address derives from the principal, and owner matches
     * @param accountAddress The address to check
     * @param salt The salt generated from the principal for the RemoteAccount
     * @param routerOwner The expected address of the current owner
     * @return true if valid account exists with matching principal and owner
     */
    function _isValidExistingAccount(
        address accountAddress,
        bytes32 salt,
        address routerOwner
    ) internal view returns (bool) {
        if (_getRemoteAccountAddress(salt) != accountAddress) {
            return false;
        }

        if (accountAddress.code.length == 0) {
            return false;
        }

        if (accountAddress == address(this)) {
            if (owner() != routerOwner) {
                return false;
            }
        } else {
            // if (keccak256(type(RemoteAccount).runtimeCode) != accountAddress.codehash) {
            //     return false;
            // }

            try RemoteAccount(payable(accountAddress)).owner() returns (address existingOwner) {
                if (existingOwner != routerOwner) {
                    return false;
                }
            } catch {
                return false;
            }
        }

        return true;
    }

    /**
     * @notice Verify an address is a remote account for a given principal and router owner
     * @dev Does not check the router matches the factory's current owner to allow a non current router
     *      to interact with remote accounts whose ownership needs to be updated.
     * @param principalAccount The address of the principal for the RemoteAccount
     * @param expectedRouter The expected address of the router owner
     * @param accountAddress The address to verify
     * @return true if a valid RemoteAccount exists at the address
     */
    function verifyRemoteAccount(
        string calldata principalAccount,
        address expectedRouter,
        address accountAddress
    ) external view override returns (bool) {
        bytes32 salt = _getSalt(principalAccount);
        return _isValidExistingAccount(accountAddress, salt, expectedRouter);
    }

    /**
     * @notice Provide a RemoteAccount - creates if new, verifies if exists
     * @dev Idempotent: calling multiple times with same params is safe as
     *      long as the current owner matches between the factory and remote account.
     *
     *      The expectedRouter parameter is critical for safety:
     *      - TOCTOU: Prevents time-of-check time-of-use races where the caller checks
     *        owner() then calls provide(), but ownership changes in between. By validating
     *        expectedRouter matches current owner at execution, caller intent is preserved.
     *
     *      - Router upgrades: When upgrading from router A to B, in-flight provide() calls
     *        meant for router A will fail rather than creating accounts owned by router B.
     *
     *      - Reorgs: During blockchain reorganizations, if a router ownership transfer and
     *        provide() call get reordered, the check ensures provide() fails rather than
     *        creating accounts with unexpected ownership.
     *
     * @param expectedRouter The expected address of the router, must be current router of the factory
     * @param expectedAddress The expected CREATE2 address (for verification)
     * @return true if the RemoteAccount was created, false if it was pre-existing
     */
    function provide(
        string calldata principalAccount,
        address expectedRouter,
        address expectedAddress
    ) external override returns (bool) {
        if (owner() != expectedRouter) {
            revert UnauthorizedRouter(expectedRouter);
        }
        return _provideForRouter(principalAccount, expectedRouter, expectedAddress);
    }

    /**
     * @notice Provide a RemoteAccount - creates if new, verifies if exists
     * @dev Idempotent: calling multiple times with same params succeeds as
     *      long as the RemoteAccount's current owner matches the provided routerAddress.
     *      This allows an executeCall to create a RemoteAccount with an arbitrary
     *      router address, allowing the portfolio manager which is the principal of
     *      this factory to create remote accounts for alternative routers it may use.
     * @param principalAccount The address of the principal for the RemoteAccount
     * @param routerAddress The address of the router to use as owner of the RemoteAccount
     * @param expectedAddress The expected CREATE2 address (for verification)
     * @return true if the RemoteAccount was created, false if it was pre-existing
     */
    function provideForRouter(
        string calldata principalAccount,
        address routerAddress,
        address expectedAddress
    ) external returns (bool) {
        require(_msgSender() == address(this));
        return _provideForRouter(principalAccount, routerAddress, expectedAddress);
    }

    /**
     * @notice Provide a RemoteAccount - creates if new, verifies if exists
     * @dev Idempotent: calling multiple times with same params succeeds as
     *      long as the RemoteAccount's current owner matches the provided routerAddress.
     *      This must not be exposed publicly without controls as an arbitrary
     *      router address may prevent the portfolio manager from reaching the
     *      RemoteAccount if it does not have access to that router.
     * @param principalAccount The address of the principal for the RemoteAccount
     * @param routerAddress The address of the router to use as owner of the RemoteAccount
     * @param expectedAddress The expected CREATE2 address (for verification)
     * @return true if the RemoteAccount was created, false if it was pre-existing
     */
    function _provideForRouter(
        string calldata principalAccount,
        address routerAddress,
        address expectedAddress
    ) internal returns (bool) {
        // Do not include the router address to keep the remote account address independent
        // from the current router setup.
        bytes32 salt = _getSalt(principalAccount);

        try new RemoteAccount{ salt: salt }() returns (RemoteAccount account) {
            address newAccount = address(account);
            if (newAccount != expectedAddress) {
                revert AddressMismatch(expectedAddress, newAccount);
            }
            // Immediately transfer ownership to router
            // not using constructor args so that address only depends on immutable controller
            // and not on transferable owner
            account.transferOwnership(routerAddress);

            emit RemoteAccountCreated(newAccount, principalAccount, routerAddress);

            return true;
        } catch {
            if (_isValidExistingAccount(expectedAddress, salt, routerAddress)) {
                return false;
            }

            revert InvalidAccountAtAddress(expectedAddress);
        }
    }

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
     * @dev Requires router ownership check
     *      All call targets MUST be address(this) - the factory only allows calls to itself.
     * @param calls Array of contract calls to execute (all targets must be address(this))
     */
    function executeCalls(ContractCall[] calldata calls) external override onlyOwner {
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

    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    fallback() external payable {
        emit Received(msg.sender, msg.value);
    }
}

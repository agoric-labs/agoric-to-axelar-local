// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import { Create2 } from '@openzeppelin/contracts/utils/Create2.sol';
import { Ownable } from '@openzeppelin/contracts/access/Ownable.sol';
import { IRemoteAccountFactory } from './interfaces/IRemoteAccountFactory.sol';
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
contract RemoteAccountFactory is Ownable, IRemoteAccountFactory {
    // Store the principal details of this factory purely for reference
    string public factoryPrincipalCaip2;
    string public factoryPrincipalAccount;

    bytes32 private immutable _principalSalt;
    bytes32 private immutable _remoteAccountBytecodeHash;

    event Received(address indexed sender, uint256 amount);

    /**
     * @param factoryPrincipalCaip2_ The caip2 of the principal for this RemoteAccountFactory
     * @param factoryPrincipalAccount_ The address of the principal for this RemoteAccountFactory
     */
    constructor(
        string memory factoryPrincipalCaip2_,
        string memory factoryPrincipalAccount_
    ) Ownable(_msgSender()) {
        factoryPrincipalCaip2 = factoryPrincipalCaip2_;
        factoryPrincipalAccount = factoryPrincipalAccount_;
        _principalSalt = keccak256(bytes(factoryPrincipalAccount_)); // _getSalt(factoryPrincipalAccount_);
        _remoteAccountBytecodeHash = keccak256(type(RemoteAccount).creationCode);
    }

    /**
     * @notice Verify a principal account matches the factory's designated principal
     * @dev Only checks the account part not the caip2. The intent is to help routers
     *      disambiguate between the factory and a RemoteAccount.
     *      Reverts if the principal does not match.
     * @param expectedPrincipalAccount The expected address of the factory's principal
     */
    function verifyFactoryPrincipalAccount(
        string calldata expectedPrincipalAccount
    ) external view override {
        if (_getSalt(expectedPrincipalAccount) != _principalSalt) {
            revert PrincipalAccountMismatch(expectedPrincipalAccount, factoryPrincipalAccount);
        }
    }

    function _getSalt(string calldata principalAccount) internal pure returns (bytes32) {
        return keccak256(bytes(principalAccount));
    }

    /**
     * @notice Compute the CREATE2 address for a RemoteAccount deployed by this factory
     * @dev Return address(0) if the salt matches the factory's principal
     * @param salt The salt generated from the principal for the RemoteAccount
     * @return The deterministic address where the RemoteAccount is deployed
     */
    function _getRemoteAccountAddress(bytes32 salt) internal view returns (address) {
        if (salt == _principalSalt) {
            return address(0);
        }
        return Create2.computeAddress(salt, _remoteAccountBytecodeHash);
    }

    /**
     * @notice Compute the CREATE2 address for a RemoteAccount deployed by this factory
     * @dev Return address(0) if the principalAccount matches the factory's principal
     * @param principalAccount The address of the principal for the RemoteAccount
     * @return The deterministic address where the RemoteAccount is deployed
     */
    function getRemoteAccountAddress(
        string calldata principalAccount
    ) public view override returns (address) {
        bytes32 salt = _getSalt(principalAccount);
        return _getRemoteAccountAddress(salt);
    }

    /**
     * @notice Check if a RemoteAccount with the expected owner exists at the given address
     * @dev Assumes the caller already derived the account address from the principal account,
     *      and verified code exists for the address.
     *      Checks that the owner matches.
     *      Does not check that contract is a RemoteAccount, relies on deterministic address derivation.
     * @param accountAddress The derived remote account address to check
     * @param routerOwner The expected address of the account's current owner
     */
    function _verifyRemoteAccountOwner(address accountAddress, address routerOwner) internal view {
        if (accountAddress == address(0)) {
            revert UnauthorizedRouter(accountAddress, routerOwner);
        } else {
            try RemoteAccount(payable(accountAddress)).owner() returns (address existingOwner) {
                if (existingOwner != routerOwner) {
                    revert UnauthorizedRouter(accountAddress, routerOwner);
                }
            } catch {
                revert UnauthorizedRouter(accountAddress, routerOwner);
            }
        }
    }

    /**
     * @notice Verify an address is a remote account for a given principal and router owner
     * @dev Does not check the router matches the factory's current owner to allow a non current router
     *      to interact with remote accounts whose ownership needs to be updated.
     *      Reverts if the account address does not match the expected address derived from the principal.
     *      Reverts if there is no account at the address, or it does not have the expected owner.
     * @param principalAccount The address of the principal for the RemoteAccount
     * @param expectedRouter The expected address of the router owner
     * @param expectedAccountAddress The expected address to verify
     */
    function verifyRemoteAccount(
        string calldata principalAccount,
        address expectedRouter,
        address expectedAccountAddress
    ) public view override {
        bytes32 salt = _getSalt(principalAccount);

        address actualAccountAddress = _getRemoteAccountAddress(salt);
        if (actualAccountAddress != expectedAccountAddress) {
            revert AddressMismatch(expectedAccountAddress, actualAccountAddress);
        }

        if (actualAccountAddress.code.length == 0) {
            revert InvalidAccountAtAddress(actualAccountAddress);
        }

        _verifyRemoteAccountOwner(actualAccountAddress, expectedRouter);
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
     * @param expectedRouter The expected address of the router, must be current router owner of the factory
     * @param expectedAddress The expected CREATE2 address (for verification)
     * @return true if the RemoteAccount was created, false if it was pre-existing
     */
    function provide(
        string calldata principalAccount,
        address expectedRouter,
        address expectedAddress
    ) external override returns (bool) {
        if (owner() != expectedRouter) {
            // If the factory is used to "provide" a remote account for a different router,
            // we can check whether that remote account already exists and is valid,
            // but we cannot create a new one on behalf of another router.
            verifyRemoteAccount(principalAccount, expectedRouter, expectedAddress);
            return false;
        }
        return _provideForRouter(principalAccount, expectedRouter, expectedAddress);
    }

    /**
     * @notice Provide a RemoteAccount - creates if new, verifies if exists
     * @dev Idempotent: calling multiple times with same params succeeds as
     *      long as the RemoteAccount's current owner matches the provided routerAddress.
     *      This allows the owner router to provide and account with a specific
     *      router address. The router is supposed to only call this on specific "control"
     *      instructions sent by the manager which is the principal of
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
    ) external override onlyOwner returns (bool) {
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

        address accountAddress = _getRemoteAccountAddress(salt);

        if (expectedAddress == address(0)) {
            revert InvalidAccountAtAddress(expectedAddress);
        }

        if (accountAddress != expectedAddress) {
            revert AddressMismatch(expectedAddress, accountAddress);
        }

        if (accountAddress.code.length == 0) {
            RemoteAccount newAccount = new RemoteAccount{ salt: salt }();
            address newAccountAddress = address(newAccount);
            assert(newAccountAddress == accountAddress);

            // Immediately transfer ownership to router as an initialization step
            // not using constructor args so that remote account address only depends
            // on principal account through salt, and not on transferable owner.
            newAccount.transferOwnership(routerAddress);

            emit RemoteAccountCreated(newAccountAddress, principalAccount, routerAddress);

            return true;
        } else {
            _verifyRemoteAccountOwner(accountAddress, routerAddress);
            return false;
        }
    }

    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    fallback() external payable {
        emit Received(msg.sender, msg.value);
    }
}

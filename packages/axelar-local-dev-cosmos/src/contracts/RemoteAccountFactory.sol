// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import { Create2 } from '@openzeppelin/contracts/utils/Create2.sol';
import { Ownable } from '@openzeppelin/contracts/access/Ownable.sol';
import { IRemoteAccountFactory } from './interfaces/IRemoteAccountFactory.sol';
import { RemoteAccount } from './RemoteAccount.sol';

/**
 * @title RemoteAccountFactory
 * @notice A CREATE2 factory for deploying RemoteAccount contracts
 * @dev RemoteAccountFactory is a non-replaceable contract for deploying
 *      RemoteAccount contracts on behalf of an immutable factory principal
 *      account string (identifying e.g. a portfolio manager) at predictable
 *      addresses.
 *      This factory is ownable, and at any point in time is expected to be
 *      owned by the active representative of that factory principal (such as an
 *      IRemoteAccountRouter).
 *      This factory can be invoked publicly to create a RemoteAccount for a
 *      principal account string, initialized with an owner matching the current
 *      owner of this factory.
 *      This factory can also be invoked by its current owner to create such a
 *      RemoteAccount with an arbitrary owner.
 *      Each RemoteAccount created by this factory is uniquely identified by its
 *      principal account string via CREATE2 address derivation
 *      (see https://eips.ethereum.org/EIPS/eip-1014).
 */
contract RemoteAccountFactory is Ownable, IRemoteAccountFactory {
    // Store the principal details of this factory purely for reference
    // Immutable, but cannot be declaratively marked as such because they are strings
    string public factoryPrincipalCaip2;
    string public factoryPrincipalAccount;

    bytes32 private immutable _principalSalt;
    bytes32 private immutable _remoteAccountBytecodeHash;

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

    function _getSalt(string calldata principalAccount) internal pure returns (bytes32) {
        return keccak256(bytes(principalAccount));
    }

    /**
     * @notice Verify a principal account matches the factory's designated principal
     * @dev Only checks the account part not the caip2. The intent is to help owners
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

    /**
     * @notice Compute the address for a RemoteAccount deployed by this factory
     * @dev Revert if called for this factory's principal account
     * @param principalAccount The principal account string for the RemoteAccount
     * @return The deterministic address where the RemoteAccount is deployed
     *         and the associated CREATE2 salt
     */
    function _getRemoteAccountAddress(
        string calldata principalAccount
    ) internal view returns (address, bytes32) {
        bytes32 salt = _getSalt(principalAccount);
        if (salt == _principalSalt) {
            // XXX address(0) would also be an acceptable argument
            revert InvalidAccountAtAddress(address(this));
        }
        return (Create2.computeAddress(salt, _remoteAccountBytecodeHash), salt);
    }

    /**
     * @notice Compute the address for a RemoteAccount deployed by this factory
     * @dev Revert if called for this factory's principal account
     * @param principalAccount The principal account string for the RemoteAccount
     * @return addr The deterministic address where the RemoteAccount is deployed
     */
    function getRemoteAccountAddress(
        string calldata principalAccount
    ) public view override returns (address addr) {
        (addr, ) = _getRemoteAccountAddress(principalAccount);
    }

    /**
     * @notice Check if a RemoteAccount with the expected owner exists at the given address
     * @dev Assumes the caller already derived the account address from the principal account,
     *      and verified code exists for the address.
     *      Checks that the owner matches.
     *      Does not check that contract is a RemoteAccount, relies on deterministic address derivation.
     * @param accountAddress The derived remote account address to check
     * @param owner The expected address of the account's current owner
     */
    function _verifyRemoteAccountOwner(address accountAddress, address owner) internal view {
        try RemoteAccount(payable(accountAddress)).owner() returns (address existingOwner) {
            if (existingOwner != owner) {
                revert UnauthorizedOwner(owner, accountAddress);
            }
        } catch {
            revert UnauthorizedOwner(owner, accountAddress);
        }
    }

    /**
     * @notice Verify an address is a remote account for a given principal and its owner matches
     * @dev Does not check the owner matches the factory's current owner to allow a non current owner
     *      to interact with remote accounts whose ownership needs to be updated.
     *      Reverts if the account address does not match the expected address derived from the principal.
     *      Reverts if there is no account at the address, or it does not have the expected owner.
     * @param principalAccount The address of the principal for the RemoteAccount
     * @param expectedOwner The expected address of the owner
     * @param expectedAccountAddress The expected address to verify
     */
    function verifyRemoteAccount(
        string calldata principalAccount,
        address expectedOwner,
        address expectedAccountAddress
    ) public view override {
        (address actualAccountAddress, ) = _getRemoteAccountAddress(principalAccount);
        if (actualAccountAddress != expectedAccountAddress) {
            revert AddressMismatch(expectedAccountAddress, actualAccountAddress);
        }

        if (actualAccountAddress.code.length == 0) {
            revert InvalidAccountAtAddress(actualAccountAddress);
        }

        _verifyRemoteAccountOwner(actualAccountAddress, expectedOwner);
    }

    /**
     * @notice Provide a RemoteAccount - creates if new, verifies if exists
     * @dev Idempotent: calling multiple times with same params is safe as
     *      long as the current owner matches between the factory and remote account.
     *
     *      The expectedOwner parameter is critical for safety:
     *      - TOCTOU: Prevents time-of-check time-of-use races where the caller checks
     *        owner() then calls provideRemoteAccount(), but ownership changes in between. By validating
     *        expectedOwner matches current owner at execution, caller intent is preserved.
     *
     *      - Router upgrades: When upgrading from router A to B, in-flight provideRemoteAccount() calls
     *        meant for router A will fail rather than creating accounts owned by router B.
     *
     *      - Reorgs: During blockchain reorganizations, if a router ownership transfer and
     *        provideRemoteAccount() call get reordered, the check ensures provideRemoteAccount() fails rather than
     *        creating accounts with unexpected ownership.
     *
     * @param principalAccount The principal account string for the RemoteAccount
     * @param expectedOwner The expected address of the owner, must be current owner of the factory
     * @param expectedAddress The expected CREATE2 address (for verification)
     * @return created true if the RemoteAccount was created, false if it was pre-existing
     */
    function provideRemoteAccount(
        string calldata principalAccount,
        address expectedOwner,
        address expectedAddress
    ) external override returns (bool) {
        if (owner() != expectedOwner) {
            // If the factory is used to "provide" a remote account for a different owner,
            // we can check whether that remote account already exists and is valid,
            // but we cannot create a new one on behalf of another owner.
            verifyRemoteAccount(principalAccount, expectedOwner, expectedAddress);
            return false;
        }
        return _provideRemoteAccountForOwner(principalAccount, expectedOwner, expectedAddress);
    }

    /**
     * @notice Provide a RemoteAccount - creates if new, verifies if exists
     * @dev Idempotent: calling multiple times with same params succeeds as
     *      long as the RemoteAccount's current owner matches the provided ownerAddress.
     *      This allows the owner router to provide an account with a specific
     *      owner address. The owner is expected to call this function only for
     *      experimentation before committing to its own successor.
     * @param principalAccount The principal account string for the RemoteAccount
     * @param ownerAddress The address to use as owner of the RemoteAccount
     * @param expectedAddress The expected CREATE2 address (for verification)
     * @return created true if the RemoteAccount was created, false if it was pre-existing
     */
    function provideRemoteAccountForOwner(
        string calldata principalAccount,
        address ownerAddress,
        address expectedAddress
    ) external override onlyOwner returns (bool created) {
        return _provideRemoteAccountForOwner(principalAccount, ownerAddress, expectedAddress);
    }

    /**
     * @notice Provide a RemoteAccount - creates if new, verifies if exists
     * @dev Idempotent: calling multiple times with same params succeeds as
     *      long as the RemoteAccount's current owner matches the provided ownerAddress.
     *      This must not be exposed publicly without controls as an arbitrary
     *      owner address may prevent the portfolio manager from reaching the
     *      RemoteAccount if it does not have access to that router owner.
     * @param principalAccount The principal account string for the RemoteAccount
     * @param ownerAddress The address to use as owner of the RemoteAccount
     * @param expectedAddress The expected CREATE2 address (for verification)
     * @return created true if the RemoteAccount was created, false if it was pre-existing
     */
    function _provideRemoteAccountForOwner(
        string calldata principalAccount,
        address ownerAddress,
        address expectedAddress
    ) internal returns (bool created) {
        // Do not include the owner address to keep the remote account address independent
        // from its current owner setup.
        (address accountAddress, bytes32 salt) = _getRemoteAccountAddress(principalAccount);

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

            // Immediately transfer ownership to our owner as an initialization
            // step (we can't specify the correct owner in constructor arguments
            // because that would affect the resulting RemoteAccount address).
            newAccount.transferOwnership(ownerAddress);

            emit RemoteAccountCreated(newAccountAddress, principalAccount, ownerAddress);

            return true;
        } else {
            _verifyRemoteAccountOwner(accountAddress, ownerAddress);
            return false;
        }
    }
}

// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import { Clones } from '@openzeppelin/contracts/proxy/Clones.sol';
import { IRemoteAccountFactory } from './interfaces/IRemoteAccountFactory.sol';
import { RemoteAccount } from './RemoteAccount.sol';

/**
 * @title RemoteAccountFactory
 * @notice A factory for deploying RemoteAccount contracts
 * @dev RemoteAccountFactory is a non-replaceable contract for deploying
 *      RemoteAccount contracts on behalf of an immutable factory principal
 *      account string (identifying e.g. a portfolio manager) at predictable
 *      addresses.
 *      The factory uses the EIP-1167 minimal proxy pattern to deploy
 *      the RemoteAccount contracts as "clones", which delegate all calls to a
 *      pre-deployed RemoteAccount implementation contract.
 *      Remote accounts delegate authorization to this factory: any enabled
 *      router can execute calls on any account created by this factory.
 *      The factory maintains a vetted/enabled router map to support
 *      transitioning to updated routers, while enforcing a 2-factor mechanism
 *      for authorizing new routers.
 */
contract RemoteAccountFactory is IRemoteAccountFactory {
    enum RouterStatus {
        Unknown, // Could be potentially revoked
        Vetted,
        Enabled // Authorized to operate on remote accounts
    }

    error RouterNotVetted(address router);
    error RouterNotEnabled(address router);

    event RouterVetted(address indexed router);
    event RouterRevoked(address indexed router);

    event VettingAuthorityTransferProposed(
        address indexed currentVettingAuthority,
        address indexed proposedVettingAuthority
    );

    event VettingAuthorityTransferred(
        address indexed previousVettingAuthority,
        address indexed newVettingAuthority
    );

    // Store the principal details of this factory purely for reference
    // Immutable, but cannot be declaratively marked as such because they are strings
    /// @notice The CAIP-2 chain identifier for the factory's principal
    string public factoryPrincipalCaip2;
    /// @notice The account identifier for the factory's principal
    string public factoryPrincipalAccount;

    bytes32 private immutable _principalSalt;
    /// @notice The pre-deployed RemoteAccount implementation that all clones delegate to
    address public immutable implementation;

    /// @notice The number of routers currently authorized to operate remote accounts created by this factory
    uint256 public numberOfAuthorizedRouters;

    mapping(address => RouterStatus) private _routerStatus;

    /// @notice The address authorized to vet and revoke routers.
    /// @dev The vetting authority cannot enable or disable routers, only a
    //       currently enabled router can. A router cannot be revoked if it is
    //       still enabled.
    //       Similarly, changing the vetting authority requires the current
    //       authority to propose a new address, and an enabled router to
    //       confirm the change.
    address public vettingAuthority;
    address private _pendingVettingAuthority;

    /**
     * @param factoryPrincipalCaip2_ The caip2 of the principal for this RemoteAccountFactory
     * @param factoryPrincipalAccount_ The address of the principal for this RemoteAccountFactory
     * @param implementation_ The address of the pre-deployed RemoteAccount implementation contract.
     *        This implementation must have its initializers disabled to ensure it is inert.
     * @param initialVettingAuthority_ The initial address authorized to vet and revoke routers
     */
    constructor(
        string memory factoryPrincipalCaip2_,
        string memory factoryPrincipalAccount_,
        address implementation_,
        address initialVettingAuthority_
    ) {
        factoryPrincipalCaip2 = factoryPrincipalCaip2_;
        factoryPrincipalAccount = factoryPrincipalAccount_;
        _principalSalt = keccak256(bytes(factoryPrincipalAccount_)); // _getSalt(factoryPrincipalAccount_);
        implementation = implementation_;

        if (initialVettingAuthority_ == address(0)) {
            // The "expected" address in the error is somewhat subjective, but
            // it should be clear that the zero address is not valid.
            revert InvalidVettingAuthority(initialVettingAuthority_, msg.sender);
        }
        vettingAuthority = initialVettingAuthority_;

        try RemoteAccount(payable(implementation_)).factory() returns (address implFactory) {
            if (implFactory != address(0)) {
                revert('Implementation must be an inert RemoteAccount contract');
            }
        } catch {
            revert('Implementation must be a RemoteAccount contract');
        }
        try RemoteAccount(payable(implementation_)).initialize(address(0)) {
            revert('Implementation must be an inert RemoteAccount contract');
        } catch {
            // Expected to revert because the implementation should have initializers disabled
        }
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
     *         and the associated salt
     */
    function _getRemoteAccountAddress(
        string calldata principalAccount
    ) internal view returns (address, bytes32) {
        bytes32 salt = _getSalt(principalAccount);
        if (salt == _principalSalt) {
            revert InvalidAccountAtAddress(address(this));
        }
        return (Clones.predictDeterministicAddress(implementation, salt), salt);
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
     * @notice Verify an address is the expected one for a remote account
     *         created by this factory given its principal.
     * @dev Does not perform any existence checks.
     *      Reverts if the account address does not match the expected address derived from the principal,
     *      or if the factory's principal is used.
     * @param principalAccount The address of the principal for the RemoteAccount
     * @param expectedAccountAddress The expected address to verify
     * @return salt the CREATE2 salt used for the RemoteAccount address derivation
     */
    function _verifyRemoteAccountAddress(
        string calldata principalAccount,
        address expectedAccountAddress
    ) internal view returns (bytes32 salt) {
        address actualAccountAddress;
        (actualAccountAddress, salt) = _getRemoteAccountAddress(principalAccount);
        if (actualAccountAddress != expectedAccountAddress) {
            revert AddressMismatch(expectedAccountAddress, actualAccountAddress);
        }
    }

    /**
     * @notice Verify an address is a remote account for a given principal
     * @dev Reverts if the account address does not match the expected address derived from the principal.
     *      Reverts if there is no account at the address.
     * @param principalAccount The address of the principal for the RemoteAccount
     * @param expectedAccountAddress The expected address to verify
     */
    function verifyRemoteAccount(
        string calldata principalAccount,
        address expectedAccountAddress
    ) public view override {
        _verifyRemoteAccountAddress(principalAccount, expectedAccountAddress);

        if (expectedAccountAddress.code.length == 0) {
            revert InvalidAccountAtAddress(expectedAccountAddress);
        }
    }

    /**
     * @notice Provide a RemoteAccount - creates if new, verifies if exists
     * @dev Idempotent: calling multiple times with same params is safe.
     *      Since accounts immutably delegate authorization through this factory,
     *      there is no account state to verify (we rely on deterministic address
     *      derivation of the remote accounts, and atomic initialization).
     * @param principalAccount The principal account string for the RemoteAccount
     * @param expectedAddress The expected CREATE2 address (for verification)
     * @return created true if the RemoteAccount was created, false if it was pre-existing
     */
    function provideRemoteAccount(
        string calldata principalAccount,
        address expectedAddress
    ) external override returns (bool) {
        bytes32 salt = _verifyRemoteAccountAddress(principalAccount, expectedAddress);

        if (expectedAddress.code.length != 0) {
            return false;
        }

        _createRemoteAccount(principalAccount, salt, expectedAddress);
        return true;
    }

    /**
     * @notice Create a RemoteAccount clone
     * @dev Deploys an EIP-1167 clone and initializes it with this factory's address.
     * @param principalAccount The principal account string for the RemoteAccount
     * @param salt the CREATE2 salt derived from the principal account
     * @param expectedAddress The expected CREATE2 address (for verification)
     */
    function _createRemoteAccount(
        string calldata principalAccount,
        bytes32 salt,
        address expectedAddress
    ) internal {
        address newAccountAddress = Clones.cloneDeterministic(implementation, salt);
        assert(newAccountAddress == expectedAddress);

        // Initialize the clone with this factory's address.
        // The clone immutably delegates authorization to this factory.
        RemoteAccount(payable(newAccountAddress)).initialize(address(this));

        emit RemoteAccountCreated(newAccountAddress, principalAccount);
    }

    /**
     * @notice Check if a caller is authorized to operate on remote accounts
     * @dev Returns true if the caller is an enabled router.
     * @param caller The address to check
     * @return True if the caller is authorized
     */
    function isAuthorizedRouter(address caller) public view override returns (bool) {
        return _routerStatus[caller] == RouterStatus.Enabled;
    }

    /**
     * @notice Check the status of a router
     * @dev Returns the current status of the router.
     * @param router The address to check
     * @return The status of the router
     */
    function getRouterStatus(address router) external view returns (RouterStatus) {
        return _routerStatus[router];
    }

    /**
     * @notice Mark a router address as vetted (code-approved)
     * @dev Only the vetting authority can vet routers. Vetting does not enable the router.
     * @param router The router address to vet
     */
    function vetRouter(address router) public {
        if (msg.sender != vettingAuthority) {
            revert UnauthorizedCaller(msg.sender);
        }
        if (_routerStatus[router] == RouterStatus.Unknown) {
            _routerStatus[router] = RouterStatus.Vetted;
            emit RouterVetted(router);
        }
    }

    /**
     * @notice Vet and enable the initial router
     * @dev Only the vetting authority can authorize the initial router.
     *      Reverts if the factory is already initialized (any router authorized).
     * @param router The router address to vet and enable
     */
    function vetInitialRouter(address router) external {
        if (numberOfAuthorizedRouters > 0) {
            revert UnauthorizedCaller(msg.sender);
        }
        // This will check that the caller is authorized.
        vetRouter(router);
        _enableRouter(router);
    }

    /**
     * @notice Enable a vetted router to operate on remote accounts
     * @dev Only an enabled router can enable other routers. Router must be vetted first.
     * @param router The router address to enable
     */
    function enableRouter(address router) external override {
        if (!isAuthorizedRouter(msg.sender)) {
            revert UnauthorizedCaller(msg.sender);
        }
        _enableRouter(router);
    }

    /**
     * @notice Enable a vetted router to operate on remote accounts
     * @dev The internal caller must ensure the caller is authorized. Router must be vetted first.
     * @param router The router address to enable
     */
    function _enableRouter(address router) internal {
        if (_routerStatus[router] != RouterStatus.Vetted) {
            if (_routerStatus[router] == RouterStatus.Enabled) {
                return;
            }
            revert RouterNotVetted(router);
        }
        _routerStatus[router] = RouterStatus.Enabled;
        numberOfAuthorizedRouters += 1;
        emit RouterEnabled(router, numberOfAuthorizedRouters);
    }

    /**
     * @notice Disable an enabled router
     * @dev Only an enabled router different from the sender can disable
     * @param router The router address to disable
     */
    function disableRouter(address router) external override {
        if (router == msg.sender || !isAuthorizedRouter(msg.sender)) {
            revert UnauthorizedCaller(msg.sender);
        }
        if (_routerStatus[router] != RouterStatus.Enabled) {
            if (_routerStatus[router] == RouterStatus.Vetted) {
                return;
            }
            revert RouterNotEnabled(router);
        }
        _routerStatus[router] = RouterStatus.Vetted;
        numberOfAuthorizedRouters -= 1;
        emit RouterDisabled(router, numberOfAuthorizedRouters);
    }

    /**
     * @notice Revoke vetting from a router
     * @dev Only the vetting authority can revoke. Router must be disabled first.
     * @param router The router address to revoke
     */
    function revokeRouter(address router) external {
        if (msg.sender != vettingAuthority) {
            revert UnauthorizedCaller(msg.sender);
        }
        if (_routerStatus[router] != RouterStatus.Vetted) {
            if (_routerStatus[router] == RouterStatus.Unknown) {
                return;
            }
            revert RouterNotVetted(router);
        }
        delete _routerStatus[router];
        emit RouterRevoked(router);
    }

    /**
     * @notice Propose transfer of vetting authority to a new address
     * @dev Only the current vetting authority can propose a new address.
     *      The proposed address must be confirmed via an enabled router to
     *      become the new vetting authority.
     * @param newVettingAuthority The address of the new vetting authority
     */
    function proposeVettingAuthorityTransfer(address newVettingAuthority) external {
        if (msg.sender != vettingAuthority) {
            revert UnauthorizedCaller(msg.sender);
        }
        _pendingVettingAuthority = newVettingAuthority;
        emit VettingAuthorityTransferProposed(msg.sender, newVettingAuthority);
    }

    /**
     * @notice Confirm transfer of vetting authority to the proposed address
     * @dev Only an enabled router can confirm. The address must match the
     *      previously proposed address.
     * @param newVettingAuthority The address of the new vetting authority (must be proposed first)
     */
    function confirmVettingAuthorityTransfer(address newVettingAuthority) external override {
        if (!isAuthorizedRouter(msg.sender)) {
            revert UnauthorizedCaller(msg.sender);
        }
        if (newVettingAuthority != _pendingVettingAuthority || newVettingAuthority == address(0)) {
            revert InvalidVettingAuthority(newVettingAuthority, _pendingVettingAuthority);
        }

        address previousVettingAuthority = vettingAuthority;
        vettingAuthority = newVettingAuthority;
        _pendingVettingAuthority = address(0);

        emit VettingAuthorityTransferred(previousVettingAuthority, newVettingAuthority);
    }
}

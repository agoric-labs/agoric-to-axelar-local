// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import { IRemoteRepresentative } from './interfaces/IRemoteRepresentative.sol';

/**
 * @title RemoteRepresentative
 * @notice A contract representing the interests of a principal remote account designated by its CAIP-10
 */
abstract contract RemoteRepresentative is IRemoteRepresentative {
    string private _principalCaip2;
    string private _principalAccount;
    bytes32 private immutable _principalCaip10Hash;

    /**
     * @dev The info does not match the recorded principal account info.
     */
    error RemoteRepresentativeUnauthorizedPrincipal(string caip2, string account);

    /**
     * @dev The principal is not a valid account.
     */
    error RemoteRepresentativeInvalidPrincipal(string caip2, string account);

    /**
     * @param caip2 The CAIP-2 string of the principal remote account
     * @param account The address of the principal remote account
     */
    constructor(string memory caip2, string memory account) {
        if (bytes(caip2).length == 0 || bytes(account).length == 0) {
            revert RemoteRepresentativeInvalidPrincipal(caip2, account);
        }
        _principalCaip2 = caip2;
        _principalAccount = account;
        _principalCaip10Hash = keccak256(abi.encodePacked(caip2, ':', account));
    }

    modifier checkPrincipal(string calldata caip2, string calldata account) {
        _checkPrincipal(caip2, account);
        _;
    }

    function isPrincipal(
        string calldata caip2,
        string calldata account
    ) public view virtual override returns (bool) {
        return _principalCaip10Hash == keccak256(abi.encodePacked(caip2, ':', account));
    }

    /**
     * @notice Returns the account info of the principal this contract is representing
     * @return The CAIP-2 and account strings
     */
    function principal() public view virtual override returns (string memory, string memory) {
        return (_principalCaip2, _principalAccount);
    }

    /**
     * @dev Throws if the principal info doesn't match the recorded info.
     */
    function _checkPrincipal(string calldata caip2, string calldata account) internal view virtual {
        if (!isPrincipal(caip2, account)) {
            revert RemoteRepresentativeUnauthorizedPrincipal(caip2, account);
        }
    }
}

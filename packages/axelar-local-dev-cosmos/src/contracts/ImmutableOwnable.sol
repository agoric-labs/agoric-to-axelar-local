// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

abstract contract ImmutableOwnable {
    address public immutable owner;

    /**
     * @dev The caller account is not authorized to perform an operation.
     */
    error OwnableUnauthorizedAccount(address account);

    /**
     * @dev The owner is not a valid owner account. (eg. `address(0)`)
     */
    error OwnableInvalidOwner(address owner);

    constructor(address _owner) {
        if (_owner == address(0)) {
            revert OwnableInvalidOwner(address(0));
        }
        owner = _owner;
    }

    modifier onlyOwner() {
        _checkOwner();
        _;
    }

    /**
     * @dev Throws if the sender is not the owner.
     */
    function _checkOwner() internal view virtual {
        if (owner != msg.sender) {
            revert OwnableUnauthorizedAccount(msg.sender);
        }
    }
}

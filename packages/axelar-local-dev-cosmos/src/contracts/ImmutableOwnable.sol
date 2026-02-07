// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

/**
 * @dev Provides a basic access control mechanism, to an immutable owner account
 * that can be granted exclusive access to specific functions.
 *
 * This module is used through inheritance. It will make available the modifier
 * `onlyOwner`, which can be applied to your functions to restrict their use to
 * the owner.
 *
 * Like OpenZeppelin Ownable, but lacking a transfer mechanism.
 * https://docs.openzeppelin.com/contracts/5.x/api/access#ownable
 * https://github.com/OpenZeppelin/openzeppelin-contracts/blob/fcbae5394ae8ad52d8e580a3477db99814b9d565/contracts/access/Ownable.sol
 */
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

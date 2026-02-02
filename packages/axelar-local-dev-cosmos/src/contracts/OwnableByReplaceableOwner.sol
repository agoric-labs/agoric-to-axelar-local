// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import { Ownable } from '@openzeppelin/contracts/access/Ownable.sol';
import { IReplaceableOwner } from './interfaces/IReplaceableOwner.sol';

/**
 * @title OwnableByReplaceableOwner
 * @notice An Ownable contract with a self call function to replace the owner
 *         after verifying with the current owner whether the new owner is expected.
 * @dev Based on OZ Ownable for address-based ownership.
 */
abstract contract OwnableByReplaceableOwner is Ownable {
    constructor(address initialOwner) Ownable(initialOwner) {}

    function replaceableOwner() public view virtual returns (IReplaceableOwner) {
        return IReplaceableOwner(owner());
    }

    function _replaceOwner(address newOwner) internal virtual {
        if (newOwner == address(0)) {
            revert OwnableInvalidOwner(address(0));
        }
        if (address(replaceableOwner().replacementOwner()) != newOwner) {
            revert OwnableInvalidOwner(newOwner);
        }
        _transferOwnership(newOwner);
    }
}

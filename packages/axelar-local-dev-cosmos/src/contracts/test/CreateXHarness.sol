// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {CreateX} from "createx-factory/src/CreateX.sol";

/// @dev Test harness that exposes CreateX's internal `_guard` function.
contract CreateXHarness is CreateX {
    function exposedGuard(bytes32 salt) external view returns (bytes32) {
        return _guard(salt);
    }
}

// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import { Ownable } from '@openzeppelin/contracts/access/Ownable.sol';
import { IRemoteAccount, ContractCall } from './interfaces/IRemoteAccount.sol';

/**
 * @title RemoteAccount
 * @notice A wallet contract representing a designated remote account, controlled
           by a replaceable RemoteAccountAxelarRouter owner.
 * @dev Uses a OwnableByReplaceableOwner, derived from OZ Ownable for address-based
        ownership of the router, and a similar RemoteRepresentative contract to
        designate the principal remote account this wallet contract is acting on
        behalf of. This design enables migration paths - if the Axelar-based router
        is replaced, ownership can be transferred to a new router.
 */
contract RemoteAccount is Ownable, IRemoteAccount {
    event Received(address indexed sender, uint256 amount);

    constructor() Ownable(_msgSender()) {}

    /**
     * @notice Execute a batch of calls on behalf of the controller
     * @dev Requires router ownership check
     * @param calls Array of contract calls to execute
     */
    function executeCalls(ContractCall[] calldata calls) external override onlyOwner {
        uint256 len = calls.length;
        for (uint256 i = 0; i < len; ) {
            (bool success, bytes memory reason) = calls[i].target.call(calls[i].data);

            if (!success) {
                revert ContractCallFailed(i, reason);
            }

            unchecked {
                ++i;
            }
        }
    }

    receive() external payable virtual {
        emit Received(msg.sender, msg.value);
    }

    fallback() external payable virtual {
        emit Received(msg.sender, msg.value);
    }
}

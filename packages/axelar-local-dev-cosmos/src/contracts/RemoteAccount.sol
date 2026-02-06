// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import { Ownable } from '@openzeppelin/contracts/access/Ownable.sol';
import { IRemoteAccount, ContractCall } from './interfaces/IRemoteAccount.sol';

/**
 * @title RemoteAccount
 * @notice A wallet contract representing a principal account, controlled
           through a replaceable IRemoteAccountRouter owner.
 * @dev An Ownable for address-based, transferable ownership by the router.
        This contract does not track its principal directly but instead relies
        on the factory to deploy it at a predictable CREATE2 address derived
        from the principal. The router is responsible for validating the remote
        account's address against the expected principal on each call.
        This design enables migration paths - if the Axelar-based router is
        replaced, ownership can be transferred to a new router - while keeping
        this contract minimal with consistent account addresses.
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

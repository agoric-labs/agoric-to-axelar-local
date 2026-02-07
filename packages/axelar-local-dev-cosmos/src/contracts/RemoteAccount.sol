// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import { Ownable } from '@openzeppelin/contracts/access/Ownable.sol';
import { IRemoteAccount, ContractCall } from './interfaces/IRemoteAccount.sol';

/**
 * @title RemoteAccount
 * @notice A wallet contract representing a principal account, controlled
 *         through a replaceable owner (such as an IRemoteAccountRouter).
 * @dev An Ownable for address-based, transferable ownership by the owner router.
 *      This contract does not track its principal directly but instead relies
 *      on RemoteAccountFactory to deploy it at a predictable CREATE2 address
 *      derived from the principal. The owner is responsible for validating the remote
 *      account's address against the expected principal on each call.
 *      This design keeps RemoteAccount as simple as possible while still
 *      supporting migration paths in which the original owner is replaced with
 *      a new contract.
 */
contract RemoteAccount is Ownable, IRemoteAccount {
    event Received(address indexed sender, uint256 amount);

    constructor() Ownable(_msgSender()) {}

    /**
     * @notice Execute a batch of calls on behalf of the principal
     * @dev The owner is the only authorized caller, and is expected to
     *      target this RemoteAccount after deriving its address from the
     *      principal using the factory that created this RemoteAccount.
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

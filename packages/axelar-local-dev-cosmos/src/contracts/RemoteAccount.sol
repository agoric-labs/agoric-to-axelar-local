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
    constructor() Ownable(_msgSender()) {}

    /**
     * @notice Execute a batch of calls on behalf of the principal
     * @dev The owner is the only authorized caller, and is expected to
     *      target this RemoteAccount after deriving its address from the
     *      principal using the factory that created this RemoteAccount.
     * @param calls Array of contract calls to execute
     */
    function executeCalls(ContractCall[] calldata calls) external payable override onlyOwner {
        if (msg.value > 0) {
            emit Received(msg.sender, msg.value);
        }
        uint224 len = uint224(calls.length);
        for (uint224 i = 0; i < len; ) {
            (bool success, bytes memory reason) = calls[i].target.call{ value: calls[i].value }(
                calls[i].data
            );

            if (!success) {
                revert ContractCallFailed(calls[i].target, bytes4(calls[i].data[:4]), i, reason);
            }

            emit ContractCallSuccess(calls[i].target, bytes4(calls[i].data[:4]), i);
            unchecked {
                ++i;
            }
        }
    }

    receive() external payable virtual {
        emit Received(msg.sender, msg.value);
    }
}

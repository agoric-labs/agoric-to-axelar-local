// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import { Ownable } from '@openzeppelin/contracts/access/Ownable.sol';
import { IRemoteAccount, ContractCall } from './interfaces/IRemoteAccount.sol';

/**
 * @title RemoteAccount
 * @notice A wallet contract representing a principal account, controlled
 *         through a replaceable owner (such as an IRemoteAccountRouter).
 * @dev An Ownable for address-based, transferable ownership.
 *      This contract does not track its principal directly but instead relies
 *      on RemoteAccountFactory to deploy it at a predictable CREATE2 address
 *      derived from the principal. The owner is responsible for validating the
 *      remote account's address against the acting principal on each call.
 *      This design keeps RemoteAccount as simple as possible while still
 *      supporting migration paths in which the original owner is replaced with
 *      a new contract.
 */
contract RemoteAccount is Ownable, IRemoteAccount {
    constructor() Ownable(_msgSender()) {}

    /**
     * @notice Execute a batch of calls on behalf of the principal
     * @dev The owner is the only authorized caller, and is expected to
     *      target this RemoteAccount after using the RemoteAccountFactory that
     *      created it to re-derive its address from the acting principal.
     * @param calls Array of contract calls to execute
     */
    function executeCalls(ContractCall[] calldata calls) external payable override onlyOwner {
        if (msg.value > 0) {
            emit Received(msg.sender, msg.value);
        }
        uint256 len = calls.length;
        for (uint256 i = 0; i < len; ) {
            ContractCall calldata callItem = calls[i];
            bytes calldata data = callItem.data;
            address target = callItem.target;

            bool success;
            // Capture success, but don't allocate memory for 'reason' unless we catch a revert
            (success, ) = target.call{ value: callItem.value }(data);

            bytes4 selector;
            if (data.length >= 4) {
                selector = bytes4(data);
            }

            uint224 index = uint224(i);

            if (!success) {
                revert ContractCallFailed(target, selector, index, _getRevertReason());
            }

            emit ContractCallSuccess(target, selector, index);
            unchecked {
                ++i;
            }
        }
    }

    function _getRevertReason() internal pure returns (bytes memory reason) {
        uint256 size;
        assembly {
            size := returndatasize()
        }
        reason = new bytes(size);
        assembly {
            returndatacopy(add(reason, 0x20), 0, size)
        }
    }

    receive() external payable virtual {
        emit Received(msg.sender, msg.value);
    }
}

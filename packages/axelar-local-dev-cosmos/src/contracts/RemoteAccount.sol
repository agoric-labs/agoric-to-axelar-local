// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import { OwnableByReplaceableOwner } from './OwnableByReplaceableOwner.sol';
import { RemoteRepresentative } from './RemoteRepresentative.sol';
import { IRemoteAccount, ContractCall } from './interfaces/IRemoteAccount.sol';

/**
 * @title RemoteAccount
 * @notice A wallet contract representing a designated remote account, controlled
           by a replaceable PortfolioRouter owner. 
 * @dev Uses a OwnableByReplaceableOwner, derived from OZ Ownable for address-based
        ownership of the router, and a similar RemoteRepresentative contract to
        designate the principal remote account this wallet contract is acting on
        behalf of. This design enables migration paths - if the Axelar-based router
        is replaced, ownership can be transferred to a new router.
 */
contract RemoteAccount is RemoteRepresentative, OwnableByReplaceableOwner, IRemoteAccount {
    event Received(address indexed sender, uint256 amount);

    /**
     * @param principalCaip2 The caip2 of the principal for this RemoteAccount
     * @param principalAccount The address of the principal for this RemoteAccount
     */
    constructor(
        string memory principalCaip2,
        string memory principalAccount
    )
        RemoteRepresentative(principalCaip2, principalAccount)
        OwnableByReplaceableOwner(_msgSender())
    {}

    /**
     * @notice Replace the owner with the specified address
     * @dev External function checking that the caller is this contract itself
     *      before invoking the replace owner behavior of OwnableByReplaceableOwner
     *      which checks that the current owner has designated the new owner as
     *      its replacement. Allows executeCalls to replace ownership, enforcing
     *      that both the principal and the owner agree.
     */
    function replaceOwner(address newOwner) external virtual {
        // Allows the multicall to update the contract ownership
        require(_msgSender() == address(this));
        _replaceOwner(newOwner);
    }

    /**
     * @notice Execute a batch of calls on behalf of the controller
     * @dev Requires router ownership check AND principal is the source of calls (defense in depth)
     * @param sourceCaip2 The caip2 of the source issuing the calls command
     * @param sourceAccount The account of the source issuing calls command
     * @param calls Array of contract calls to execute
     */
    function executeCalls(
        string calldata sourceCaip2,
        string calldata sourceAccount,
        ContractCall[] calldata calls
    ) external override onlyOwner checkPrincipal(sourceCaip2, sourceAccount) {
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

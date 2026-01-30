// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IRemoteAccount, ContractCall} from "./interfaces/IRemoteAccount.sol";

/**
 * @title RemoteAccount
 * @notice A wallet contract controlled by a PortfolioRouter on behalf of an Agoric LCA
 * @dev Uses OZ Ownable for address-based ownership (the router) and a
 *      controller string (the portfolioLCA) for authorization. This design enables
 *      migration paths - if Axelar is replaced, ownership can be transferred to a new router.
 */
contract RemoteAccount is Ownable, IRemoteAccount {
    string private _controller;

    event Received(address indexed sender, uint256 amount);

    /**
     * @param initialOwner The address that owns this account (typically PortfolioRouter)
     * @param controller_ The portfolioLCA string that controls this account
     */
    constructor(
        address initialOwner,
        string memory controller_
    ) Ownable(initialOwner) {
        _controller = controller_;
    }

    /**
     * @notice Returns the controller (portfolioLCA) for this account
     * @return The portfolioLCA string set at construction
     */
    function controller() external view override returns (string memory) {
        return _controller;
    }

    /**
     * @notice Execute a batch of calls on behalf of the controller
     * @dev Requires msg.sender == owner AND portfolioLCA == controller (defense in depth)
     * @param portfolioLCA The controller string that must match the _controller
     * @param calls Array of contract calls to execute
     */
    function executeCalls(
        string calldata portfolioLCA,
        ContractCall[] calldata calls
    ) external override onlyOwner {
        if (keccak256(bytes(portfolioLCA)) != keccak256(bytes(_controller))) {
            revert UnauthorizedController(_controller, portfolioLCA);
        }

        uint256 len = calls.length;
        for (uint256 i = 0; i < len; ) {
            (bool success, ) = calls[i].target.call(calls[i].data);

            if (!success) {
                revert ContractCallFailed(i, calls[i].target, calls[i].data);
            }

            emit CallExecuted(
                i,
                calls[i].target,
                bytes4(calls[i].data),
                success
            );

            unchecked {
                ++i;
            }
        }

        emit CallsExecuted(portfolioLCA, len);
    }

    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    fallback() external payable {
        emit Received(msg.sender, msg.value);
    }
}

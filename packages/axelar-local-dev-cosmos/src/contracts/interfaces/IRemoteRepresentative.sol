// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

/**
 * @title IRemoteRepresentative
 * @notice A contract representing the interests of a principal remote account designated by its CAIP-10
 */
interface IRemoteRepresentative {
    function isPrincipal(string calldata caip2, string calldata account) external view returns (bool);

    /**
     * @notice Returns the account info of the principal this contract is representing
     * @return The CAIP-2 and account strings
     */
    function principal() external view returns (string memory, string memory);
}

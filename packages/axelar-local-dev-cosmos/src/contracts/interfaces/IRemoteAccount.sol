// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

/**
 * @notice An ABI-encoded function call to invoke on a target address with the
 *         specified value to transfer.
 */
struct ContractCall {
    /// @dev the contract address receiving the call
    address target;
    /// @dev the encoded call data
    bytes data;
    /// @dev any `value` to forward to a payable call target
    uint256 value;
}

interface IRemoteAccount {
    event Received(address indexed sender, uint256 amount);

    event ContractCallSuccess(address indexed target, bytes4 selector, uint224 callIndex);

    error ContractCallFailed(address target, bytes4 selector, uint224 callIndex, bytes reason);

    function executeCalls(ContractCall[] calldata calls) external payable;
}

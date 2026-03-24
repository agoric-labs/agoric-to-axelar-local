// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

/**
 * @notice An ABI-encoded function call to invoke on a target address with the
 *         specified value to transfer, and an optional gas limit.
 * @dev This struct packs the `value` and `gasLimit` into a single 32-byte slot
 *      to reduce payload size. 64 bits for gas is generally considered as
 *      sufficient for gas calculation, as implied by standard track EIPs like
 *      EIP-4803. Similarly, 192 bits allows to represent 6.27E+39 tokens units
 *      when that token uses 18 decimals.
 */
struct ContractCall {
    /// @dev the contract address receiving the call
    address target;
    /// @dev the encoded call data
    bytes data;
    /// @dev any `value` to forward to a payable call target
    uint192 value;
    /// @dev an explicit gas limit to provide when making the call
    ///      If `0`, the call is made without specifying any `gas`
    uint64 gasLimit;
}

interface IRemoteAccount {
    event Received(address indexed sender, uint256 amount);

    event ContractCallSuccess(
        address indexed target,
        bytes4 selector,
        uint32 callIndex,
        uint64 gasUsed
    );

    error ContractCallFailed(address target, bytes4 selector, uint32 callIndex, bytes reason);
    error UnauthorizedCaller(address caller);

    function factory() external view returns (address);

    function principalAccount() external view returns (string memory);

    function executeCalls(ContractCall[] calldata calls) external payable;
}

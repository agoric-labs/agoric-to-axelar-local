// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

struct ContractCall {
    address target;
    bytes data;
    uint256 value;
}

interface IRemoteAccount {
    event Received(address indexed sender, uint256 amount);

    error ContractCallFailed(uint256 index, bytes reason);

    function executeCalls(ContractCall[] calldata calls) external payable;
}

// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

struct ContractCall {
    address target;
    bytes data;
    uint256 value;
}

interface IRemoteAccount {
    event Received(address indexed sender, uint256 amount);

    event ContractCallSuccess(address indexed target, bytes4 selector, uint224 callIndex);

    error ContractCallFailed(address target, bytes4 selector, uint224 callIndex, bytes reason);

    function executeCalls(ContractCall[] calldata calls) external payable;
}

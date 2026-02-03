// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

struct ContractCall {
    address target;
    bytes data;
}

interface IRemoteAccount {
    error ContractCallFailed(uint256 index, bytes reason);

    function executeCalls(ContractCall[] calldata calls) external;
}

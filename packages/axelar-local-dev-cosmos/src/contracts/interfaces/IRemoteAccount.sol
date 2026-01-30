// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

struct ContractCall {
    address target;
    bytes data;
}

interface IRemoteAccount {
    error UnauthorizedController(string expected, string actual);
    error ContractCallFailed(uint256 index, address target, bytes data);

    function controller() external view returns (string memory);

    function executeCalls(
        string calldata portfolioLCA,
        ContractCall[] calldata calls
    ) external;
}

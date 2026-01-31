// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

interface IRemoteAccountFactory {
    error AddressMismatch(address expected, address actual);
    error UnauthorizedRouter(address router);
    error InvalidAccountAtAddress(address account);

    function provide(
        string calldata principalCaip2,
        string calldata principalAddress,
        address expectedRouter,
        address expectedAddress
    ) external returns (bool);
}

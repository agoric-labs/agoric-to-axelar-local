// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

interface IRemoteAccountFactory {
    error AddressMismatch(address expected, address actual);
    error UnauthorizedRouter(address router);
    error InvalidAccountAtAddress(address account);

    event RemoteAccountCreated(
        address indexed accountAddress,
        string principalAccount,
        address indexed routerAddress
    );

    function getRemoteAccountAddress(
        string calldata principalAccount
    ) external view returns (address);

    function verifyRemoteAccount(
        string calldata principalAccount,
        address expectedRouter,
        address accountAddress
    ) external view returns (bool);

    function provide(
        string calldata principalAccount,
        address expectedRouter,
        address expectedAddress
    ) external returns (bool);
}

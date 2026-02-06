// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

interface IRemoteAccountFactory {
    error AddressMismatch(address expected, address actual);
    error UnauthorizedRouter(address account, address router);
    error InvalidAccountAtAddress(address account);
    error PrincipalAccountMismatch(string expected, string actual);

    event RemoteAccountCreated(
        address indexed accountAddress,
        string principalAccount,
        address indexed routerAddress
    );

    function factoryPrincipalCaip2() external view returns (string memory);

    function factoryPrincipalAccount() external view returns (string memory);

    function verifyFactoryPrincipalAccount(string calldata expectedPrincipalAccount) external view;

    function getRemoteAccountAddress(
        string calldata principalAccount
    ) external view returns (address);

    function verifyRemoteAccount(
        string calldata principalAccount,
        address expectedRouter,
        address accountAddress
    ) external view;

    function provide(
        string calldata principalAccount,
        address expectedRouter,
        address expectedAddress
    ) external returns (bool);

    function provideForRouter(
        string calldata principalAccount,
        address router,
        address expectedAddress
    ) external returns (bool);
}

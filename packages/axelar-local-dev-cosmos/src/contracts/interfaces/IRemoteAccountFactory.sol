// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

interface IRemoteAccountFactory {
    error AddressMismatch(address expected, address actual);
    error InvalidAccountAtAddress(address account);
    error PrincipalAccountMismatch(string expected, string actual);
    error UnauthorizedCaller(address caller);

    error InvalidVettingAuthority(address requested, address expected);

    event RemoteAccountCreated(address indexed accountAddress, string principalAccount);

    event RouterAuthorized(address indexed router, uint256 numberOfAuthorizedRouters);
    event RouterDeauthorized(address indexed router, uint256 numberOfAuthorizedRouters);

    function factoryPrincipalCaip2() external view returns (string memory);

    function factoryPrincipalAccount() external view returns (string memory);

    function verifyFactoryPrincipalAccount(string calldata expectedPrincipalAccount) external view;

    function getRemoteAccountAddress(
        string calldata principalAccount
    ) external view returns (address);

    function verifyRemoteAccount(
        string calldata principalAccount,
        address accountAddress
    ) external view;

    function provideRemoteAccount(
        string calldata principalAccount,
        address expectedAddress
    ) external returns (bool created);

    function isAuthorizedRouter(address caller) external view returns (bool);

    function numberOfAuthorizedRouters() external view returns (uint256);

    function authorizeRouter(address router) external;

    function deauthorizeRouter(address router) external;

    function confirmVettingAuthorityTransfer(address newVettingAuthority) external;
}

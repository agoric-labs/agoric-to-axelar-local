// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

interface IRemoteAccountFactory {
    error AddressMismatch(address expected, address actual);
    error InvalidAccountAtAddress(address account);
    error PrincipalAccountMismatch(string expected, string actual);
    error RouterNotVetted(address router);
    error RouterStillEnabled(address router);
    error UnauthorizedCaller(address caller);

    event RemoteAccountCreated(address indexed accountAddress, string principalAccount);

    event RouterVetted(address indexed router);
    event RouterEnabled(address indexed router);
    event RouterDisabled(address indexed router);
    event RouterRevoked(address indexed router);

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

    function isAuthorizedCaller(address caller) external view returns (bool);

    function vetRouter(address router) external;

    function enableRouter(address router) external;

    function disableRouter(address router) external;

    function revokeRouter(address router) external;
}

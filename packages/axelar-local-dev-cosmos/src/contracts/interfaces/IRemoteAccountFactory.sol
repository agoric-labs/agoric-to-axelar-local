// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

interface IRemoteAccountFactory {
    enum RouterStatus {
        Unknown, // Could be potentially revoked
        Vetted,
        Enabled
    }

    error AddressMismatch(address expected, address actual);
    error InvalidAccountAtAddress(address account);
    error PrincipalAccountMismatch(string expected, string actual);
    error RouterNotVetted(address router);
    error RouterNotEnabled(address router);
    error UnauthorizedCaller(address caller);

    error InvalidVettingAuthority(address requested, address expected);

    event RemoteAccountCreated(address indexed accountAddress, string principalAccount);

    event RouterVetted(address indexed router);
    event RouterEnabled(address indexed router, uint256 numberOfAuthorizedRouters);
    event RouterDisabled(address indexed router, uint256 numberOfAuthorizedRouters);
    event RouterRevoked(address indexed router);

    event VettingAuthorityTransferProposed(
        address indexed currentVettingAuthority,
        address indexed proposedVettingAuthority
    );

    event VettingAuthorityTransferred(
        address indexed previousVettingAuthority,
        address indexed newVettingAuthority
    );

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

    function getRouterStatus(address router) external view returns (RouterStatus);

    function numberOfAuthorizedRouters() external view returns (uint256);

    function enableRouter(address router) external;

    function disableRouter(address router) external;

    function confirmVettingAuthorityTransfer(address newVettingAuthority) external;
}

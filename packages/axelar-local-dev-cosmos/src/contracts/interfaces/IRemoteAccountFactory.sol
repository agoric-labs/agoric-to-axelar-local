// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

interface IRemoteAccountFactory {
    error AddressMismatch(address expected, address actual);
    error UnauthorizedOwner(address owner, address account);
    error InvalidAccountAtAddress(address account);
    error PrincipalAccountMismatch(string expected, string actual);

    event RemoteAccountCreated(
        address indexed accountAddress,
        string principalAccount,
        address indexed ownerAddress
    );

    function factoryPrincipalCaip2() external view returns (string memory);

    function factoryPrincipalAccount() external view returns (string memory);

    function verifyFactoryPrincipalAccount(string calldata expectedPrincipalAccount) external view;

    function getRemoteAccountAddress(
        string calldata principalAccount
    ) external view returns (address);

    function verifyRemoteAccount(
        string calldata principalAccount,
        address expectedOwner,
        address accountAddress
    ) external view;

    function provide(
        string calldata principalAccount,
        address expectedOwner,
        address expectedAddress
    ) external returns (bool);

    function provideForOwner(
        string calldata principalAccount,
        address owner,
        address expectedAddress
    ) external returns (bool);
}

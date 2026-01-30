// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

interface IRemoteAccountFactory {
    error AddressMismatch(address expected, address actual);
    error InvalidAccountAtAddress(address account);
    error CodeHashMismatch(bytes32 expected, bytes32 actual);
    error ControllerMismatch(string expected, string actual);
    error OwnerMismatch(address expected, address actual);

    function remoteAccountCodeHash() external view returns (bytes32);

    function provide(
        string calldata portfolioLCA,
        address expectedAddress,
        address routerAddress
    ) external returns (bool);
}

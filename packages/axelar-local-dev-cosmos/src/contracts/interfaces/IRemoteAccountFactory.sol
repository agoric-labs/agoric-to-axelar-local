// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

interface IRemoteAccountFactory {
    error AddressMismatch(address expected, address actual);
    error InvalidAccountAtAddress(address account);

    function provide(
        string calldata portfolioLCA,
        address expectedAddress,
        address routerAddress
    ) external returns (bool);
}

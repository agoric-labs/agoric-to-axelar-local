// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import { ContractCall } from './IRemoteAccount.sol';
import { IRemoteAccountFactory } from './IRemoteAccountFactory.sol';
import { IPermit2 } from './IPermit2.sol';

struct DepositPermit {
    address tokenOwner;
    IPermit2.PermitTransferFrom permit;
    bytes32 witness;
    string witnessTypeString;
    bytes signature;
}

// The execute payload is in the form of
// (string txId, address expectedAccountAddress, Instruction instruction)
// where Instruction matches one of the *Instruction type. This shape matches
// the signature of the respective `process*Instruction` function, where
// sourceAddress is substituted by txId.
// txId is a unique identifier matching the id published by the controller.
// Used by a resolver to observe/trace transactions.

struct RemoteAccountInstruction {
    DepositPermit[] depositPermit;
    ContractCall[] multiCalls;
}

struct UpdateOwnerInstruction {
    address newOwner;
}

struct ProvideForRouterInstruction {
    address router;
}

interface IRemoteAccountRouter {
    event OperationResult(
        string indexed id,
        string indexed sourceAddress,
        address indexed allegedRemoteAccount,
        bool success,
        bytes reason
    );

    error InvalidPayload(bytes4 selector);

    function factory() external view returns (IRemoteAccountFactory);

    function permit2() external view returns (IPermit2);

    function replacementOwner() external view returns (address);

    function processRemoteAccountInstruction(
        string calldata sourceAddress,
        address expectedAccountAddress,
        RemoteAccountInstruction calldata instruction
    ) external;

    function processUpdateOwnerInstruction(
        string calldata sourceAddress,
        address expectedAccountAddress,
        UpdateOwnerInstruction calldata instruction
    ) external;

    function processProvideForRouterInstruction(
        string calldata sourceAddress,
        address expectedAccountAddress,
        ProvideForRouterInstruction calldata instruction
    ) external;
}

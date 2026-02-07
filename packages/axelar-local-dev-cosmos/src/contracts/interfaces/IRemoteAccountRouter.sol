// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import { ContractCall } from './IRemoteAccount.sol';
import { IRemoteAccountFactory } from './IRemoteAccountFactory.sol';
import { IPermit2 } from './IPermit2.sol';

struct DepositPermit {
    address owner;
    IPermit2.PermitTransferFrom permit;
    bytes32 witness;
    string witnessTypeString;
    bytes signature;
}

struct ProvideRemoteAccountInstruction {
    DepositPermit[] depositPermit;
    string principalAccount;
    address expectedAccountAddress;
}

struct RemoteAccountExecuteInstruction {
    ContractCall[] multiCalls;
}

struct UpdateOwnerInstruction {
    address newOwner;
}

interface IRemoteAccountRouter {
    event OperationResult(
        string indexed id,
        string indexed sourceAddress,
        address indexed allegedRemoteAccount,
        bool success,
        bytes reason
    );

    function factory() external view returns (IRemoteAccountFactory);

    function permit2() external view returns (IPermit2);

    function successor() external view returns (address);

    function processProvideRemoteAccountInstruction(
        string calldata sourceAddress,
        address factoryAddress,
        ProvideRemoteAccountInstruction calldata instruction
    ) external;

    function processRemoteAccountExecuteInstruction(
        string calldata sourceAddress,
        address expectedAccountAddress,
        RemoteAccountExecuteInstruction calldata instruction
    ) external;

    function processUpdateOwnerInstruction(
        string calldata sourceAddress,
        address expectedAccountAddress,
        UpdateOwnerInstruction calldata instruction
    ) external;
}

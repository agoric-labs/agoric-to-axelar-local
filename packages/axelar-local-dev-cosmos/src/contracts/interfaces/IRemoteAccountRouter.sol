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

/**
 * @notice Instructions for ensuring existence of a RemoteAccount of a principal
 *         account, optionally including a single DepositPermit for pulling in
 *         funds to it
 */
struct ProvideRemoteAccountInstruction {
    DepositPermit[] depositPermit;
    string principalAccount;
    address expectedAccountAddress;
}

struct RemoteAccountExecuteInstruction {
    ContractCall[] multiCalls;
}

struct EnableRouterInstruction {
    address router;
}

struct DisableRouterInstruction {
    address router;
}

struct ConfirmVettingAuthorityInstruction {
    address authority;
}

interface IRemoteAccountRouter {
    event OperationResult(
        string indexed txId,
        string indexed sourceAddressIndex,
        string sourceAddress,
        address indexed allegedRemoteAccount,
        bytes4 instructionSelector,
        bool success,
        bytes reason
    );

    error SubcallOutOfGas();
    error InvalidInstructionSelector(bytes4 selector);

    function factory() external view returns (IRemoteAccountFactory);

    function permit2() external view returns (IPermit2);

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

    function processEnableRouterInstruction(
        string calldata sourceAddress,
        address factoryAddress,
        EnableRouterInstruction calldata instruction
    ) external;

    function processDisableRouterInstruction(
        string calldata sourceAddress,
        address factoryAddress,
        DisableRouterInstruction calldata instruction
    ) external;

    function processConfirmVettingAuthorityInstruction(
        string calldata sourceAddress,
        address factoryAddress,
        ConfirmVettingAuthorityInstruction calldata instruction
    ) external;
}

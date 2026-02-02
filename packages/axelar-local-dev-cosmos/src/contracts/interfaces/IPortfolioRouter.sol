// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import { ContractCall } from './IRemoteAccount.sol';
import { IRemoteAccountFactory } from './IRemoteAccountFactory.sol';
import { IRemoteRepresentative } from './IRemoteRepresentative.sol';
import { IReplaceableOwner } from './IReplaceableOwner.sol';
import { IPermit2 } from './IPermit2.sol';

struct DepositPermit {
    address tokenOwner;
    IPermit2.PermitTransferFrom permit;
    bytes32 witness;
    string witnessTypeString;
    bytes signature;
}

struct RouterInstruction {
    /// @dev Unique identifier matching the id published by the portfolio manager.
    ///      Used by a resolver to observe/trace transactions.
    string id;
    string portfolioLCA;
    address remoteAccountAddress;
    bool provideAccount;
    DepositPermit[] depositPermit;
    ContractCall[] multiCalls;
}

interface IPortfolioRouter is IRemoteRepresentative, IReplaceableOwner {
    event OperationResult(string indexed id, bool success, bytes reason);

    function factory() external view returns (IRemoteAccountFactory);
    function permit2() external view returns (IPermit2);
}

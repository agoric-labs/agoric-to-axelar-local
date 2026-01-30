// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import { ContractCall } from './IRemoteAccount.sol';
import { IRemoteAccountFactory } from './IRemoteAccountFactory.sol';

interface IPermit2 {
    struct TokenPermissions {
        address token;
        uint256 amount;
    }

    struct PermitTransferFrom {
        TokenPermissions permitted;
        uint256 nonce;
        uint256 deadline;
    }

    struct SignatureTransferDetails {
        address to;
        uint256 requestedAmount;
    }

    function permitWitnessTransferFrom(
        PermitTransferFrom calldata permit,
        SignatureTransferDetails calldata transferDetails,
        address owner,
        bytes32 witness,
        string calldata witnessTypeString,
        bytes calldata signature
    ) external;
}

struct DepositPermit {
    address tokenOwner;
    IPermit2.PermitTransferFrom permit;
    bytes32 witness;
    string witnessTypeString;
    bytes signature;
}

struct RouterPayload {
    /// @dev Unique identifier matching the id posted by the ymax contract on
    ///      vstorage (format: tx1, tx2, etc.). Used by the resolver to
    ///      observe/trace transactions.
    string id;
    string portfolioLCA;
    address remoteAccountAddress;
    bool provideAccount;
    DepositPermit[] depositPermit;
    ContractCall[] multiCalls;
}

interface IPortfolioRouter {
    error InvalidSourceChain(string expected, string actual);
    error InvalidSourceAddress(string expected, string actual);

    event OperationError(string operation, bytes reason);
    event AccountProvided(
        string indexed id,
        bool success,
        address indexed account,
        string indexed controller,
        bytes reason
    );
    event DepositStatus(string indexed id, bool success, bytes reason);
    event MulticallStatus(string indexed id, bool success, bytes reason);

    function agoricLCA() external view returns (string memory);
    function factory() external view returns (IRemoteAccountFactory);
    function permit2() external view returns (IPermit2);
}

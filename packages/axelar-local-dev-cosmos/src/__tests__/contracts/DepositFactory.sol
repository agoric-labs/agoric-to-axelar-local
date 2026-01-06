// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import {AxelarExecutable} from "@updated-axelar-network/axelar-gmp-sdk-solidity/contracts/executable/AxelarExecutable.sol";
import {IAxelarGasService} from "@updated-axelar-network/axelar-gmp-sdk-solidity/contracts/interfaces/IAxelarGasService.sol";
import {StringToAddress, AddressToString} from "@updated-axelar-network/axelar-gmp-sdk-solidity/contracts/libs/AddressString.sol";
import {Ownable} from "./Ownable.sol";
import {Wallet} from "./Wallet.sol";

error InvalidSourceChain(string expected, string actual);
error InvalidPermitKind(uint8 kind);

// Minimal version taken from: https://github.com/Uniswap/permit2/blob/cc56ad0f3439c502c246fc5cfcc3db92bb8b7219/src/interfaces/IPermit2.sol
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

    struct PermitBatchTransferFrom {
        TokenPermissions[] permitted;
        uint256 nonce;
        uint256 deadline;
    }

    struct SignatureTransferDetails {
        address to;
        uint256 requestedAmount;
    }

    function permitTransferFrom(
        PermitTransferFrom calldata permit,
        SignatureTransferDetails calldata transferDetails,
        address owner,
        bytes calldata signature
    ) external;

    function permitTransferFrom(
        PermitBatchTransferFrom calldata permit,
        SignatureTransferDetails[] calldata transferDetails,
        address owner,
        bytes calldata signature
    ) external;

    function permitWitnessTransferFrom(
        PermitTransferFrom calldata permit,
        SignatureTransferDetails calldata transferDetails,
        address owner,
        bytes32 witness,
        string calldata witnessTypeString,
        bytes calldata signature
    ) external;

    function permitWitnessTransferFrom(
        PermitBatchTransferFrom calldata permit,
        SignatureTransferDetails[] calldata transferDetails,
        address owner,
        bytes32 witness,
        string calldata witnessTypeString,
        bytes calldata signature
    ) external;
}

/// @notice Permit format selector for decoding `permitBytes`
enum PermitKind {
    Single, // 0
    Batch // 1
}

/// @notice Payload that Factory receives from Axelar to create + deposit in a new Wallet
/// @dev Supports both single and batch Permit2 transfers via permitBytes encoding
struct CreateAndDepositPayload {
    // the smart wallet owner (the actual owner of the wallet being created)
    string lcaOwner;
    // EVM address that signed the Permit2 EIP-712 (the token owner on this chain)
    address tokenOwner;
    // which permit struct is encoded in permitBytes
    PermitKind kind;
    // abi.encode(IPermit2.PermitTransferFrom) OR abi.encode(IPermit2.PermitBatchTransferFrom)
    bytes permitBytes;
    // Witness data for additional context (e.g., hash of wallet address + chainId)
    bytes32 witness;
    // EIP-712 type string for witness validation
    string witnessTypeString;
    // 65-byte or 64-byte (EIP-2098) signature
    bytes signature;
}

contract DepositFactory is AxelarExecutable, Ownable {
    using StringToAddress for string;
    using AddressToString for address;

    address internal immutable _gateway;
    IAxelarGasService public immutable gasService;

    // Permit2 SignatureTransfer entrypoint
    IPermit2 public immutable permit2;

    string private constant EXPECTED_SOURCE_CHAIN = "agoric";
    bytes32 private constant EXPECTED_SOURCE_CHAIN_HASH =
        keccak256(bytes(EXPECTED_SOURCE_CHAIN));

    event SmartWalletCreated(
        address indexed wallet,
        string owner,
        string sourceChain,
        string sourceAddress
    );

    event Received(address indexed sender, uint256 amount);

    constructor(
        address gateway_,
        address gasReceiver_,
        address permit2_,
        string memory owner_
    ) payable AxelarExecutable(gateway_) Ownable(owner_) {
        gasService = IAxelarGasService(gasReceiver_);
        _gateway = gateway_;
        permit2 = IPermit2(permit2_);
    }

    function _createSmartWallet(
        string memory owner
    ) internal returns (address) {
        address newWallet = address(
            new Wallet{salt: keccak256(abi.encodePacked(owner))}(
                _gateway,
                address(gasService),
                owner
            )
        );
        return newWallet;
    }

    function _createAndDepositSingle(
        string memory lcaOwner,
        address tokenOwner,
        IPermit2.PermitTransferFrom memory permit,
        bytes32 witness,
        string memory witnessTypeString,
        bytes memory signature
    ) internal returns (address newWallet) {
        require(bytes(lcaOwner).length > 0, "lcaOwner cannot be empty");
        require(tokenOwner != address(0), "tokenOwner=0");
        require(permit.permitted.token != address(0), "token=0");
        require(permit.permitted.amount > 0, "amount=0");

        newWallet = _createSmartWallet(lcaOwner);

        IPermit2.SignatureTransferDetails memory details = IPermit2
            .SignatureTransferDetails({
                to: newWallet,
                requestedAmount: permit.permitted.amount
            });

        permit2.permitWitnessTransferFrom(
            permit,
            details,
            tokenOwner,
            witness,
            witnessTypeString,
            signature
        );
    }

    function _createAndDepositBatch(
        string memory lcaOwner,
        address tokenOwner,
        IPermit2.PermitBatchTransferFrom memory permit,
        bytes32 witness,
        string memory witnessTypeString,
        bytes memory signature
    ) internal returns (address newWallet) {
        require(bytes(lcaOwner).length > 0, "lcaOwner cannot be empty");
        require(tokenOwner != address(0), "tokenOwner=0");

        uint256 n = permit.permitted.length;
        require(n > 0, "no tokens");

        newWallet = _createSmartWallet(lcaOwner);

        IPermit2.SignatureTransferDetails[]
            memory details = new IPermit2.SignatureTransferDetails[](n);

        for (uint256 i = 0; i < n; i++) {
            address token = permit.permitted[i].token;
            uint256 amount = permit.permitted[i].amount;

            require(token != address(0), "token=0");
            require(amount > 0, "amount=0");

            details[i] = IPermit2.SignatureTransferDetails({
                to: newWallet,
                requestedAmount: amount
            });
        }

        permit2.permitWitnessTransferFrom(
            permit,
            details,
            tokenOwner,
            witness,
            witnessTypeString,
            signature
        );
    }

    function _execute(
        bytes32 /*commandId*/,
        string calldata sourceChain,
        string calldata sourceAddress,
        bytes calldata payload
    ) internal override onlyOwner(sourceAddress) {
        if (keccak256(bytes(sourceChain)) != EXPECTED_SOURCE_CHAIN_HASH) {
            revert InvalidSourceChain(EXPECTED_SOURCE_CHAIN, sourceChain);
        }

        CreateAndDepositPayload memory p = abi.decode(
            payload,
            (CreateAndDepositPayload)
        );

        address smartWalletAddress;
        string memory walletOwner = p.lcaOwner;

        if (p.kind == PermitKind.Single) {
            IPermit2.PermitTransferFrom memory singlePermit = abi.decode(
                p.permitBytes,
                (IPermit2.PermitTransferFrom)
            );

            smartWalletAddress = _createAndDepositSingle(
                walletOwner,
                p.tokenOwner,
                singlePermit,
                p.witness,
                p.witnessTypeString,
                p.signature
            );
        } else if (p.kind == PermitKind.Batch) {
            IPermit2.PermitBatchTransferFrom memory batchPermit = abi.decode(
                p.permitBytes,
                (IPermit2.PermitBatchTransferFrom)
            );

            smartWalletAddress = _createAndDepositBatch(
                walletOwner,
                p.tokenOwner,
                batchPermit,
                p.witness,
                p.witnessTypeString,
                p.signature
            );
        } else {
            revert InvalidPermitKind(uint8(p.kind));
        }

        emit SmartWalletCreated(
            smartWalletAddress,
            walletOwner,
            sourceChain,
            sourceAddress
        );
    }

    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    fallback() external payable {
        emit Received(msg.sender, msg.value);
    }
}

// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import {AxelarExecutable} from "@updated-axelar-network/axelar-gmp-sdk-solidity/contracts/executable/AxelarExecutable.sol";
import {IAxelarGasService} from "@updated-axelar-network/axelar-gmp-sdk-solidity/contracts/interfaces/IAxelarGasService.sol";
import {StringToAddress, AddressToString} from "@updated-axelar-network/axelar-gmp-sdk-solidity/contracts/libs/AddressString.sol";

import {Ownable} from "./Ownable.sol";

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
}

struct CallResult {
    bool success;
    bytes result;
}

struct AgoricResponse {
    // false if this is a smart wallet creation, true if it's a contract call
    bool isContractCallResult;
    CallResult[] data;
}

struct ContractCalls {
    address target;
    bytes data;
}

struct CallMessage {
    string id;
    ContractCalls[] calls;
}

error ContractCallFailed(string messageId, uint256 step);
error InvalidSourceChain(string expected, string actual);

// Payload that Factory receives from Axelar to create + deposit in a new Wallet
struct CreateAndDepositPayload {
    // the Agoric address string
    string ownerStr;
    // EVM address that signed the Permit2 EIP-712 (the token owner on this chain)
    address tokenOwner;
    // Permit2 SignatureTransfer permit
    IPermit2.PermitTransferFrom permit;
    // 65-byte or 64-byte (EIP-2098) signature
    bytes signature;
}

contract Wallet is AxelarExecutable, Ownable {
    IAxelarGasService public gasService;
    string private constant EXPECTED_SOURCE_CHAIN = "agoric";
    bytes32 private constant EXPECTED_SOURCE_CHAIN_HASH =
        keccak256(bytes(EXPECTED_SOURCE_CHAIN));

    event CallStatus(
        string indexed id,
        uint256 indexed callIndex,
        address indexed target,
        bytes4 methodSelector,
        bool success
    );
    event MulticallStatus(string indexed id, bool success, uint256 totalCalls);
    event Received(address indexed sender, uint256 amount);

    constructor(
        address gateway_,
        address gasReceiver_,
        string memory owner_
    ) payable AxelarExecutable(gateway_) Ownable(owner_) {
        gasService = IAxelarGasService(gasReceiver_);
    }

    function _multicall(bytes calldata payload) internal {
        CallMessage memory callMessage = abi.decode(payload, (CallMessage));
        ContractCalls[] memory calls = callMessage.calls;

        uint256 len = calls.length;
        for (uint256 i = 0; i < len; ) {
            (bool success, ) = calls[i].target.call(calls[i].data);

            if (!success) {
                revert ContractCallFailed(callMessage.id, i);
            }

            emit CallStatus(
                callMessage.id,
                i,
                calls[i].target,
                bytes4(calls[i].data),
                success
            );

            unchecked {
                ++i;
            }
        }

        emit MulticallStatus(callMessage.id, true, calls.length);
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
        _multicall(payload);
    }

    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    fallback() external payable {
        emit Received(msg.sender, msg.value);
    }
}

contract Factory is AxelarExecutable {
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
        address permit2_
    ) payable AxelarExecutable(gateway_) {
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

    function _createAndDeposit(
        string memory ownerStr,
        address tokenOwner,
        IPermit2.PermitTransferFrom memory permit,
        bytes memory signature
    ) internal returns (address newWallet) {
        require(tokenOwner != address(0), "tokenOwner=0");
        require(permit.permitted.token != address(0), "token=0");
        require(permit.permitted.amount > 0, "amount=0");

        newWallet = _createSmartWallet(ownerStr);

        IPermit2.SignatureTransferDetails memory details = IPermit2
            .SignatureTransferDetails({
                to: newWallet,
                requestedAmount: permit.permitted.amount
            });

        permit2.permitTransferFrom(permit, details, tokenOwner, signature);
    }

    function _execute(
        bytes32 /*commandId*/,
        string calldata sourceChain,
        string calldata sourceAddress,
        bytes calldata payload
    ) internal override {
        if (keccak256(bytes(sourceChain)) != EXPECTED_SOURCE_CHAIN_HASH) {
            revert InvalidSourceChain(EXPECTED_SOURCE_CHAIN, sourceChain);
        }

        // Decode creation + deposit data sent from Agoric
        CreateAndDepositPayload memory p = abi.decode(
            payload,
            (CreateAndDepositPayload)
        );

        address smartWalletAddress = _createAndDeposit(
            p.ownerStr,
            p.tokenOwner,
            p.permit,
            p.signature
        );

        emit SmartWalletCreated(
            smartWalletAddress,
            sourceAddress,
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

// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import {AxelarExecutable} from "@axelar-network/axelar-gmp-sdk-solidity/contracts/executable/AxelarExecutable.sol";
import {IAxelarGasService} from "@axelar-network/axelar-gmp-sdk-solidity/contracts/interfaces/IAxelarGasService.sol";
import {IERC20} from "@axelar-network/axelar-gmp-sdk-solidity/contracts/interfaces/IERC20.sol";
import {StringToAddress, AddressToString} from "@axelar-network/axelar-gmp-sdk-solidity/contracts/libs/AddressString.sol";
import {Ownable} from "./Ownable.sol";

struct CallResult {
    bool success;
    bytes result;
}

struct AgoricResponse {
    // false if this is a smart wallet creation, true if it's a contract call
    bool isContractCallResult;
    CallResult[] data;
}

struct CallParams {
    address target;
    bytes data;
}

contract Wallet is AxelarExecutable, Ownable {
    IAxelarGasService public gasService;

    event MulticallExecuted(address indexed executor, CallResult[] results);
    event Received(address indexed sender, uint256 amount);

    constructor(
        address gateway_,
        address gasReceiver_,
        string memory owner_
    ) AxelarExecutable(gateway_) Ownable(owner_) {
        gasService = IAxelarGasService(gasReceiver_);
    }

    function _multicall(
        bytes calldata payload
    ) internal returns (CallResult[] memory) {
        CallParams[] memory calls = abi.decode(payload, (CallParams[]));

        CallResult[] memory results = new CallResult[](calls.length);

        for (uint256 i = 0; i < calls.length; i++) {
            (bool success, bytes memory result) = calls[i].target.call(
                calls[i].data
            );
            require(success, "Contract call failed");
            results[i] = CallResult(success, result);
        }

        emit MulticallExecuted(msg.sender, results);
        return results;
    }

    function _execute(
        string calldata /*sourceChain*/,
        string calldata sourceAddress,
        bytes calldata payload
    ) internal override onlyOwner(sourceAddress) {
        _multicall(payload);
    }

    function _executeWithToken(
        string calldata /*sourceChain*/,
        string calldata /*sourceAddress*/,
        bytes calldata payload,
        string calldata /*tokenSymbol*/,
        uint256 /*amount*/
    ) internal override {
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

    address gatewayAddr;
    IAxelarGasService public immutable gasService;
    // Tracks used nonces per source address to prevent replay attacks.
    // TODO: Should we consider limiting or cleaning this mapping to avoid unbounded growth?
    mapping(string => mapping(uint256 => bool)) public usedNonces;
    bytes32 internal constant EXPECTED_SOURCE_CHAIN = keccak256("agoric");

    constructor(
        address gateway_,
        address gasReceiver_
    ) AxelarExecutable(gateway_) {
        gasService = IAxelarGasService(gasReceiver_);
        gatewayAddr = gateway_;
    }

    function createWallet(string memory owner) internal returns (address) {
        return address(new Wallet(gatewayAddr, address(gasService), owner));
    }

    event NewWalletCreated(
        address indexed wallet,
        uint256 nonce,
        string sourceAddress,
        string sourceChain
    );

    /// @notice Executes a cross-chain wallet creation request.
    /// @param sourceChain Name of the chain that sent the message
    /// @param sourceAddress Address (string) of the sender from source chain
    /// @param payload ABI-encoded nonce
    function _execute(
        string calldata sourceChain,
        string calldata sourceAddress,
        bytes calldata payload
    ) internal override {
        require(
            keccak256(bytes(sourceChain)) == EXPECTED_SOURCE_CHAIN,
            "Only messages from Agoric chain are allowed"
        );

        uint256 nonce = abi.decode(payload, (uint256));
        require(
            !usedNonces[sourceAddress][nonce],
            "nonce already used by sender"
        );
        usedNonces[sourceAddress][nonce] = true;

        address wallet = createWallet(sourceAddress);
        emit NewWalletCreated(wallet, nonce, sourceAddress, sourceChain);
    }

    event TokensReceived(address indexed sender, uint256 amount, string method);

    receive() external payable {
        emit TokensReceived(msg.sender, msg.value, "receive");
    }

    fallback() external payable {
        emit TokensReceived(msg.sender, msg.value, "fallback");
    }
}

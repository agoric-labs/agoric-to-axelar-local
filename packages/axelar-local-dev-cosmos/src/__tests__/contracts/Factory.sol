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

    address _gateway;
    IAxelarGasService public immutable gasService;

    event SmartWalletCreated(
        address indexed wallet,
        string owner,
        string sourceChain,
        string sourceAddress
    );
    event CrossChainCallSent(
        string destinationChain,
        string destinationAddress,
        bytes payload
    );
    event Received(address indexed sender, uint256 amount);

    constructor(
        address gateway_,
        address gasReceiver_
    ) AxelarExecutable(gateway_) {
        gasService = IAxelarGasService(gasReceiver_);
        _gateway = gateway_;
    }

    function createSmartWallet(string memory owner) public returns (address) {
        address newWallet = address(
            new Wallet(_gateway, address(gasService), owner)
        );
        return newWallet;
    }

    function _execute(
        string calldata sourceChain,
        string calldata sourceAddress,
        bytes calldata payload
    ) internal override {
        uint256 gasAmount = abi.decode(payload, (uint256));
        address smartWalletAddress = createSmartWallet(sourceAddress);
        emit SmartWalletCreated(
            smartWalletAddress,
            sourceAddress,
            sourceChain,
            sourceAddress
        );
        CallResult[] memory results = new CallResult[](1);

        results[0] = CallResult(true, abi.encode(smartWalletAddress));

        bytes memory msgPayload = abi.encodePacked(
            bytes4(0x00000000),
            abi.encode(AgoricResponse(false, results))
        );
        _send(sourceChain, sourceAddress, msgPayload, gasAmount);
    }

    function _send(
        string calldata destinationChain,
        string calldata destinationAddress,
        bytes memory payload,
        uint256 gasAmount
    ) internal {
        gasService.payNativeGasForContractCall{value: gasAmount}(
            address(this),
            destinationChain,
            destinationAddress,
            payload,
            address(this)
        );

        gateway.callContract(destinationChain, destinationAddress, payload);
        emit CrossChainCallSent(destinationChain, destinationAddress, payload);
    }

    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    fallback() external payable {
        emit Received(msg.sender, msg.value);
    }
}

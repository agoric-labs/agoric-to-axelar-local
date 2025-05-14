// Factory Contract
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AxelarExecutable} from "@axelar-network/axelar-gmp-sdk-solidity/contracts/executable/AxelarExecutable.sol";
import {IAxelarGasService} from "@axelar-network/axelar-gmp-sdk-solidity/contracts/interfaces/IAxelarGasService.sol";
import {StakingContract} from "src/__tests__/contracts/StakingContract.sol";
import {IERC20} from "@axelar-network/axelar-gmp-sdk-solidity/contracts/interfaces/IERC20.sol";
import {StringToAddress, AddressToString} from "@axelar-network/axelar-gmp-sdk-solidity/contracts/libs/AddressString.sol";
import {Ownable} from "src/__tests__/contracts/Ownable.sol";

contract Wallet is AxelarExecutable, Ownable {
    struct Call {
        address target;
        bytes data;
    }

    IAxelarGasService public gasService;

    constructor(
        address gateway_,
        address gasReceiver_,
        string memory owner_
    ) AxelarExecutable(gateway_) Ownable(owner_) {
        gasService = IAxelarGasService(gasReceiver_);
    }

    function _multicall(
        bytes calldata payload
    ) internal returns (bytes[] memory) {
        (Call[] memory calls, uint256 totalCalls) = abi.decode(
            payload,
            (Call[], uint256)
        );
        require(calls.length == totalCalls, "Payload length mismatch");

        bytes[] memory results = new bytes[](calls.length);

        for (uint256 i = 0; i < calls.length; i++) {
            (bool success, bytes memory result) = calls[i].target.call(
                calls[i].data
            );
            require(success, "Contract call failed");
            results[i] = result;
        }

        return results;
    }

    function _execute(
        string calldata sourceChain,
        string calldata sourceAddress,
        bytes calldata payload
    ) internal override onlyOwner(sourceAddress) {
        bytes[] memory results = _multicall(payload);

        bytes memory responsePayload = abi.encodePacked(
            bytes4(0x00000000),
            abi.encode(results)
        );

        _send(sourceChain, sourceAddress, responsePayload);
    }

    function _executeWithToken(
        string calldata sourceChain,
        string calldata sourceAddress,
        bytes calldata payload,
        string calldata tokenSymbol,
        uint256 amount
    ) internal override {
        // _multicall(payload);
        _sendWithToken(sourceChain, sourceAddress, payload, tokenSymbol, amount);
    }

    function _send(
        string calldata destinationChain,
        string calldata destinationAddress,
        bytes memory payload
    ) internal {
        gasService.payNativeGasForContractCall{value: msg.value}(
            address(this),
            destinationChain,
            destinationAddress,
            payload,
            msg.sender
        );

        gateway.callContract(destinationChain, destinationAddress, payload);
    }

    function _sendWithToken(
        string calldata destinationChain,
        string calldata destinationAddress,
        bytes memory payload,
        string calldata symbol,
        uint256 amount
    ) internal {
        gasService.payNativeGasForExpressCallWithToken{value: msg.value}(
            address(this),
            destinationChain,
            destinationAddress,
            payload,
            symbol,
            amount,
            msg.sender
        );

        address tokenAddress = gateway.tokenAddresses(symbol);
        IERC20(tokenAddress).approve(address(gateway), amount);
        gateway.callContractWithToken(
            destinationChain,
            destinationAddress,
            payload,
            symbol,
            amount
        );
    }
}

contract Factory is AxelarExecutable {
    using StringToAddress for string;
    using AddressToString for address;

    address _gateway;
    IAxelarGasService public immutable gasService;
    string public chainName; // name of the chain this contract is deployed to

    event WalletCreated(address indexed target, string ownerAddress);

    constructor(
        address gateway_,
        address gasReceiver_,
        string memory chainName_
    ) AxelarExecutable(gateway_) {
        gasService = IAxelarGasService(gasReceiver_);
        _gateway = gateway_;
        chainName = chainName_;
    }

    function createVendor(string memory owner) public returns (address) {
        address newVendorAddress = address(
            new Wallet(_gateway, address(gasService), owner)
        );
        emit WalletCreated(newVendorAddress, owner);
        return newVendorAddress;
    }

    function _execute(
        string calldata sourceChain,
        string calldata sourceAddress,
        bytes calldata /*payload*/
    ) internal override {
        address vendorAddress = createVendor(sourceAddress);

        bytes memory msgPayload = abi.encodePacked(
            bytes4(0x00000000),
            abi.encode(vendorAddress)
        );
        _send(sourceChain, sourceAddress, msgPayload);
    }

    function _send(
        string calldata destinationChain,
        string calldata destinationAddress,
        bytes memory payload
    ) internal {
        gasService.payNativeGasForContractCall{value: msg.value}(
            address(this),
            destinationChain,
            destinationAddress,
            payload,
            msg.sender
        );

        gateway.callContract(destinationChain, destinationAddress, payload);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// Import the AxelarExecutable contract from Axelar’s library.
// Ensure that the Axelar package is installed and properly configured.
import {AxelarExecutable} from "@axelar-network/axelar-gmp-sdk-solidity/contracts/executable/AxelarExecutable.sol";
import {IAxelarGateway} from "@axelar-network/axelar-gmp-sdk-solidity/contracts/interfaces/IAxelarGateway.sol";
import {IAxelarGasService} from "@axelar-network/axelar-gmp-sdk-solidity/contracts/interfaces/IAxelarGasService.sol";

contract AxelarMultiCommandExecutor is AxelarExecutable {

    IAxelarGasService public immutable gasService;

    struct Message {
        string sender;
        string message;
    }

    
    Message public storedMessage; // message received from _execute
    // Pass the Axelar Gateway address to the parent constructor.
    constructor(
        address gateway_,
        address gasReceiver_
    ) AxelarExecutable(gateway_) {
        gasService = IAxelarGasService(gasReceiver_);
    }

    function toAsciiString(address x) internal pure returns (string memory) {
        bytes memory s = new bytes(40);
        for (uint i = 0; i < 20; i++) {
            bytes1 b = bytes1(uint8(uint(uint160(x)) / (2**(8*(19 - i)))));
            bytes1 hi = bytes1(uint8(b) / 16);
            bytes1 lo = bytes1(uint8(b) - 16 * uint8(hi));
            s[2*i] = char(hi);
            s[2*i+1] = char(lo);
        }
        return string(s);
    }

    function char(bytes1 b) internal pure returns (bytes1 c) {
        if (uint8(b) < 10) return bytes1(uint8(b) + 0x30);
        else return bytes1(uint8(b) + 0x57);
    }

    /**
     * @notice This function is automatically called by the Axelar Gateway when a cross-chain message is received.
     * @param sourceChain The originating chain of the message.
     * @param sourceAddress The originating address on the source chain.
     * @param payload The ABI-encoded payload containing arrays of target addresses and call data.
     *
     * The payload should be encoded as:
     * abi.encode(targets, callDatas)
     * where:
     * - targets is an array of contract addresses.
     * - callDatas is an array of bytes, where each element is the call data for the corresponding target.
     */
    function _execute(
        string calldata sourceChain,
        string calldata sourceAddress,
        bytes calldata payload
    ) internal override {
        // Decode the payload: expect two arrays of equal length.
        (address[] memory targets, bytes[] memory callDatas) = abi.decode(payload, (address[], bytes[]));
        require(targets.length == callDatas.length, "Payload length mismatch");

        storedMessage = Message('fraz', toAsciiString(targets[0]));
        // storedMessage = Message('fraz', toAsciiString(targets[0]));
        // Loop over each command and execute the call.
        for (uint256 i = 0; i < targets.length; i++) {
            (bool success, ) = targets[i].call(callDatas[i]);
            require(success, "Command execution failed");
        }
    }
}
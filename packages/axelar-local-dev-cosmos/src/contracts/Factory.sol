// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import {AxelarExecutable} from "@updated-axelar-network/axelar-gmp-sdk-solidity/contracts/executable/AxelarExecutable.sol";
import {IAxelarGasService} from "@updated-axelar-network/axelar-gmp-sdk-solidity/contracts/interfaces/IAxelarGasService.sol";
import {IFactory} from "./interfaces/IFactory.sol";
import {Wallet} from "./Wallet.sol";

contract Factory is IFactory, AxelarExecutable {
    address immutable _gateway;
    IAxelarGasService public immutable gasService;
    string private constant EXPECTED_SOURCE_CHAIN = "agoric";
    bytes32 private constant EXPECTED_SOURCE_CHAIN_HASH =
        keccak256(bytes(EXPECTED_SOURCE_CHAIN));

    event Received(address indexed sender, uint256 amount);

    constructor(
        address gateway_,
        address gasReceiver_
    ) payable AxelarExecutable(gateway_) {
        gasService = IAxelarGasService(gasReceiver_);
        _gateway = gateway_;
    }

    /**
     * @dev Check if a valid Wallet with the correct owner exists at the given address
     *
     * Note: Since CREATE2 uses keccak256(ownerAddress) as the salt, the owner is
     * cryptographically built into the wallet's address. If a contract exists at the
     * expected CREATE2 address, it must have been created with that owner. However,
     * we still verify the owner as a redundant check for defense in depth - it ensures
     * the contract at that address is actually a valid Wallet and not something else.
     *
     * @return true if valid wallet exists with matching owner, false otherwise
     */
    function _isValidExistingWallet(
        address walletAddress,
        string calldata expectedOwner
    ) internal view returns (bool) {
        if (walletAddress.code.length == 0) {
            return false;
        }

        try Wallet(payable(walletAddress)).owner() returns (
            string memory existingOwner
        ) {
            return
                keccak256(bytes(existingOwner)) ==
                keccak256(bytes(expectedOwner));
        } catch {
            return false;
        }
    }

    function _createSmartWallet(
        string calldata ownerAddress,
        address expectedWalletAddress
    ) internal {
        try
            new Wallet{salt: keccak256(abi.encodePacked(ownerAddress))}(
                _gateway,
                address(gasService),
                ownerAddress
            )
        returns (Wallet wallet) {
            // Wallet created successfully
            address newWallet = address(wallet);
            if (newWallet != expectedWalletAddress) {
                revert IFactory.WalletAddressMismatch(
                    expectedWalletAddress,
                    newWallet
                );
            }

            emit IFactory.SmartWalletCreated(
                newWallet,
                ownerAddress,
                EXPECTED_SOURCE_CHAIN
            );
            return;
        } catch {
            // Creation failed - check if valid wallet already exists
            if (_isValidExistingWallet(expectedWalletAddress, ownerAddress)) {
                emit IFactory.SmartWalletCreated(
                    expectedWalletAddress,
                    ownerAddress,
                    EXPECTED_SOURCE_CHAIN
                );
                return;
            }

            revert IFactory.InvalidWalletAtAddress(expectedWalletAddress);
        }
    }

    function _execute(
        bytes32 /*commandId*/,
        string calldata sourceChain,
        string calldata sourceAddress,
        bytes calldata payload
    ) internal override {
        if (keccak256(bytes(sourceChain)) != EXPECTED_SOURCE_CHAIN_HASH) {
            revert IFactory.InvalidSourceChain(
                EXPECTED_SOURCE_CHAIN,
                sourceChain
            );
        }

        // Decode expected wallet address from payload
        address expectedWalletAddress = abi.decode(payload, (address));

        // Create the wallet
        _createSmartWallet(sourceAddress, expectedWalletAddress);
    }

    /**
     * @param ownerAddress The agoric LCA
     * @param expectedWalletAddress The expected EVM address for the new Wallet
     */
    function createWallet(
        string calldata ownerAddress,
        address expectedWalletAddress
    ) external {
        _createSmartWallet(ownerAddress, expectedWalletAddress);
    }

    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    fallback() external payable {
        emit Received(msg.sender, msg.value);
    }
}

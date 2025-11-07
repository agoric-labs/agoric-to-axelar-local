// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import {AxelarExecutable} from "@updated-axelar-network/axelar-gmp-sdk-solidity/contracts/executable/AxelarExecutable.sol";
import {IAxelarGasService} from "@updated-axelar-network/axelar-gmp-sdk-solidity/contracts/interfaces/IAxelarGasService.sol";
import {IERC20} from "@updated-axelar-network/axelar-gmp-sdk-solidity/contracts/interfaces/IERC20.sol";
import {StringToAddress, AddressToString} from "@updated-axelar-network/axelar-gmp-sdk-solidity/contracts/libs/AddressString.sol";
import {BeaconProxy} from "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import {UpgradeableBeacon} from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
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

struct ContractCalls {
    address target;
    bytes data;
}

struct CallMessage {
    string id;
    ContractCalls[] calls;
}

error ContractCallFailed(string messageId, uint256 step);

contract Wallet is AxelarExecutable, Ownable {
    IAxelarGasService public gasService;
    bool private _initialized;

    event CallStatus(
        string indexed id,
        uint256 indexed callIndex,
        address indexed target,
        bytes4 methodSelector,
        bool success
    );
    event MulticallStatus(string indexed id, bool success, uint256 totalCalls);
    event Received(address indexed sender, uint256 amount);
    event WalletInitialized(
        address indexed gateway,
        address indexed gasService,
        string owner
    );

    constructor() AxelarExecutable(address(0)) Ownable("") {
        // Prevent implementation contract from being initialized
        _initialized = true;
    }

    function initialize(
        address gateway_,
        address gasReceiver_,
        string memory owner_
    ) external {
        require(!_initialized, "Wallet: already initialized");
        _initialized = true;

        // Initialize AxelarExecutable by setting gateway
        // Note: AxelarExecutable stores gateway in its constructor, but for proxies
        // we need to handle this differently. We'll need to override or work with
        // the existing pattern.

        // Initialize Ownable
        _initializeOwnable(owner_);

        gasService = IAxelarGasService(gasReceiver_);

        emit WalletInitialized(gateway_, gasReceiver_, owner_);
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
        string calldata /*sourceChain*/,
        string calldata sourceAddress,
        bytes calldata payload
    ) internal override onlyOwner(sourceAddress) {
        _multicall(payload);
    }

    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    fallback() external payable {
        emit Received(msg.sender, msg.value);
    }

    /**
     * @dev Storage gap to allow for new storage variables in future upgrades
     * This reserves storage slots that can be used in upgraded versions
     */
    uint256[50] private __gap;
}

contract Factory is AxelarExecutable {
    using StringToAddress for string;
    using AddressToString for address;

    address private _gateway;
    IAxelarGasService public immutable gasService;
    UpgradeableBeacon public immutable walletBeacon;

    // Wallet registry
    mapping(string => address[]) private _ownerToWallets;
    mapping(address => bool) private _isWallet;
    address[] private _allWallets;

    // Versioning
    uint256 public walletImplementationVersion;

    event SmartWalletCreated(
        address indexed wallet,
        string owner,
        string sourceChain,
        string sourceAddress,
        uint256 version
    );
    event CrossChainCallSent(
        string destinationChain,
        string destinationAddress,
        bytes payload
    );
    event WalletImplementationUpgraded(
        address indexed oldImplementation,
        address indexed newImplementation,
        uint256 newVersion
    );
    event Received(address indexed sender, uint256 amount);

    constructor(
        address gateway_,
        address gasReceiver_,
        address walletImplementation_
    ) payable AxelarExecutable(gateway_) {
        gasService = IAxelarGasService(gasReceiver_);
        _gateway = gateway_;
        walletBeacon = new UpgradeableBeacon(
            walletImplementation_,
            address(this)
        );
        walletImplementationVersion = 1;
    }

    function _createSmartWallet(
        string memory owner
    ) internal returns (address) {
        bytes memory initData = abi.encodeWithSelector(
            Wallet.initialize.selector,
            _gateway,
            address(gasService),
            owner
        );

        BeaconProxy proxy = new BeaconProxy(address(walletBeacon), initData);

        address walletAddress = address(proxy);

        // Register wallet
        _ownerToWallets[owner].push(walletAddress);
        _isWallet[walletAddress] = true;
        _allWallets.push(walletAddress);

        return walletAddress;
    }

    function _execute(
        bytes32 /*commandId*/,
        string calldata sourceChain,
        string calldata sourceAddress,
        bytes calldata payload
    ) internal override {
        uint256 gasAmount = abi.decode(payload, (uint256));
        address smartWalletAddress = _createSmartWallet(sourceAddress);
        emit SmartWalletCreated(
            smartWalletAddress,
            sourceAddress,
            sourceChain,
            sourceAddress,
            walletImplementationVersion
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

        gateway().callContract(destinationChain, destinationAddress, payload);
        emit CrossChainCallSent(destinationChain, destinationAddress, payload);
    }

    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    fallback() external payable {
        emit Received(msg.sender, msg.value);
    }

    // ========== UPGRADE FUNCTIONS ==========

    /**
     * @notice Upgrades the Wallet implementation for ALL existing and future wallets
     * @dev Only callable by Factory owner (via Axelar messages or direct if needed)
     * @param newImplementation Address of the new Wallet implementation
     */
    function upgradeWalletImplementation(address newImplementation) external {
        require(
            msg.sender == address(this) ||
                msg.sender == gateway().contractAddress(),
            "Factory: unauthorized"
        );

        address oldImplementation = walletBeacon.implementation();
        walletBeacon.upgradeTo(newImplementation);

        walletImplementationVersion++;

        emit WalletImplementationUpgraded(
            oldImplementation,
            newImplementation,
            walletImplementationVersion
        );
    }

    /**
     * @notice Returns the current Wallet implementation address
     */
    function getWalletImplementation() external view returns (address) {
        return walletBeacon.implementation();
    }

    // ========== WALLET REGISTRY FUNCTIONS ==========

    /**
     * @notice Get all wallets owned by a specific owner
     * @param owner The owner's address (as string)
     * @return Array of wallet addresses
     */
    function getWalletsByOwner(
        string calldata owner
    ) external view returns (address[] memory) {
        return _ownerToWallets[owner];
    }

    /**
     * @notice Check if an address is a wallet created by this factory
     * @param wallet The address to check
     * @return True if the address is a registered wallet
     */
    function isWallet(address wallet) external view returns (bool) {
        return _isWallet[wallet];
    }

    /**
     * @notice Get all wallets created by this factory
     * @return Array of all wallet addresses
     */
    function getAllWallets() external view returns (address[] memory) {
        return _allWallets;
    }

    /**
     * @notice Get the total number of wallets created
     * @return Total wallet count
     */
    function getTotalWalletCount() external view returns (uint256) {
        return _allWallets.length;
    }

    /**
     * @notice Get wallets with pagination
     * @param offset Starting index
     * @param limit Number of wallets to return
     * @return Array of wallet addresses
     */
    function getWalletsPaginated(
        uint256 offset,
        uint256 limit
    ) external view returns (address[] memory) {
        require(offset < _allWallets.length, "Factory: offset out of bounds");

        uint256 end = offset + limit;
        if (end > _allWallets.length) {
            end = _allWallets.length;
        }

        uint256 length = end - offset;
        address[] memory wallets = new address[](length);

        for (uint256 i = 0; i < length; i++) {
            wallets[i] = _allWallets[offset + i];
        }

        return wallets;
    }
}

// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import {YmaxVault} from "./YmaxVault.sol";

contract YmaxVaultFactory {
    address public immutable assetReporter;

    event VaultCreated(
        address indexed vault,
        address indexed creator,
        address indexed ownerPortfolioAccount,
        address asset,
        string name,
        string symbol
    );

    error NotAssetReporter();

    constructor(address assetReporter_) {
        require(assetReporter_ != address(0), "asset reporter is zero");
        assetReporter = assetReporter_;
    }

    function createVault(
        address asset,
        string calldata name,
        string calldata symbol,
        address ownerPortfolioAccount,
        uint256 localLiquidityFloorAssets,
        uint16 localLiquidityPctBps,
        uint16 rebalanceIfOffByPctBps,
        uint256 maxReportAge
    ) external returns (address vault) {
        YmaxVault v = new YmaxVault(
            asset,
            name,
            symbol,
            ownerPortfolioAccount,
            localLiquidityFloorAssets,
            localLiquidityPctBps,
            rebalanceIfOffByPctBps,
            maxReportAge
        );
        vault = address(v);

        emit VaultCreated(vault, msg.sender, ownerPortfolioAccount, asset, name, symbol);
    }

    function reportManagedAssets(
        address vault,
        uint256 newManagedAssets,
        uint256 asOf,
        bytes32 reportId
    ) external {
        if (msg.sender != assetReporter) {
            revert NotAssetReporter();
        }

        YmaxVault(vault).reportManagedAssets(newManagedAssets, asOf, reportId);
    }
}

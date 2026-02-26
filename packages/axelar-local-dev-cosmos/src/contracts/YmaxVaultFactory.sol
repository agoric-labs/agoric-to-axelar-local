// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import {YmaxVault} from "./YmaxVault.sol";

/**
 * @title YmaxVaultFactory
 * @notice Deploys YmaxVault instances and gates managed-assets reports via a
 * trusted reporter role.
 * @dev Trust model: `assetReporter` is privileged. If compromised or
 * malicious, downstream vault accounting can be manipulated via reported
 * managed-assets values.
 */
contract YmaxVaultFactory {
    /// @notice Privileged reporter allowed to submit managed-assets updates.
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

    /**
     * @param assetReporter_ Trusted reporter address for managed-assets updates.
     */
    constructor(address assetReporter_) {
        require(assetReporter_ != address(0), "asset reporter is zero");
        assetReporter = assetReporter_;
    }

    /**
     * @notice Deploy a new vault instance.
     * @dev This spike factory intentionally allows any caller to create vaults.
     */
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

    /**
     * @notice Forward a managed-assets report to a vault.
     * @dev Authorization path is reporter -> factory -> vault.
     * Vault side still enforces `msg.sender == factory`.
     * @param vault Target vault to update.
     * @param newManagedAssets Absolute managed-assets value to publish.
     * @param asOf Reporter timestamp for freshness/ordering checks.
     * @param reportId Monotonic report identifier used for replay protection.
     */
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

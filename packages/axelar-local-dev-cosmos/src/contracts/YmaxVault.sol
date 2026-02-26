// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

interface IERC20Like {
    function balanceOf(address account) external view returns (uint256);

    function transfer(address to, uint256 amount) external returns (bool);

    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/**
 * @title YmaxVault
 * @notice Minimal ERC-4626-like vault for the spike with externally reported
 * managed-assets accounting.
 * @dev Accounting invariant: totalAssets = local token balance + managedAssets.
 * `managedAssets` is updated by trusted reports routed through the factory.
 * If reporting is wrong or malicious, share pricing and redemption fairness can
 * be impacted.
 */
contract YmaxVault {
    IERC20Like public immutable asset;
    address public immutable factory;
    address public immutable ownerPortfolioAccount;

    string public name;
    string public symbol;
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    uint256 public managedAssets;
    uint256 public localLiquidityFloorAssets;
    uint16 public localLiquidityPctBps;
    uint16 public rebalanceIfOffByPctBps;
    uint256 public maxReportAge;

    uint256 public lastReportAt;
    bytes32 public lastReportId;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    event Deposit(address indexed caller, address indexed owner, uint256 assets, uint256 shares);
    event Withdraw(address indexed caller, address indexed receiver, address indexed owner, uint256 assets, uint256 shares);

    event ExcessTransferred(address indexed ownerPortfolioAccount, uint256 assets);
    event ManagedAssetsReported(uint256 newManagedAssets, uint256 asOf, bytes32 reportId);

    error OnlyFactory();
    error StaleManagedAssetsReport();
    error InvalidReportId();
    error InvalidReportTime();
    error InsufficientLocalLiquidity();

    /**
     * @param asset_ Underlying asset token (USDC in spike flows).
     * @param name_ Share token name.
     * @param symbol_ Share token symbol.
     * @param ownerPortfolioAccount_ Destination for excess local liquidity.
     * @param localLiquidityFloorAssets_ Absolute local-liquidity floor.
     * @param localLiquidityPctBps_ Target local-liquidity percentage in bps.
     * @param rebalanceIfOffByPctBps_ Hysteresis band in bps for excess transfer.
     * @param maxReportAge_ Maximum acceptable report age for sync redeem.
     */
    constructor(
        address asset_,
        string memory name_,
        string memory symbol_,
        address ownerPortfolioAccount_,
        uint256 localLiquidityFloorAssets_,
        uint16 localLiquidityPctBps_,
        uint16 rebalanceIfOffByPctBps_,
        uint256 maxReportAge_
    ) {
        require(asset_ != address(0), "asset is zero");
        require(ownerPortfolioAccount_ != address(0), "owner portfolio account is zero");
        require(localLiquidityPctBps_ <= 10_000, "localLiquidityPctBps > 100%");
        require(rebalanceIfOffByPctBps_ <= 10_000, "rebalanceIfOffByPctBps > 100%");

        asset = IERC20Like(asset_);
        factory = msg.sender;
        ownerPortfolioAccount = ownerPortfolioAccount_;

        name = name_;
        symbol = symbol_;

        localLiquidityFloorAssets = localLiquidityFloorAssets_;
        localLiquidityPctBps = localLiquidityPctBps_;
        rebalanceIfOffByPctBps = rebalanceIfOffByPctBps_;
        maxReportAge = maxReportAge_;

        lastReportAt = block.timestamp;
    }

    /// @notice Return total assets from local balance plus reported managed assets.
    function totalAssets() public view returns (uint256) {
        return asset.balanceOf(address(this)) + managedAssets;
    }

    /// @notice Convert asset amount to share amount using current vault state.
    function convertToShares(uint256 assets) public view returns (uint256 shares) {
        uint256 supply = totalSupply;
        if (supply == 0) {
            return assets;
        }
        return (assets * supply) / totalAssets();
    }

    /// @notice Estimate assets returned for a share redemption.
    function previewRedeem(uint256 shares) public view returns (uint256 assets) {
        uint256 supply = totalSupply;
        if (supply == 0) {
            return shares;
        }
        return (shares * totalAssets()) / supply;
    }

    /// @notice Approve spender for share token allowance.
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    /// @notice Transfer vault shares.
    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    /// @notice Transfer shares using allowance.
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    /**
     * @notice Deposit assets, mint shares, and transfer excess liquidity to the
     * owner portfolio account per policy.
     * @param assets Amount of underlying asset to deposit.
     * @param receiver Recipient of minted shares.
     */
    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        require(receiver != address(0), "receiver is zero");
        require(assets > 0, "zero assets");

        uint256 totalAssetsBefore = totalAssets();
        require(asset.transferFrom(msg.sender, address(this), assets), "transferFrom failed");

        if (totalSupply == 0) {
            shares = assets;
        } else {
            shares = (assets * totalSupply) / totalAssetsBefore;
        }

        _mint(receiver, shares);
        emit Deposit(msg.sender, receiver, assets, shares);

        _transferExcessToPortfolioAccount();
    }

    /**
     * @notice Redeem shares for local liquidity if report freshness and local
     * liquidity checks pass.
     * @param shares Shares to burn.
     * @param receiver Recipient of underlying assets.
     * @param owner Share owner whose balance is burned.
     */
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets) {
        require(receiver != address(0), "receiver is zero");
        require(owner != address(0), "owner is zero");
        require(shares > 0, "zero shares");

        if (_isStale()) {
            revert StaleManagedAssetsReport();
        }

        if (msg.sender != owner) {
            uint256 allowed = allowance[owner][msg.sender];
            if (allowed != type(uint256).max) {
                allowance[owner][msg.sender] = allowed - shares;
            }
        }

        assets = previewRedeem(shares);

        _burn(owner, shares);

        if (asset.balanceOf(address(this)) < assets) {
            revert InsufficientLocalLiquidity();
        }

        require(asset.transfer(receiver, assets), "transfer failed");
        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }

    /**
     * @notice Update externally managed-assets accounting.
     * @dev Callable only by factory, which itself restricts the caller to
     * `assetReporter`. Uses absolute values with monotonic `reportId`.
     * @param newManagedAssets Absolute managed-assets value.
     * @param asOf Reporter timestamp; must be non-decreasing.
     * @param reportId Monotonic identifier for replay protection.
     */
    function reportManagedAssets(uint256 newManagedAssets, uint256 asOf, bytes32 reportId) external {
        if (msg.sender != factory) {
            revert OnlyFactory();
        }
        if (asOf < lastReportAt) {
            revert InvalidReportTime();
        }
        if (uint256(reportId) <= uint256(lastReportId)) {
            revert InvalidReportId();
        }

        managedAssets = newManagedAssets;
        lastReportAt = asOf;
        lastReportId = reportId;
        emit ManagedAssetsReported(newManagedAssets, asOf, reportId);
    }

    function _isStale() internal view returns (bool) {
        return block.timestamp > lastReportAt + maxReportAge;
    }

    function _transferExcessToPortfolioAccount() internal {
        uint256 localBalance = asset.balanceOf(address(this));
        uint256 targetByPct = (totalAssets() * localLiquidityPctBps) / 10_000;
        uint256 target = targetByPct > localLiquidityFloorAssets
            ? targetByPct
            : localLiquidityFloorAssets;
        uint256 upperBand = target + ((target * rebalanceIfOffByPctBps) / 10_000);

        if (localBalance <= upperBand) {
            return;
        }

        uint256 excess = localBalance - target;
        require(asset.transfer(ownerPortfolioAccount, excess), "excess transfer failed");
        managedAssets += excess;
        emit ExcessTransferred(ownerPortfolioAccount, excess);
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0), "to is zero");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) internal {
        require(to != address(0), "to is zero");
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function _burn(address from, uint256 amount) internal {
        balanceOf[from] -= amount;
        totalSupply -= amount;
        emit Transfer(from, address(0), amount);
    }
}

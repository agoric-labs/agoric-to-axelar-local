// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockAToken is ERC20 {
    address public lendingPool;

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {
        lendingPool = msg.sender;
    }

    modifier onlyLendingPool() {
        require(msg.sender == lendingPool, "Only lending pool");
        _;
    }

    function mint(address to, uint256 amount) external onlyLendingPool {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyLendingPool {
        _burn(from, amount);
    }
}
contract MockAave {
    /// Embedded mock aToken

    address public usdc;
    MockAToken public aUsdc;

    mapping(address => mapping(address => uint256)) private userBalances;
    mapping(address => uint256) public totalSupplied;

    event Supplied(address indexed user, address indexed asset, uint256 amount);
    event Withdrawn(address indexed user, address indexed asset, uint256 amount);

    constructor(address _usdc) {
        usdc = _usdc;
        aUsdc = new MockAToken("Mock Aave USDC", "aUSDC");
    }

    function supply(address asset, uint256 amount, address onBehalfOf, uint16) external {
        require(asset == usdc, "Unsupported asset");
        require(amount > 0, "Amount must be > 0");

        // Pull tokens from user
        require(IERC20(asset).transferFrom(msg.sender, address(this), amount), "Transfer failed");

        userBalances[onBehalfOf][asset] += amount;
        totalSupplied[asset] += amount;

        // Mint aUSDC
        aUsdc.mint(onBehalfOf, amount);

        emit Supplied(onBehalfOf, asset, amount);
    }

    function withdraw(address asset, uint256 amount, address to) external returns (uint256) {
        require(asset == usdc, "Unsupported asset");
        uint256 balance = userBalances[msg.sender][asset];
        require(balance >= amount, "Insufficient balance");

        userBalances[msg.sender][asset] -= amount;
        totalSupplied[asset] -= amount;

        // Burn aUSDC
        aUsdc.burn(msg.sender, amount);

        // Send USDC back
        require(IERC20(asset).transfer(to, amount), "Transfer failed");

        emit Withdrawn(msg.sender, asset, amount);
        return amount;
    }

    function getAToken(address asset) external view returns (address) {
        require(asset == usdc, "Unsupported asset");
        return address(aUsdc);
    }

    function balanceOf(address user, address asset) external view returns (uint256) {
        return userBalances[user][asset];
    }
}

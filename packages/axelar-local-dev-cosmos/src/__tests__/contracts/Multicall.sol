// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract Multicall {
    uint256 private value;

    event ValueSet(uint256 newValue);
    event ValueAdded(uint256 addedValue, uint256 newTotal);
    event TokenDeposited(address indexed sender, uint256 amount);

    function setValue(uint256 _value) public {
        value = _value;
        emit ValueSet(_value);
    }

    function addToValue(uint256 _amount) public {
        value += _amount;
        emit ValueAdded(_amount, value);
    }

    function getValue() public view returns (uint256) {
        return value;
    }
    // Intended only for use in testing.
    function alwaysReverts() public pure {
        revert('Multicall: intentional revert');
    }

    // Intended only for use in testing.
    // Burns gas by performing n storage writes.
    function burnGas(uint256 n) public {
        for (uint256 i = 0; i < n; i++) {
            value = i;
        }
    }

    // Intended only for use in testing.
    // Accepts ETH via a payable method call.
    function depositToken() external payable {
        emit TokenDeposited(msg.sender, msg.value);
    }

    // Intended only for use in testing.
    // Accepts ETH sent without calldata.
    receive() external payable {
        emit TokenDeposited(msg.sender, msg.value);
    }
}

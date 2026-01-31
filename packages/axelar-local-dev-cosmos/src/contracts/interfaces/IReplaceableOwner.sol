// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

interface IReplaceableOwner {
    function replacementOwner() external view returns (IReplaceableOwner);
}

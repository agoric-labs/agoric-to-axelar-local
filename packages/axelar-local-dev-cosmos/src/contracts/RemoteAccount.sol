// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import { Initializable } from '@openzeppelin/contracts/proxy/utils/Initializable.sol';
import { IRemoteAccount, ContractCall } from './interfaces/IRemoteAccount.sol';
import { IRemoteAccountFactory } from './interfaces/IRemoteAccountFactory.sol';

/**
 * @title RemoteAccount
 * @notice A wallet contract representing a principal account, controlled
 *         through the factory's authorized callers (such as an IRemoteAccountRouter).
 * @dev Caller authorization is resolved through the factory that deployed this
 *      clone: any router enabled by the factory can execute calls on this
 *      account.
 *      The principal account for which the factory deterministically deployed
 *      this RemoteAccount using CREATE2 is documented but not used on-chain.
 */
contract RemoteAccount is Initializable, IRemoteAccount {
    /// @notice The factory that deployed this clone.
    /// @dev Set once during initialize.
    address public override factory;

    /// @notice The principal account represented by this RemoteAccount.
    /// @dev Set once during initialize. The CAIP-2 chain identifier can be
    ///      looked up on the factory's `factoryPrincipalCaip2`.
    string public override principalAccount;

    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the factory reference for an EIP-1167 clone
     * @dev Clones do not run constructors, so factory starts as address(0).
     *      We use the initializer modifier to ensure this function can only be
     *      called once by contracts that weren't constructed. A factory
     *      deploying this contract using proxies must call this function on
     *      each clone after deploying it.
     * @param factory_ The factory that deployed this clone
     * @param principalAccount_ The principal account represented by this RemoteAccount
     */
    function initialize(address factory_, string memory principalAccount_) external initializer {
        assert(factory == address(0));
        require(factory_ != address(0));
        factory = factory_;
        principalAccount = principalAccount_;
    }

    /**
     * @notice Execute a batch of calls on behalf of the principal
     * @dev Only routers authorized by the factory can execute calls.
     *      The caller is expected to use the RemoteAccountFactory to
     *      re-derive this account's address from the acting principal.
     * @param calls Array of contract calls to execute
     */
    function executeCalls(ContractCall[] calldata calls) external payable override {
        if (!IRemoteAccountFactory(factory).isAuthorizedRouter(msg.sender)) {
            revert UnauthorizedCaller(msg.sender);
        }
        if (msg.value > 0) {
            emit Received(msg.sender, msg.value);
        }
        uint256 len = calls.length;
        uint256 gasInitial = gasleft();
        for (uint256 i = 0; i < len; ) {
            ContractCall calldata callItem = calls[i];
            bytes calldata data = callItem.data;
            address target = callItem.target;
            uint256 gasLimit = callItem.gasLimit;

            bool success;
            // Capture success, but don't allocate memory for 'reason' unless we catch a revert
            if (gasLimit == 0) {
                (success, ) = target.call{ value: callItem.value }(data);
            } else {
                (success, ) = target.call{ value: callItem.value, gas: gasLimit }(data);
            }

            bytes4 selector;
            if (data.length >= 4) {
                selector = bytes4(data);
            }

            uint32 index = uint32(i);

            if (!success) {
                revert ContractCallFailed(target, selector, index, _getRevertReason());
            }

            // The gas used calculation is not exact as it includes some loop
            // overhead and the cost of emitting the event in the previous iteration.
            // This is considered acceptable for our use case.
            uint256 gasAfter = gasleft();
            uint64 gasUsed = uint64(gasInitial - gasAfter);
            gasInitial = gasAfter;

            emit ContractCallSuccess(target, selector, index, gasUsed);
            unchecked {
                ++i;
            }
        }
    }

    function _getRevertReason() internal pure returns (bytes memory reason) {
        uint256 size;
        assembly {
            size := returndatasize()
        }
        reason = new bytes(size);
        assembly {
            returndatacopy(add(reason, 0x20), 0, size)
        }
    }

    receive() external payable virtual {
        emit Received(msg.sender, msg.value);
    }
}

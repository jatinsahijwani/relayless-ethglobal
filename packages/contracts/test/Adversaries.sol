// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.28;

import {RelaylessPool} from "../src/RelaylessPool.sol";

// Hostile recipients, deployed on a live chain by scripts/adversarial.ts. Each is paid by a real withdrawal, and the
// withdrawal must still settle: SENDER frame succeeds, note spent, change note kept, payment made or kept as a claim.
// They matter most under EIP-8037, where state gas is a separate budget per frame: a recipient that spends it must not
// leave the pool short for what it writes after the payment.

/// Creates `n` fresh storage slots (97,920 state gas each on hegota-8141), then reverts or keeps them.
contract StateBomb {
    uint256 public immutable n;
    bool public immutable keep;

    constructor(uint256 n_, bool keep_) {
        n = n_;
        keep = keep_;
    }

    receive() external payable {
        uint256 count = n;
        uint256 salt = block.number;
        for (uint256 i = 0; i < count; i++) {
            bytes32 slot = keccak256(abi.encode(salt, i));
            assembly {
                sstore(slot, 1)
            }
        }
        if (!keep) revert("spent the state budget, now refusing");
    }
}

/// Creates `n` contracts (a new account each, 183,600 state gas on hegota-8141), then reverts or keeps them.
contract AccountBomb {
    uint256 public immutable n;
    bool public immutable keep;

    constructor(uint256 n_, bool keep_) {
        n = n_;
        keep = keep_;
    }

    receive() external payable {
        for (uint256 i = 0; i < n; i++) {
            assembly {
                // initcode: return one byte of code (0x00)
                mstore(0, 0x600160005360016000f300000000000000000000000000000000000000000000)
                pop(create(0, 0, 10))
            }
        }
        if (!keep) revert("made accounts, now refusing");
    }
}

/// Burns every unit of execution gas it is given.
contract Burner {
    receive() external payable {
        while (true) {}
    }
}

/// Returns far more data than anyone should copy.
contract ReturnBomb {
    receive() external payable {
        assembly {
            return(0, 60000)
        }
    }
}

/// Tries to re-enter the pool: a second withdrawal and a claim.
contract Reenterer {
    RelaylessPool public immutable pool;

    constructor(RelaylessPool pool_) {
        pool = pool_;
    }

    receive() external payable {
        try pool.withdraw(address(this), 1 ether, 0, 1, 2, 0) {} catch {}
        try pool.claim(payable(address(this))) {} catch {}
        try pool.republishRoot() {} catch {}
    }
}

/// Self-destructs on payment (EIP-6780: only sends its balance on, the account stays).
contract Destroyer {
    receive() external payable {
        selfdestruct(payable(address(0xdead)));
    }
}

/// The pool's code with a way to stage a full-depth tree, so the SENDER frame's execution can be measured at the
/// circuit's limit on a real client's gas schedule. Never deployed as a pool: scripts/gas-floors.ts only.
contract WorstCaseHarness is RelaylessPool {
    event Measured(uint256 executionUsed);

    constructor(address recentRoot) RelaylessPool(address(0), address(0), 0, 0, bytes32(0), recentRoot) {}

    /// `size` leaves at `depth`, every side node non-zero, so every level hashes and every write is an update.
    function stage(uint256 size, uint256 depth) external {
        assembly {
            sstore(0, size)
            sstore(1, depth)
        }
        for (uint256 level = 0; level <= depth; level++) {
            bytes32 slot = keccak256(abi.encode(level, uint256(2)));
            assembly {
                sstore(slot, add(level, 1000))
            }
        }
        liabilities = 100 ether;
    }

    function measure(address recipient, uint256 amount, uint256 change) external payable {
        uint256 start = gasleft();
        this.withdraw(recipient, amount, 0, change, 888, 0);
        emit Measured(start - gasleft());
    }
}

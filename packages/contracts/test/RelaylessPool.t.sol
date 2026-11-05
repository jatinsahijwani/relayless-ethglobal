// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {RelaylessPool} from "../src/RelaylessPool.sol";
import {PoseidonT3} from "poseidon-solidity/PoseidonT3.sol";
import {PoseidonT4} from "poseidon-solidity/PoseidonT4.sol";

// Scope: deposits, the tree, root publishing, and above all that the SENDER frame cannot revert. The frame opcodes do
// not exist in stock Foundry, so the VERIFY path (validator, proofs, nonce keys, recent-root references) is tested on a
// chain by scripts/e2e.ts.

contract MockRegistry {
    mapping(address => uint256) public stake;

    function addStake(uint32) external payable {
        stake[msg.sender] += msg.value;
    }
}

/// Stands in for the EIP-8272 predeploy: records the last write, rejects any other shape.
contract MockRecentRoot {
    bytes32 public lastSalt;
    bytes32 public lastRoot;
    uint256 public writes;

    fallback() external {
        require(msg.data.length == 64, "bad length");
        (lastSalt, lastRoot) = abi.decode(msg.data, (bytes32, bytes32));
        writes++;
    }
}

contract RevertingRoot {
    fallback() external {
        revert("expired");
    }
}

contract Rejecter {
    receive() external payable {
        revert("no");
    }
}

/// Burns all the gas it is given.
contract GasBurner {
    receive() external payable {
        while (true) {}
    }
}

/// Returns a huge payload, trying to make the caller pay to copy it.
contract ReturnBomb {
    receive() external payable {
        assembly {
            revert(0, 1000000)
        }
    }
}

/// Reenters while being paid.
contract Reenter {
    RelaylessPool public pool;
    bool public threw;

    constructor(RelaylessPool p) {
        pool = p;
    }

    receive() external payable {
        try pool.withdraw(address(this), 1, 0, 999, 1, 0) {} catch {
            threw = true;
        }
    }
}

contract RelaylessPoolTest is Test {
    uint256 constant R = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    address constant RECENT_ROOT = 0x0000000000000000000000000000000000008272;
    uint256 constant STAKE = 0.012 ether;
    uint256 constant RESERVE = 0.1 ether;

    RelaylessPool pool;
    MockRegistry registry;
    MockRecentRoot roots;
    address alice = makeAddr("alice");

    function setUp() public {
        vm.etch(RECENT_ROOT, address(new MockRecentRoot()).code);
        roots = MockRecentRoot(RECENT_ROOT);
        registry = new MockRegistry();
        pool = new RelaylessPool{value: STAKE + RESERVE}(makeAddr("validator"), address(registry), STAKE, 86400, bytes32(0));
        vm.deal(alice, 100 ether);
    }

    function _deposit(uint256 value, uint256 pre) internal returns (uint256) {
        vm.prank(alice);
        return pool.deposit{value: value}(pre);
    }

    function _label(uint256 n) internal view returns (uint256) {
        return uint256(keccak256(abi.encodePacked(address(pool), block.chainid, n))) % R;
    }

    function _withdraw(address to, uint256 amount, uint256 fee, uint256 change) internal {
        vm.prank(address(pool));
        pool.withdraw(to, amount, fee, change, 888, 0);
    }

    // ---- Deposits, tree, roots ----

    function test_constructorStakesThePoolAndKeepsTheRestAsReserve() public view {
        assertEq(registry.stake(address(pool)), STAKE);
        assertEq(address(pool).balance, RESERVE);
        assertEq(pool.reserve(), RESERVE);
        assertEq(pool.liabilities(), 0);
    }

    function test_depositInsertsTheExpectedCommitment() public {
        uint256 c = _deposit(1 ether, 42);
        assertEq(c, PoseidonT4.hash([1 ether, _label(0), 42]));
        assertEq(pool.leafCount(), 1);
        assertEq(pool.depositors(_label(0)), alice);
        assertEq(pool.liabilities(), 1 ether);
        assertEq(pool.reserve(), RESERVE);
    }

    function test_publishesARootAfterEveryDeposit() public {
        _deposit(1 ether, 42);
        assertEq(roots.writes(), 1);
        _deposit(2 ether, 43);
        assertEq(roots.writes(), 2);
        assertEq(roots.lastSalt(), pool.ROOT_SALT());
        assertEq(uint256(roots.lastRoot()), PoseidonT3.hash([pool.currentRoot(), 2]));
    }

    function test_treeRootMatchesLeanImtShape() public {
        uint256 a = _deposit(1 ether, 42);
        assertEq(pool.currentRoot(), a); // one leaf: the root is the leaf
        uint256 b = _deposit(1 ether, 43);
        assertEq(pool.currentRoot(), PoseidonT3.hash([a, b]));
        uint256 c = _deposit(1 ether, 44);
        assertEq(pool.currentRoot(), PoseidonT3.hash([PoseidonT3.hash([a, b]), c])); // a lone node moves up unchanged
    }

    function test_depositRejectsBadInputs() public {
        vm.startPrank(alice);
        vm.expectRevert(RelaylessPool.BadValue.selector);
        pool.deposit{value: 0}(42);
        vm.expectRevert(RelaylessPool.BadValue.selector);
        pool.deposit{value: 0.01 ether - 1}(42);
        vm.expectRevert(RelaylessPool.BadPrecommitment.selector);
        pool.deposit{value: 1 ether}(0);
        vm.expectRevert(RelaylessPool.BadPrecommitment.selector);
        pool.deposit{value: 1 ether}(R);
        vm.stopPrank();
    }

    function test_plainTransferIsRejected() public {
        vm.prank(alice);
        (bool ok,) = address(pool).call{value: 1 ether}("");
        assertFalse(ok);
    }

    function test_withdrawAndRagequitOnlyFromThePoolItself() public {
        vm.prank(alice);
        vm.expectRevert(RelaylessPool.OnlySelf.selector);
        pool.withdraw(alice, 1, 0, 7, 8, 0);
        vm.prank(alice);
        vm.expectRevert(RelaylessPool.OnlySelf.selector);
        pool.ragequit(1, 1, 0, 8);
    }

    function test_withdrawPaysAmountMinusFeeInsertsChangeAndPublishes() public {
        _deposit(1 ether, 42);
        address fresh = makeAddr("fresh");
        uint256 writesBefore = roots.writes();
        _withdraw(fresh, 0.4 ether, 0.01 ether, 777);
        assertEq(fresh.balance, 0.39 ether);
        assertEq(pool.leafCount(), 2);
        assertEq(roots.writes(), writesBefore + 1);
        assertEq(pool.liabilities(), 0.6 ether);
        assertEq(pool.reserve(), RESERVE + 0.01 ether); // the fee waits in the pool to cover gas
    }

    function test_ragequitPaysOnlyTheOriginalDepositor() public {
        _deposit(1 ether, 42);
        uint256 before = alice.balance;
        vm.prank(address(pool));
        pool.ragequit(_label(0), 1 ether, 0.01 ether, 888);
        assertEq(alice.balance, before + 0.99 ether);
        assertEq(pool.liabilities(), 0);
    }

    function test_anyoneCanRepublishTheRoot() public {
        _deposit(1 ether, 42);
        uint256 before = roots.writes();
        vm.prank(makeAddr("stranger"));
        pool.republishRoot();
        assertEq(roots.writes(), before + 1);
    }

    function test_fundReserveCountsAsReserveNotLiability() public {
        vm.prank(alice);
        pool.fundReserve{value: 1 ether}();
        assertEq(pool.reserve(), RESERVE + 1 ether);
        assertEq(pool.liabilities(), 0);
    }

    function test_nonEmptyFallbackReverts() public {
        (bool ok,) = address(pool).call(hex"deadbeef");
        assertFalse(ok);
    }

    // ---- The SENDER frame cannot revert after APPROVE ----

    function test_noRevert_recipientRefusesPayment_becomesAClaim() public {
        _deposit(1 ether, 42);
        address rejecter = address(new Rejecter());
        _withdraw(rejecter, 1 ether, 0, 777);
        assertEq(pool.claimable(rejecter), 1 ether);
        assertEq(pool.liabilities(), 1 ether); // still owed
        assertEq(pool.leafCount(), 2); // the change note still went in
    }

    function test_claimPaysOutTheDeferredPayment() public {
        _deposit(1 ether, 42);
        address rejecter = address(new Rejecter());
        _withdraw(rejecter, 1 ether, 0, 777);
        vm.prank(rejecter);
        pool.claim(payable(alice));
        assertEq(pool.claimable(rejecter), 0);
        assertEq(pool.liabilities(), 0);
        assertEq(alice.balance, 100 ether);
    }

    function test_noRevert_recipientBurnsAllGas_frameFinishes() public {
        _deposit(1 ether, 42);
        address burner = address(new GasBurner());
        uint256 start = gasleft();
        vm.prank(address(pool));
        pool.withdraw{gas: 1_500_000}(burner, 1 ether, 0, 777, 888, 0);
        assertLt(start - gasleft(), 1_500_000);
        assertEq(pool.claimable(burner), 1 ether);
    }

    function test_noRevert_returnBomb() public {
        _deposit(1 ether, 42);
        address bomb = address(new ReturnBomb());
        vm.prank(address(pool));
        pool.withdraw{gas: 1_500_000}(bomb, 1 ether, 0, 777, 888, 0);
        assertEq(pool.claimable(bomb), 1 ether);
    }

    function test_noRevert_reentrantRecipientCannotCallWithdraw() public {
        _deposit(1 ether, 42);
        Reenter r = new Reenter(pool);
        _withdraw(address(r), 0.5 ether, 0, 777);
        assertTrue(r.threw());
        assertEq(address(r).balance, 0.5 ether);
    }

    function test_noRevert_duplicateChangeLeaf() public {
        uint256 existing = _deposit(1 ether, 42);
        _withdraw(makeAddr("fresh"), 0.5 ether, 0, existing);
        assertEq(makeAddr("fresh").balance, 0.5 ether);
        assertEq(pool.leafCount(), 1); // skipped, not reverted
    }

    function test_noRevert_zeroAndOversizedChangeLeaf() public {
        _deposit(1 ether, 42);
        _withdraw(makeAddr("a"), 0.1 ether, 0, 0);
        _withdraw(makeAddr("b"), 0.1 ether, 0, R);
        _withdraw(makeAddr("c"), 0.1 ether, 0, type(uint256).max);
        assertEq(pool.leafCount(), 1);
        assertEq(makeAddr("c").balance, 0.1 ether);
    }

    function test_noRevert_rootPublishFails() public {
        _deposit(1 ether, 42);
        vm.etch(RECENT_ROOT, address(new RevertingRoot()).code);
        _withdraw(makeAddr("fresh"), 0.5 ether, 0, 777);
        assertEq(makeAddr("fresh").balance, 0.5 ether);
        assertEq(pool.leafCount(), 2);
    }

    function test_noRevert_poolCannotPay_becomesAClaim() public {
        // More than the pool holds: only reachable if accounting were broken, and it must still not revert.
        address fresh = makeAddr("fresh");
        _withdraw(fresh, 1000 ether, 0, 777);
        assertEq(pool.claimable(fresh), 1000 ether);
    }

    function test_noRevert_ragequitWithUnknownLabel() public {
        vm.prank(address(pool));
        pool.ragequit(123, 1, 0, 888);
    }

    function test_noRevert_treeFull_changeSkippedPaymentStillMade() public {
        _deposit(1 ether, 42);
        vm.store(address(pool), bytes32(uint256(0)), bytes32(uint256(1 << 20))); // tree.size
        _withdraw(makeAddr("fresh"), 0.5 ether, 0, 777);
        assertEq(makeAddr("fresh").balance, 0.5 ether);
    }

    function testFuzz_noRevert_withdrawForAnyInput(address recipient, uint256 amount, uint256 fee, uint256 change, uint256 nh, uint256 k) public {
        vm.assume(uint160(recipient) > 0x20000 && recipient != address(vm) && recipient != address(pool));
        _deposit(1 ether, 42);
        vm.prank(address(pool));
        pool.withdraw(recipient, amount, fee, change, nh, k); // any revert fails the test
    }

    function testFuzz_noRevert_ragequitForAnyInput(uint256 label, uint256 value, uint256 fee, uint256 nh) public {
        _deposit(1 ether, 42);
        vm.prank(address(pool));
        pool.ragequit(label, value, fee, nh);
    }

    /// The validator's minimum SENDER-frame execution limit must cover the worst case: a full-depth tree, new slots,
    /// a recipient that burns its whole allowance, and a deferred payment.
    function test_worstCaseGasFitsTheValidatorMinimum() public {
        _deposit(1 ether, 42);
        for (uint256 level = 0; level < 20; level++) {
            vm.store(address(pool), keccak256(abi.encode(level, uint256(2))), bytes32(uint256(level + 1000)));
        }
        vm.store(address(pool), bytes32(uint256(0)), bytes32(uint256((1 << 20) - 2))); // size: every level hashes
        vm.store(address(pool), bytes32(uint256(1)), bytes32(uint256(20))); // depth
        address burner = address(new GasBurner());
        vm.prank(address(pool));
        uint256 start = gasleft();
        pool.withdraw(burner, 1 ether, 0, 777, 888, 0);
        uint256 used = start - gasleft();
        emit log_named_uint("worst case SENDER execution gas", used);
        assertLt(used, 1_500_000);
    }
}

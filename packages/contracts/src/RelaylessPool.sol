// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.28;

import {InternalLeanIMT, LeanIMTData} from "lean-imt/InternalLeanIMT.sol";
import {PoseidonT3} from "poseidon-solidity/PoseidonT3.sol";
import {PoseidonT4} from "poseidon-solidity/PoseidonT4.sol";

interface IStakingRegistry {
    function addStake(uint32 unstakeDelaySec) external payable;
}

/// @notice A privacy pool whose withdrawals need no relayer. The pool is the sender and payer of an EIP-8141 frame
/// transaction: a VERIFY frame checks a proof and approves, and a SENDER frame calling this contract moves the money.
///
/// Four properties keep that safe with one shared sender:
///  - the nullifier is the transaction's EIP-8250 nonce key, consumed atomically with payment approval;
///  - validation reads no storage (the verifying keys are in the validator's code, the root is an EIP-8272 reference),
///    so one withdrawal being mined cannot invalidate another pending one;
///  - the validator pins the exact shape of the transaction, and `withdraw` trusts only calls from this contract, which
///    only a transaction that passed validation can make;
///  - `withdraw` and `ragequit` cannot revert for any input once called by the pool. By then APPROVE has burned the
///    nullifier, so a revert would destroy the note. The only remaining failure is running out of gas, which the
///    validator rules out by enforcing minimum limits on the SENDER frame.
contract RelaylessPool {
    using InternalLeanIMT for LeanIMTData;

    uint256 internal constant R = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    /// @dev The circuit's tree depth is 20.
    uint256 internal constant MAX_LEAVES = 1 << 20;
    /// @dev Deposits stop at half capacity, so the tree keeps room for change notes.
    uint256 internal constant MAX_DEPOSIT_LEAVES = 1 << 19;
    uint256 internal constant MAX_VALUE = 1 << 128;
    /// @dev Must cover the refundable gas deposit, and makes each note used to grief the pool's reputation cost more.
    uint256 public constant MIN_DEPOSIT = 0.01 ether;
    /// @dev Bounds what a recipient can burn: the rest of the frame must still be able to finish.
    uint256 internal constant PAY_GAS = 100_000;
    address internal constant RECENT_ROOT = 0x0000000000000000000000000000000000008272;
    bytes32 public constant ROOT_SALT = keccak256("relayless.root");

    /// @notice Holds the VERIFY-frame code. Run by delegatecall, so its APPROVE acts on this contract.
    address public immutable VALIDATOR;
    /// @notice The EIP-8272 source of the association set root, or 0 if this pool has no association set.
    bytes32 public immutable ASP_SOURCE_ID;

    LeanIMTData internal tree;
    uint256 public nonce;
    /// @notice ETH owed to note holders and to recipients whose payment was deferred.
    uint256 public liabilities;
    /// @notice Who made each deposit: the only address a ragequit can pay.
    mapping(uint256 label => address depositor) public depositors;
    /// @notice Payments a recipient refused or could not take. Collected with `claim`.
    mapping(address recipient => uint256 amount) public claimable;

    event LeafInserted(uint256 indexed leafIndex, uint256 commitment);
    event RootPublished(uint256 rootCommit, uint256 treeRoot, uint256 leafCount);
    event RootPublishFailed(uint256 rootCommit);
    event Deposited(address indexed depositor, uint256 label, uint256 value, uint256 precommitment, uint256 commitment, uint256 leafIndex);
    event Withdrawn(address indexed recipient, uint256 amount, uint256 fee, uint256 changeCommitment, uint256 nullifierHash, uint256 k);
    event Ragequit(address indexed depositor, uint256 label, uint256 value, uint256 fee, uint256 nullifierHash);
    event ChangeNotInserted(uint256 changeCommitment);
    event PaymentDeferred(address indexed recipient, uint256 amount);
    event Claimed(address indexed recipient, address indexed to, uint256 amount);
    event ReserveFunded(address indexed from, uint256 amount);

    error OnlySelf();
    error BadValue();
    error BadPrecommitment();
    error PoolFull();
    error ClaimFailed();

    modifier onlySelf() {
        if (msg.sender != address(this)) revert OnlySelf();
        _;
    }

    /// @param stakeAmount Sent to the staking registry; staking here makes the pool the staker without a VERIFY path
    /// that accepts anything but a proof. The rest of `msg.value` becomes the gas reserve.
    constructor(address validator, address registry, uint256 stakeAmount, uint32 unstakeDelaySec, bytes32 aspSourceId) payable {
        VALIDATOR = validator;
        ASP_SOURCE_ID = aspSourceId;
        IStakingRegistry(registry).addStake{value: stakeAmount}(unstakeDelaySec);
    }

    /// @notice A normal transaction from the depositor. `precommitment` = Poseidon(nullifier, secret).
    function deposit(uint256 precommitment) external payable returns (uint256 commitment) {
        if (msg.value < MIN_DEPOSIT || msg.value >= MAX_VALUE) revert BadValue();
        if (precommitment == 0 || precommitment >= R) revert BadPrecommitment();
        uint256 leafIndex = tree.size;
        if (leafIndex >= MAX_DEPOSIT_LEAVES) revert PoolFull();

        uint256 label = uint256(keccak256(abi.encodePacked(address(this), block.chainid, nonce++))) % R;
        depositors[label] = msg.sender;
        liabilities += msg.value;
        commitment = PoseidonT4.hash([msg.value, label, precommitment]);

        tree._insert(commitment);
        emit LeafInserted(leafIndex, commitment);
        emit Deposited(msg.sender, label, msg.value, precommitment, commitment, leafIndex);
        _publishRoot();
    }

    /// @notice SENDER frame of a withdrawal. Every argument was bound to the proof by the validator.
    /// @param fee Taken out of `amount`; stays in the pool, which has paid the gas.
    function withdraw(address recipient, uint256 amount, uint256 fee, uint256 changeCommitment, uint256 nullifierHash, uint256 k)
        external
        onlySelf
    {
        _insertChange(changeCommitment);
        _publishRoot();
        emit Withdrawn(recipient, amount, fee, changeCommitment, nullifierHash, k);
        _settle(recipient, amount, fee);
    }

    /// @notice SENDER frame of a public exit. Pays only the original depositor of `label`.
    function ragequit(uint256 label, uint256 value, uint256 fee, uint256 nullifierHash) external onlySelf {
        address depositor = depositors[label];
        emit Ragequit(depositor, label, value, fee, nullifierHash);
        _settle(depositor, value, fee);
    }

    /// @notice Collects a payment that was deferred because the recipient refused it.
    function claim(address payable to) external {
        uint256 amount = claimable[msg.sender];
        claimable[msg.sender] = 0;
        liabilities -= amount;
        emit Claimed(msg.sender, to, amount);
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert ClaimFailed();
    }

    /// @notice Anyone may republish: recent roots expire after 8191 slots, and a quiet pool must stay withdrawable.
    function republishRoot() external {
        _publishRoot();
    }

    /// @notice Adds to the gas reserve: ETH beyond what the pool owes, so pending withdrawals stay fundable.
    function fundReserve() external payable {
        emit ReserveFunded(msg.sender, msg.value);
    }

    /// @notice Optional frame 2 of a withdrawal: hands back the part of the fee that gas did not use.
    function refund() external {
        _toValidator(1, 0);
    }

    /// @notice The VERIFY frame lands here. There is no receive(): deposits must name a note.
    fallback() external {
        if (msg.data.length != 0) revert();
        _toValidator(0, ASP_SOURCE_ID);
    }

    function currentRoot() external view returns (uint256) {
        return tree._root();
    }

    function leafCount() external view returns (uint256) {
        return tree.size;
    }

    /// @notice ETH beyond what the pool owes. Reads the balance, so it must never be used during validation.
    function reserve() external view returns (uint256) {
        return address(this).balance > liabilities ? address(this).balance - liabilities : 0;
    }

    function _toValidator(uint256 mode, bytes32 arg) private {
        address validator = VALIDATOR;
        assembly ("memory-safe") {
            mstore(0, mode)
            mstore(32, arg)
            if iszero(delegatecall(gas(), validator, 0, 64, 0, 0)) { revert(0, 0) }
            return(0, 0)
        }
    }

    /// @dev Never reverts. A bad change leaf only ever comes from a prover who chose it; they lose only their own change.
    function _insertChange(uint256 leaf) private {
        uint256 leafIndex = tree.size;
        if (leaf == 0 || leaf >= R || leafIndex >= MAX_LEAVES || tree._has(leaf)) {
            emit ChangeNotInserted(leaf);
            return;
        }
        tree._insert(leaf);
        emit LeafInserted(leafIndex, leaf);
    }

    /// @dev Never reverts: the fee is bounded by the validator, and a failed payment becomes a claim. It sits last and
    /// forwards bounded gas with no return data copied, so the recipient cannot make anything after it run out of gas.
    function _settle(address recipient, uint256 amount, uint256 fee) private {
        uint256 pay = amount > fee ? amount - fee : 0;
        liabilities = liabilities > amount ? liabilities - amount : 0;
        if (pay == 0) return;
        bool ok;
        uint256 gasCap = PAY_GAS;
        assembly ("memory-safe") {
            ok := call(gasCap, recipient, pay, 0, 0, 0, 0)
        }
        if (!ok) {
            liabilities += pay;
            claimable[recipient] += pay;
            emit PaymentDeferred(recipient, pay);
        }
    }

    /// @dev Root commitment = Poseidon(treeRoot, leafCount): the k-gate needs the proof bound to the tree's size.
    /// Never reverts on a failed write: the next publish covers this leaf, and the withdrawal must still complete.
    function _publishRoot() private {
        uint256 treeRoot = tree._root();
        uint256 count = tree.size;
        uint256 rootCommit = PoseidonT3.hash([treeRoot, count]);
        (bool ok,) = RECENT_ROOT.call(abi.encodePacked(ROOT_SALT, rootCommit));
        if (!ok) {
            emit RootPublishFailed(rootCommit);
            return;
        }
        emit RootPublished(rootCommit, treeRoot, count);
    }
}

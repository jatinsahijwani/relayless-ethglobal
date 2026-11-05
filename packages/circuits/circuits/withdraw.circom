// SPDX-License-Identifier: Apache-2.0
// Adapted from 0xbow Privacy Pools (packages/circuits/circuits/withdraw.circom). See NOTICE.md.
// Changed: `context` is replaced by the frame transaction's sigHash, the state root is bound to the leaf count
// (for the k-gate), the k-gate is new, and ASP membership applies only when aspRoot is non-zero.
pragma circom 2.2.0;

include "comparators.circom";
include "bitify.circom";
include "poseidon.circom";
include "commitment.circom";
include "leanImt.circom";

template Withdraw(maxDepth) {
  // Public. The order is the order the on-chain validator feeds the verifier.
  signal input rootCommit;       // Poseidon(treeRoot, leafCount), published by the pool as an EIP-8272 recent root
  signal input nullifierHash;    // the EIP-8250 nonce key of this transaction
  signal input changeCommitment; // the note holding what is left
  signal input withdrawnValue;
  signal input sigHash;          // sigHash mod r: commits the recipient, the fee and every frame
  signal input k;                // at least k leaves were inserted after the spent note (0 turns the gate off)
  signal input aspRoot;          // 0 when the pool has no association set

  // Private.
  signal input value;
  signal input label;
  signal input nullifier;
  signal input secret;
  signal input newNullifier;
  signal input newSecret;
  signal input treeRoot;
  signal input leafCount;
  signal input leafIndex;
  signal input siblings[maxDepth];
  signal input aspIndex;
  signal input aspSiblings[maxDepth];

  // 1. The spent note, and its nullifier.
  component spent = CommitmentHasher();
  spent.value <== value;
  spent.label <== label;
  spent.nullifier <== nullifier;
  spent.secret <== secret;
  nullifierHash === spent.nullifierHash;

  // 2. The note is in the tree, and rootCommit binds that tree to its size.
  component inclusion = PositionalLeanIMT(maxDepth);
  inclusion.leaf <== spent.commitment;
  inclusion.leafIndex <== leafIndex;
  inclusion.leafCount <== leafCount;
  inclusion.siblings <== siblings;
  treeRoot === inclusion.out;

  component rootHasher = Poseidon(2);
  rootHasher.inputs[0] <== treeRoot;
  rootHasher.inputs[1] <== leafCount;
  rootCommit === rootHasher.out;

  // 3. Value conservation: both parts fit 128 bits, so the subtraction cannot wrap the field.
  signal remaining <== value - withdrawnValue;
  component remainingBits = Num2Bits(128);
  remainingBits.in <== remaining;
  component withdrawnBits = Num2Bits(128);
  withdrawnBits.in <== withdrawnValue;

  // 4. The change note keeps the label and needs a fresh nullifier.
  component sameNullifier = IsEqual();
  sameNullifier.in[0] <== nullifier;
  sameNullifier.in[1] <== newNullifier;
  sameNullifier.out === 0;

  component change = CommitmentHasher();
  change.value <== remaining;
  change.label <== label;
  change.nullifier <== newNullifier;
  change.secret <== newSecret;
  changeCommitment === change.commitment;

  // 5. The k-gate: leafIndex + k <= leafCount.
  component kBits = Num2Bits(32);
  kBits.in <== k;
  component countBits = Num2Bits(32);
  countBits.in <== leafCount;
  component kGate = LessEqThan(33);
  kGate.in[0] <== leafIndex + k;
  kGate.in[1] <== leafCount;
  kGate.out === 1;

  // 6. Association set, only when the pool uses one. Membership is proved for the label, so change notes inherit it.
  component aspOff = IsZero();
  aspOff.in <== aspRoot;
  component aspInclusion = LeanIMTInclusionProof(maxDepth);
  aspInclusion.leaf <== label;
  aspInclusion.leafIndex <== aspIndex;
  aspInclusion.siblings <== aspSiblings;
  (aspInclusion.out - aspRoot) * (1 - aspOff.out) === 0;

  // 7. Keep sigHash in the constraint system.
  signal sigHashSquared <== sigHash * sigHash;
}

component main { public [rootCommit, nullifierHash, changeCommitment, withdrawnValue, sigHash, k, aspRoot] } = Withdraw(20);

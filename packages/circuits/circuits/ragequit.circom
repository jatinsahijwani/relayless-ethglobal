// SPDX-License-Identifier: Apache-2.0
// Adapted from 0xbow Privacy Pools (packages/circuits/circuits/commitment.circom and its ragequit flow). See NOTICE.md.
// Exits a note publicly. The pool pays only the original depositor of `label`, so the exit reveals the note and links
// it to its deposit, which is the point: anyone refused by the association set still gets their money back.
pragma circom 2.2.0;

include "poseidon.circom";
include "commitment.circom";
include "leanImt.circom";

template Ragequit(maxDepth) {
  signal input rootCommit;
  signal input nullifierHash;
  signal input label;
  signal input value;
  signal input sigHash;

  signal input nullifier;
  signal input secret;
  signal input treeRoot;
  signal input leafCount;
  signal input leafIndex;
  signal input siblings[maxDepth];

  component note = CommitmentHasher();
  note.value <== value;
  note.label <== label;
  note.nullifier <== nullifier;
  note.secret <== secret;
  nullifierHash === note.nullifierHash;

  component inclusion = LeanIMTInclusionProof(maxDepth);
  inclusion.leaf <== note.commitment;
  inclusion.leafIndex <== leafIndex;
  inclusion.siblings <== siblings;
  treeRoot === inclusion.out;

  component rootHasher = Poseidon(2);
  rootHasher.inputs[0] <== treeRoot;
  rootHasher.inputs[1] <== leafCount;
  rootCommit === rootHasher.out;

  signal sigHashSquared <== sigHash * sigHash;
}

component main { public [rootCommit, nullifierHash, label, value, sigHash] } = Ragequit(20);

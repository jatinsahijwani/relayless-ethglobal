// SPDX-License-Identifier: Apache-2.0
// Adapted from 0xbow Privacy Pools (packages/circuits/circuits/merkleTree.circom). See NOTICE.md.
// Changed: the unused actualDepth input is removed.
pragma circom 2.2.0;

include "poseidon.circom";
include "comparators.circom";
include "mux1.circom";
include "bitify.circom";

// LeanIMT: a node with two children is their hash, a node with one child equals that child.
// On its own this proves membership but NOT position: siblings can be shifted down past empty levels, so a leaf can
// claim a smaller index with the same root. Use PositionalLeanIMT wherever the index means something.
template LeanIMTInclusionProof(maxDepth) {
  signal input leaf;
  signal input leafIndex;
  signal input siblings[maxDepth];

  signal output out;
  signal output empty[maxDepth];
  signal output indexBits[maxDepth];

  signal nodes[maxDepth + 1];
  component indexToPath = Num2Bits(maxDepth);
  indexToPath.in <== leafIndex;

  component ordered[maxDepth];
  component hashers[maxDepth];
  component siblingIsEmpty[maxDepth];

  nodes[0] <== leaf;
  for (var i = 0; i < maxDepth; i++) {
    ordered[i] = MultiMux1(2);
    ordered[i].c[0][0] <== nodes[i];
    ordered[i].c[0][1] <== siblings[i];
    ordered[i].c[1][0] <== siblings[i];
    ordered[i].c[1][1] <== nodes[i];
    ordered[i].s <== indexToPath.out[i];

    hashers[i] = Poseidon(2);
    hashers[i].inputs[0] <== ordered[i].out[0];
    hashers[i].inputs[1] <== ordered[i].out[1];

    siblingIsEmpty[i] = IsZero();
    siblingIsEmpty[i].in <== siblings[i];

    nodes[i + 1] <== (nodes[i] - hashers[i].out) * siblingIsEmpty[i].out + hashers[i].out;
  }
  out <== nodes[maxDepth];
  for (var i = 0; i < maxDepth; i++) {
    empty[i] <== siblingIsEmpty[i].out;
    indexBits[i] <== indexToPath.out[i];
  }
}

// Inclusion, plus: leafIndex is the leaf's real position in a tree of leafCount leaves.
// A level may have an empty sibling only if this path is the last node of that level, as a left child.
template PositionalLeanIMT(maxDepth) {
  signal input leaf;
  signal input leafIndex;
  signal input leafCount;
  signal input siblings[maxDepth];

  signal output out;

  component inclusion = LeanIMTInclusionProof(maxDepth);
  inclusion.leaf <== leaf;
  inclusion.leafIndex <== leafIndex;
  inclusion.siblings <== siblings;
  out <== inclusion.out;

  // Also forces leafCount to be in 1..2^maxDepth.
  component lastBits = Num2Bits(maxDepth);
  lastBits.in <== leafCount - 1;

  // diff[i] = (leafIndex >> i) - ((leafCount - 1) >> i), computed from the top bit down.
  signal diff[maxDepth + 1];
  diff[maxDepth] <== 0;
  for (var i = maxDepth - 1; i >= 0; i--) {
    diff[i] <== 2 * diff[i + 1] + inclusion.indexBits[i] - lastBits.out[i];
    inclusion.empty[i] * diff[i] === 0;
    inclusion.empty[i] * inclusion.indexBits[i] === 0;
  }
}

// SPDX-License-Identifier: Apache-2.0
// Adapted from 0xbow Privacy Pools (packages/circuits/circuits/commitment.circom). See NOTICE.md.
pragma circom 2.2.0;

include "poseidon.circom";

// commitment = Poseidon(value, label, Poseidon(nullifier, secret)); nullifierHash = Poseidon(nullifier).
template CommitmentHasher() {
  signal input value;
  signal input label;
  signal input nullifier;
  signal input secret;

  signal output commitment;
  signal output nullifierHash;

  component nullifierHasher = Poseidon(1);
  nullifierHasher.inputs[0] <== nullifier;

  component precommitmentHasher = Poseidon(2);
  precommitmentHasher.inputs[0] <== nullifier;
  precommitmentHasher.inputs[1] <== secret;

  component commitmentHasher = Poseidon(3);
  commitmentHasher.inputs[0] <== value;
  commitmentHasher.inputs[1] <== label;
  commitmentHasher.inputs[2] <== precommitmentHasher.out;

  commitment <== commitmentHasher.out;
  nullifierHash <== nullifierHasher.out;
}

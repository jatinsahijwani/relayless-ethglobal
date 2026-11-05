// Proving runs off the main thread, so the page stays responsive. Inputs and secrets never leave this browser.
import * as snarkjs from "snarkjs";

self.onmessage = async (e: MessageEvent<{ id: number; circuit: string; input: Record<string, unknown> }>) => {
  const { id, circuit, input } = e.data;
  try {
    const out = await snarkjs.groth16.fullProve(input, `/circuits/${circuit}.wasm`, `/circuits/${circuit}.zkey`);
    self.postMessage({ id, ok: true, proof: out.proof, publicSignals: out.publicSignals });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err) });
  }
};

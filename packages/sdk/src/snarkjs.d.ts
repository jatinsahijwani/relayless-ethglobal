declare module "snarkjs" {
  export const groth16: {
    fullProve(input: Record<string, unknown>, wasm: string | Uint8Array, zkey: string | Uint8Array): Promise<{ proof: any; publicSignals: string[] }>;
  };
}

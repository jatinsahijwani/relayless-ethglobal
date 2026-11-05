# Public gateway: two rejections that block on-chain ZK verification

Both are dry runs (`eth_estimateFrameTransactionGas`), so they send nothing. Both addresses are on the public devnet; a reset would remove them.

```sh
G=https://altmempoolgateway.forshtat.com/rpc
req() { printf '{"jsonrpc":"2.0","id":1,"method":"eth_estimateFrameTransactionGas","params":[{"chainId":"0x539","sender":"%s","nonceKeys":["0x7777"],"nonceSeq":"0x0","frames":[{"mode":1,"flags":3,"target":null,"limits":{"execution":"%s","state":"0x0"},"value":"0x0","data":"0x"},{"mode":2,"flags":0,"target":"0x000000000000000000000000000000000000dEaD","limits":{"execution":"0xc350","state":"0x0"},"value":"0x0","data":"0x"}],"signatures":[],"fees":{"maxPriorityFeePerGas":"0x1","maxFeePerGas":"0x64","maxFeePerBlobGas":"0x0"},"blobVersionedHashes":[],"recentRootReferences":[]}]}' "$1" "$2"; }
```

## 1. The 100k cap applies to a staked sender
`0x1901…1464` holds a real stake of 0.012 ETH with an 86400 s delay. Asks for 250k:

```sh
curl -s -H 'content-type: application/json' --data "$(req 0x1901ad413a7b16d16484234eea7b698c4c161464 0x3d090)" $G
```

- **Expected (BUDGET-010):** passes the budget check, since the entity is staked, then fails or succeeds on its own frame.
- **Actual:** `validation prefix execution gas sum 250000 + signature-verification cost 0 = 250000 exceeds MAX_VERIFY_GAS 100000`
- **Why:** `validateStructuralRules` applies one cap before stake is looked up. `MAX_VERIFY_GAS_STAKED_ENTITY` is in the docs but not the code.

## 2. Precompiles count as un-deployed, even under the cap
`0x5746…9482` calls `0x06`, then approves. Asks for 60k:

```sh
curl -s -H 'content-type: application/json' --data "$(req 0x574668d6eed79e39983e06ab0c9fda5382239482 0xea60)" $G
```

- **Expected (CALLING-040):** precompiles `0x01–0x11` and `P256VERIFY` are allowed.
- **Actual:** `payer accesses un-deployed contract address 0x0000000000000000000000000000000000000006 with opcode STATICCALL`
- **Why:** `skandha_config` shows `"precompiles": []`, and `COD-010` only exempts that list.

## Our local fix
1. **Code:** [`patches/sidecar-budget-010.patch`](../patches/sidecar-budget-010.patch), against sidecar `2e22ff0a`. Moves the cap to a per-entity check after stake lookup, configurable, default 100k/1M.
2. **Config:** set `precompiles` to `0x01–0x11` and `0x100`.

With both, on a local chain:

| Request | Result |
|---|---|
| Staked, 250k | Budget check passes |
| Staked, 1,000,001 | `validation gas 1000001 exceeds its budget 1000000 (BUDGET-010)` |
| Unstaked, 250k | `validation gas 250000 exceeds its budget 100000 (BUDGET-010)` |
| Precompile call in VERIFY | Admitted |
| Real Groth16 withdrawal, 253k verify | Admitted, mined, 17/17 checks |

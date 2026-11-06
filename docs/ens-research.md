# ENSv2 research

Checked against the live docs, the `contracts-v2` source at the deployed commit (`07e55a05`) and Sepolia on 2026-11-06. Where this differs from the build brief, this file wins.

## What ENSv2 offers on Sepolia today
- **Hierarchical registries.** `.eth` is a registry, and a name can point to its own subname registry (a `UserRegistry` proxy from the Verifiable Factory).
- **Enhanced Access Control.** Roles are held per resource. A registry resource is a name; a resolver resource is a record type or key, such as one text key.
- **Per-account resolvers.** Each account deploys its own `PermissionedResolver` proxy. A role can cover a single text key.
- **Emancipation.** `isEmancipated()` is true when nobody holds a role at registry root that could override a name owner. `ROLE_REGISTRAR` and `ROLE_RENEW` don't count.
- **Registration.** Paid in MockUSDC, whose `mint` is open. `relayless` was available at 8 MockUSDC a year, with a 60 s commitment wait and a 28-day minimum.

## What our design uses
| Feature | Use |
|---|---|
| Permissioned Registry | `relayless.eth` → R1 (receive names, `asp`) → R2 (ASP names) |
| Permissioned Resolver | One per ASP and one per user |
| Enhanced Access Control | Operator can write `asp.root`, `asp.slot`, `asp.policy`; app key can write `stealth-meta-address` |
| Subname rules | ASPs expire and are non-transferable; receive names never expire |
| Log enumeration | `LabelRegistered` read from the browser, to list ASPs with no list in code |

Not used: wildcard resolution, because it can't list names, and aliasing, because nothing here needs two names for one namespace.

## Contradictions with the brief
1. **The payment can't carry the announcement.** The validator pins the frames: `withdraw` calldata is exactly 196 bytes, and the only extra frame allowed is `refund`. The payer's wallet can't announce either, since that links the payer. So each payment first pays a fresh announcer wallet from the pool, and that wallet announces. This costs about twice the gas, isn't atomic, and leaves dust. Announcing first means funds can't be stranded unfound.
2. **ENS doesn't make one pool accept several ASPs.** `ASP_SOURCE_ID` is immutable. ENS gives discovery of many ASPs, and each pool still has one, so choosing an ASP means choosing its pool.
3. **The repo is GPL-3.0, not MIT,** because circomlib's GPL templates are compiled into the circuits. New code is GPL-3.0. MIT dependencies are compatible.
4. **"The parent can't change the root" needs a qualifier.** A parent can't edit records on an ASP's resolver, but whoever holds `ROLE_SET_SUBREGISTRY` on a parent name can replace the whole registry below it. That role must be revoked for the claim to hold fully.
5. **No enumeration function exists.** Names can only be listed from events, so listing depends on an RPC that keeps logs.
6. **Resolver roles aren't scoped per name.** A role covers every name on that resolver instance, so each ASP and each user needs their own instance.
7. **`ENS_BUILD_PROMPT.md` doesn't exist** in the repo or its history. The brief as sent is treated as complete.

## Things that would trip up the next person
- **Don't use `ur.integration-tests.eth` as a Sepolia test.** It returned the "fail" value `0x1111…` on all three resolver addresses, while real v2 names such as `enswhite.eth` resolved correctly. It passes on mainnet.
- **Public RPCs differ a lot for logs.** `gateway.tenderly.co/public/sepolia` had CORS, old history and 9k-block spans. Publicnode pruned a range 40k blocks old, drpc refused every range tried, and 1rpc limits `eth_getLogs`. These are point-in-time results, so the RPC stays in config.
- **The recent-root predeploy has no getter, but it can still be read.** At `0x…8272`, with T1 and T2 taken from its bytecode:
  `storage[keccak(T2 ‖ source ‖ uint64(slot & 0x1fff))] == keccak(T1 ‖ source ‖ uint64(slot) ‖ root)`.
  On the running devnet the real root matched, and a forged root and a wrong slot failed. So the cross-check needs no contract change and no server.
- **Writes need roles on the resolver.** Owning a name grants nothing there.

## Sepolia addresses
From the [deployments table](https://docs.ens.domains/learn/deployments). The code reads these from `config/ens.sepolia.json`.

| Contract | Address |
|---|---|
| ETHRegistry | `0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4` |
| ETHRegistrar | `0xf633e7fc17e2bbe0d0965d18ec1821dcb754a3d3` |
| Universal Resolver proxy | `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe` |
| VerifiableFactory | `0xda70306c98e97ece36f997a21368e53298572991` |
| UserRegistryImpl | `0x9bd8a88719068d09ecee662f36c0e3856708366a` |
| PermissionedResolverImpl | `0x115eb53f0c60696633855f90b138178fb40b2b2c` |
| MockUSDC | `0x240b0316df57887dbbe58b586508b19e633a14aa` |

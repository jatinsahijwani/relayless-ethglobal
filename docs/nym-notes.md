# Nym mixnet: research notes

Checked against Nym's docs, the npm packages and the live mixnet on 2026-11-06, with results measured from a laptop in headless Chromium. Nothing blocks the feature. Its limits are speed and how often an exit fails.

## What to use
| | |
|---|---|
| Package | `@nymproject/mix-fetch` 3.0.1, Apache-2.0, ESM only. Worker and WASM are inlined by its dependency `@nymproject/mix-tunnel` |
| Size | 18 MB, 6.4 MB gzipped. No bundler config, COOP/COEP or WASM hosting needed |
| Setup | `await setupMixTunnel(opts)`, then `mixFetch(url, init)` |
| Runtime | Browser only. The docs say a Node entry point "is not yet ported" from v1, so there's no Nym path for scripts or a CLI |

Older guides describe v1, with `createMixFetch({ preferredNetworkRequester })` and a standard allow list. Neither applies to v3.

## Exits and what each party sees
v3 exits through an IP Packet Router (IPR), not a Network Requester. It auto-discovers one from about 620 candidates, and rotates if one doesn't connect.

The [exit policy](https://nymtech.net/.wellknown/network-requester/exit-policy.txt) is one shared list. It accepts only the ports it names and rejects the rest, and it also rejects some IP ranges. Port 443 to our RPC hosts got through in practice.

| Party | Sees |
|---|---|
| Your network and the entry gateway | Your IP, and that you use Nym. Not the destination |
| `validator.nymtech.net` | Your IP, contacted directly for the network topology. Not the destination |
| Exit (IPR) | The destination IP and port, and TLS ciphertext. Not your IP |
| Sepolia RPC | The exit's IP, and every name you look up. Not your IP |
| Vercel | Your IP, as it serves the page |

TLS runs end to end from the WASM to the RPC, so the exit can't read the query.

## RPC reachability
| Host | Through the mixnet |
|---|---|
| `gateway.tenderly.co` | Works once a tunnel works |
| `ethereum-sepolia-rpc.publicnode.com` | 3 of 7 tries, at 19–30 s each, so routed reads don't use it |
| `sepolia.drpc.org` | Timed out in its one try, in a run where every host timed out. It's also unusable for logs directly |

## What differs from fetch
- **Cancelling:** `AbortController` is ignored, so an in-flight request can't be cancelled. To stop waiting, race it against a timer.
- **Errors:** a promise rejects only on a transport failure, as a plain `Error`. HTTP 4xx and 5xx resolve normally.
- **Restarts:** a tunnel is one-shot per page. After `disconnectMixTunnel()` the WASM is unusable until a reload, and a reload is the only way to get a new tunnel.
- **Concurrency:** four parallel requests came back in 6–19 s, against about 1–3 s for one on the same tunnel. Treat requests as queued. In one run the fourth failed.
- **Batches:** JSON-RPC batches of 8 work, and 32 gets a 429 from Tenderly.
- **Cover traffic:** left at its default, which is on. Turning it off would be faster but give less privacy.

## Measurements
**Protocol probes (`eth_blockNumber`, one browser at a time):**
| Run | Tunnel up | First request | Warm request | Batch of 8 |
|---|---|---|---|---|
| Probe | 33 s | 28 s | 2.9 s | |
| 1 | 26 s | 18 s | 2.7–3.1 s | 4.9 s |
| 2 | 23 s | 20 s | 0.8–0.9 s | 2.2 s |
| 3 | 48 s | 21 s | 1.0–1.1 s | 1.1 s |
| 4 | 34 s | Timed out, then 27 s | 0.9–1.3 s | 1.6 s |
| 5 | 34 s | 20 s | 1.0–1.6 s | 1.1 s |

**Failures:** of the 7 solo probes, 2 failed. In one, a chosen gateway didn't support `wss`. In the other, the tunnel reported `ready` but every request timed out for its whole life, and the state stayed `ready`, so only a request's failure reveals it. A reload is the fix, because a new tunnel usually picks a new exit.

**Load:** six clients at once on one laptop all failed during setup. A page run alongside another client also failed twice in a row, after over 4 minutes. Solo runs were fine, so these failures came from load on this machine or from bad exits, and I can't separate the two. A phone may be more limited than a laptop, and that's untested.

## What the design does with this
- **Mode per page load.** `?nym=1` decides it, so a routed page sends nothing direct, even on its first read. The toggle reloads the page, which also gives a new tunnel a clean start.
- **Never direct on its own.** A failure stops the read and offers "Try a new connection" or "Turn off Nym and connect directly".
- **Queue and limits.** One request at a time, 75 s each, batches of 8, one retry, no fallback RPC. Three failures in a row, or 150 s of setup, end in the failure message.
- **Loaded on demand.** The 18 MB chunk is fetched only when the toggle is on, so the default page and the EF demo don't load it.

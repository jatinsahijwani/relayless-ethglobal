// Optional: sends this page's Sepolia reads through the Nym mixnet. Only public endpoints: the mixnet can't reach
// localhost, so the local chain, the sidecar and the approval server stay direct.
//
// The mode is fixed for each page load, from `?nym=1`. A tunnel can't be restarted or moved to another exit without a
// reload, and starting from the address means a routed page sends nothing direct, even on its first read.
import { useSyncExternalStore } from "react";
import { createEnsReader, type EnsConfig, type EnsTransportOptions } from "@relayless/sdk/ens";

export type NymStatus =
  | { state: "off" }
  | { state: "connecting"; since: number }
  | { state: "ready"; requests: number; lastMs: number | null; waitingSince: number | null; rpc: string | null }
  | { state: "failed"; reason: string };

/** Picked from measurements: see docs/nym-notes.md. */
const SETUP_LIMIT_MS = 150_000;
const CONNECT_TIMEOUT_MS = 60_000;
const REQUEST_LIMIT_MS = 75_000;
const FAILURES_BEFORE_GIVING_UP = 3;
const MAX_BATCH = 8;
const BATCH_WAIT_MS = 150;

export const nymRequested = (() => {
  try {
    return new URLSearchParams(location.search).get("nym") === "1";
  } catch {
    return false;
  }
})();

let status: NymStatus = nymRequested ? { state: "connecting", since: Date.now() } : { state: "off" };
const listeners = new Set<() => void>();
function setStatus(next: NymStatus) {
  status = next;
  listeners.forEach((l) => l());
}
export const useNym = () => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => status);

type MixFetch = (url: string, init?: RequestInit) => Promise<Response>;
const limit = <T>(work: Promise<T>, ms: number, message: string) => {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]).finally(() => clearTimeout(timer));
};

let tunnel: Promise<MixFetch> | null = null;
function openTunnel(): Promise<MixFetch> {
  tunnel ??= (async () => {
    try {
      // 18 MB, and fetched only when someone turns this on.
      const { setupMixTunnel, mixFetch } = await import("@nymproject/mix-fetch");
      await limit(setupMixTunnel({ connectTimeoutMs: CONNECT_TIMEOUT_MS }), SETUP_LIMIT_MS, "the mixnet took too long to connect");
      setStatus({ state: "ready", requests: 0, lastMs: null, waitingSince: null, rpc: null });
      return mixFetch;
    } catch (e) {
      setStatus({ state: "failed", reason: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  })();
  return tunnel;
}
if (nymRequested) openTunnel().catch(() => {});

let queue: Promise<unknown> = Promise.resolve();
let failures = 0;
let active = 0;

/**
 * One at a time, because the tunnel handles them one at a time anyway, and each request's clock should start when it
 * does. Exits are shared, so an RPC may already be limiting this one for other people's traffic, and waiting doesn't
 * clear that. So a refusal moves to the next RPC, and stays there. A request that can't get through fails: it's never
 * retried with the normal fetch.
 */
const nymFetchTo = (rpcs: string[]) => ((_url: string, init?: RequestInit) => {
  const run = async () => {
    const mixFetch = await openTunnel();
    let response: Response | undefined;
    for (let tried = 0; tried < rpcs.length; tried++) {
      if (status.state === "failed") throw new Error(status.reason);
      const rpc = rpcs[active % rpcs.length];
      const started = Date.now();
      if (status.state === "ready") setStatus({ ...status, waitingSince: started });
      try {
        // mixFetch ignores signals. Stopping the wait doesn't stop the request, only our waiting for it.
        response = await limit(mixFetch(rpc, { method: init?.method, headers: init?.headers, body: init?.body }), REQUEST_LIMIT_MS, "the mixnet didn't answer in time");
      } catch (e) {
        failures += 1;
        active += 1;
        if (failures >= FAILURES_BEFORE_GIVING_UP) setStatus({ state: "failed", reason: e instanceof Error ? e.message : String(e) });
        else if (status.state === "ready") setStatus({ ...status, waitingSince: null });
        if (tried === rpcs.length - 1 || failures >= FAILURES_BEFORE_GIVING_UP) throw e;
        continue;
      }
      failures = 0;
      if (response.status !== 429) {
        if (status.state === "ready") setStatus({ state: "ready", requests: status.requests + 1, lastMs: Date.now() - started, waitingSince: null, rpc: new URL(rpc).host });
        return response;
      }
      console.warn(`mixnet: ${new URL(rpc).host} is limiting this exit, trying the next RPC`);
      active += 1;
    }
    if (status.state === "ready") setStatus({ ...status, waitingSince: null });
    return response!;
  };
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result;
}) as typeof fetch;

/** Options for every Sepolia read on this page. Off means the SDK's defaults, with nothing changed. */
export const ensTransportOptions = (cfg: EnsConfig): EnsTransportOptions =>
  nymRequested ? { fetch: nymFetchTo(cfg.routedRpcs?.length ? cfg.routedRpcs : [cfg.rpc]), timeoutMs: 0, batch: { batchSize: MAX_BATCH, wait: BATCH_WAIT_MS }, retryCount: 1, noFallbacks: true } : {};

export const ensReader = (cfg: EnsConfig) => createEnsReader(cfg, ensTransportOptions(cfg));

/** The SDK's errors on a failed read name the URL and payload, which says nothing useful to someone waiting on the mixnet. */
export const nymReadError = "Couldn't read this through the mixnet. Nothing was sent directly.";

export function reloadWithNym(on: boolean) {
  const url = new URL(location.href);
  if (on) url.searchParams.set("nym", "1");
  else url.searchParams.delete("nym");
  location.assign(url);
}

// ?demo=1 turns on the demo buttons and keeps raw addresses off camera. It changes what's shown, never what's checked.
export const demo = new URLSearchParams(window.location.search).get("demo") === "1";

/** An address where it matters, or a plain name for it in demo mode. */
export const named = (address: string, name: string) => (demo ? name : `${address.slice(0, 6)}…${address.slice(-4)}`);

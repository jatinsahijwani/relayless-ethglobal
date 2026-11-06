# World ID integration debrief

*Fill in the remaining blanks before submitting. Tested against World's staging service with the simulator; update this after any production run.*

## The product event that needs trust
A deposit leaving a privacy pool privately. The association set exists so the pool can show that its private withdrawals come from accountable participants, without knowing who sent what.

## Why this credential is the minimum sufficient
We use **Orb-level proof of a unique human** (`orbLegacy`).
- **Needed:** one person, once. Without uniqueness, one actor could approve unlimited wallets, and the set would mean nothing.
- **Not needed:** name, age, nationality or documents. Asking for them would defeat a privacy tool.
- **A weaker credential** wouldn't give the same uniqueness guarantee.
- **The trade-off:** people without an Orb verification can't be approved. The public exit means they never lose access to their money.

## What's verified where
| Check | Where |
|---|---|
| Proof validity | Server, through World's `POST /api/v4/verify/{rp_id}` |
| Signal equals depositor, one nullifier per address, depositor's signature, environment | Our server |
| Membership in the approved set | On-chain, by the withdrawal's zero-knowledge proof |

## Alternative path
Cancelling, having no credential, being rejected, or reusing a World ID leaves the money unapproved, and the protected action doesn't happen. A public exit still returns the money to the depositor.

## Debrief
**Time to first success:** ____

**Friction encountered:**
- ____
- The integration needs `app_id`, `rp_id` and a signing key, not just an app ID.
- The simulator's Cancel doesn't reach the app. The window waits on "Connecting…" until it's closed, so an app can't show a cancelled state from it, and closing the window had to be handled separately.
- The simulator has one fixed identity, so testing a second user or a rejection means clearing our own nullifier records first.
- The widget stays open after our server refuses a proof, so the user has to close it to continue.
- `signal_hash` is optional in the SDK's types, so binding a proof to a signal needs an explicit server check.

**Missing capabilities or documentation:**
- ____

**The single improvement with the greatest impact:** ____

# World ID integration debrief

*Template. Fill in the blanks after the first real verification, using what actually happened. Don't submit it with blanks.*

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
- From building against the SDK before first run: docs and types differ on `signal_hash` for 4.0 proofs (the type marks it optional), so binding a proof to a signal needed care. *Confirm this after a real run, or remove it.*
- From building: the integration needs `app_id`, `rp_id` and a signing key, not just an app ID. *Confirm whether this caused real friction, or remove it.*

**Missing capabilities or documentation:**
- ____

**The single improvement with the greatest impact:** ____

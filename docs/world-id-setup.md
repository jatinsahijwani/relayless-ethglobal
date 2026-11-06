# Turn on World ID

Everything is built; it needs three values. It has been tested against World's **staging** service using the simulator. Production, with a real World App and an Orb-verified ID, hasn't been tested.

1. At [developer.world.org](https://developer.world.org), create an app. If asked, choose **Enable World ID 4.0**. Create an action named `join-approved-set`.
2. Add these to `.env`. The signing key is a secret, and only the server reads it:
   ```sh
   WORLD_APP_ID=app_...
   WORLD_RP_ID=rp_...
   WORLD_SIGNING_KEY=0x...
   WORLD_ENVIRONMENT=staging   # staging with the simulator first, then production
   ```
3. Start it:
   ```sh
   scripts/setup-asp.sh                                   # once: funds the ASP key, deploys the approved-set pool
   RELAYLESS_NETWORK=local-asp pnpm --filter @relayless/asp start
   RELAYLESS_NETWORK=local-asp pnpm web
   ```
4. Test: add money, open **Get approved**, and verify using the simulator link in the World ID window. Then pay. Try each path below. The simulator has one fixed identity, so a second run sees it as already used: to repeat, stop the server and move `.relayless/asp-local-asp.json` aside.
5. Fill in [world-id-debrief.md](world-id-debrief.md) while it's fresh.

## Paths to demonstrate
| Path | What should happen |
|---|---|
| Verified | "You're approved", then a private payment lands |
| Close the World ID window | "You cancelled", nothing changes |
| Cancel in the simulator | The simulator doesn't tell the app, so the window stays on "Connecting…" until you close it |
| Invalid proof | World rejects it, nothing is approved, and payment stays refused |
| No Orb credential | Explains why, and offers a public exit |
| Same World ID, second wallet | "Already approved a different address" |
| Never verifies | Private payment refused; public exit returns the money |

## How it's protected
- The signing key stays on the server. The browser gets only a signed `rp_context`.
- World's API checks the proof, and our server checks the rest: signal equals the depositor, one nullifier per address, depositor's signature, matching environment.
- The circuit enforces membership, so a browser or a dishonest server can't fake approval.

**If an Orb credential is too strict for your demo:** change `orbLegacy` in `apps/web/src/screens/Approve.tsx` and explain the new choice in the debrief.

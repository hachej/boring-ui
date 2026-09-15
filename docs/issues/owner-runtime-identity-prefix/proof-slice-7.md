# Slice 7 proof — durable accepted-work queue

Bead: `factory-plugin-owner-runtime-identity-prefix-8pdn.7`

## Scope

The Agent-owned SQLite queue persists immutable request material together with the canonical accepted-work provenance and an admission fingerprint. Claiming requires a fresh host readmission that reproduces the complete canonical accepted-work context and fingerprint. Revoked, changed, or malformed authority terminates the queued item as rejected with an auditable reason; persisted provenance is never treated as a bearer capability.

Claim ownership distinguishes another live in-process handle from an abandoned/restarted owner. Work whose effect may have started is terminally `outcome-unknown`, including queue closure or recovery after process loss, and is never automatically dispatched twice. Slice 8 child-key derivation and Slice 9 consumer migration are intentionally excluded.

## Focused proof

- `pnpm --filter @hachej/boring-agent exec vitest run src/server/agent-host/__tests__/durableAcceptedWorkQueue.test.ts` — PASS, 1 file / 14 tests, including restart, retained/changed/revoked authority, complete request-identity drift, concurrent claim, live-handle observation, stale completion, and terminal unknown-outcome behavior.
- `pnpm --filter @hachej/boring-agent typecheck` — PASS.
- `node scripts/check-agenthost-cutover-matrix.mjs` — PASS, 20 rows / 43 final routes / 23 deleted historical routes / zero forbidden compatibility references.
- `git diff --check` — PASS.

## Review and residuals

Independent T1 review is required and is arranged by the parent lane. The queue is an internal Agent seam and is not exported or wired to a consumer in this slice; that migration remains Slice 9. SQLite's Node API remains runtime-experimental, matching the existing SQLite ledger implementation.

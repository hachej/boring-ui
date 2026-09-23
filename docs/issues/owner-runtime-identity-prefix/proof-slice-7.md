# Slice 7 proof — canonical durable accepted-work ledger

Bead: `factory-plugin-owner-runtime-identity-prefix-8pdn.7`

## Scope and architecture correction

The PR-only `DurableAcceptedWorkQueue` and its test were removed. Accepted work now has one persistence and idempotency authority: `AgentRequestLedger`, with the production implementation in `SqliteAgentRequestLedger`.

The canonical Gateway consumer passes its effect payload into `prepare`. The ledger canonicalizes and freezes strict JSON, verifies its digest, and binds it to the derived RunId and complete `AgentRequestKey`; there is no caller-authored queue id. A versioned transactional migration adds RunId uniqueness, claim ownership/token/expiry, settlement digests, and WAL-backed cross-process claims to existing databases.

Fresh Gateway authorization runs before every create/reclaim attempt. Reclaims additionally require the new accepted-work context (including Seat participation) to equal retained provenance. Live claims are handle-owned and heartbeated. Another connection can observe but cannot settle them. Pre-effect claims can resume only after expiry; expired in-flight work is terminally `outcome-unknown`, including a real child process killed with `SIGKILL`.

Terminal settlement is canonical-digest idempotent: the same result is a no-op and a different result raises `AGENT_REQUEST_CONFLICT`. Retention moves request/settlement digests and identity provenance to a tombstone while deleting queued request and result payloads. A durable SQLite ledger rejects `:memory:`; the existing in-memory implementation remains honestly discriminated as `in-memory`.

Slice 8 delegation remains untouched. No Pi runtime dependency was added.

## Focused proof

- `pnpm --filter @hachej/boring-agent exec vitest run src/server/agent-host/__tests__/requestLedger.test.ts` — PASS, 1 file / 36 tests. Coverage includes canonical JSON and NaN rejection, duplicate RunId, legacy migration, fresh Seat readmission, live-observer isolation, heartbeat/expiry, digest-idempotent settlement, sensitive-payload pruning, real child-process barrier contention, and `SIGKILL` expiry recovery.
- `pnpm --filter @hachej/boring-agent exec vitest run src/server/agent-host/__tests__/createAgentHost.test.ts` — PASS, 1 file / 27 tests. The restart test inspects the production Gateway-created ledger row and proves request material is persisted by the shipped consumer path.
- `pnpm --filter @hachej/boring-agent typecheck` — PASS.
- `git diff --check` — PASS.
- `pnpm --filter @hachej/boring-agent test` after building `@hachej/boring-ui-kit` — 247 files / 2515 tests passed; one unrelated channel-intention test failed from an undefined test fixture value. Its bounded rerun (`vitest run src/server/channels/__tests__/channelIntention.test.ts`) passed 12/12.
- `pnpm typecheck:changed` — not completed: dependency prebuild exceeded the 10-minute command budget before typechecking began. The focused Agent typecheck passed and the parent requested no further broad suites.

## Residuals

Node's SQLite API remains runtime-experimental, matching the pre-existing ledger implementation. Independent T1 review is owned by the parent lane.

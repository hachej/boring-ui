# Executable spikes — index and results

The original working trees at `~/projects/spike-*` were REMOVED 2026-08-19 on
owner instruction. The essential sources — schemas, proof scripts, key tests,
NOTES, measured artifacts — are archived in the per-spike subfolders here;
everything else (node_modules, bundles, transcripts) was reproducible bulk.
All spikes ran against pinned `@earendil-works/pi-agent-core@0.80.7` /
`pi-coding-agent@0.80.7`; celld 0.1.0; Flue 2.0.3. Each proved or refuted a
claim; results were carried into the recommendations and architecture plan.

Archived per spike: `durable-pause/` (schema.sql, durable-pause.js, worker,
test, mutate.mjs, restart-proof.sh) · `l0-schema/` (NOTES, schema.sql,
raw-schema-invariants test — the mutation-testing artifact) · `pi-storage/`
(NOTES, turn-worker, host-session-storage, two-process proof script) ·
`tool-catalog/` (README, catalog, harness, identity test, measured JSON) ·
`migration/` (proof.ts, event-store-migration, test) · `flue-celld/` (README,
AgentGateway→Flue shim.ts, node-server) · `dx-evidence-log.md` (onboarding DX
spike evidence).

| spike | question | result |
| --- | --- | --- |
| `spike-flue-celld` | does Flue run on self-hosted celld? | **proven** — deploys, durable stream, state survives node kill; celld gaps: empty `process.env`, 435ms cold start (vs 4ms advertised), config keys rejected. Includes AgentGateway→Flue shim (~170 lines) driving the real ChatPanel; wire modes proved opaque cursors/implicit sessions break the current front (12-file fix, +77/−106) |
| `spike-pi-storage` | can pi run on host-supplied storage at pinned 0.80.7? | **proven** — `SessionStorage` public seam; two real turns in separate PIDs from one host-owned JSONL; `~/.pi` byte-identical before/after |
| `spike-durable-pause` | does a journaled human-input pause survive SIGKILL? | **proven** — pause row survives, resume from journal, 5 constraint-enforced invariants. Production runner re-entry remains open (C6 work) |
| `spike-l0-schema` | canonical record mega-schema | **REFUTED ×2** — 8 fatal, rewritten, 17 fatal + 20 serious; mutation testing exposed that 17 green tests survived deleting the constraints (invariants lived in the adapter) |
| `spike-migration` | import real pi JSONL transcripts | **proven** — 4,229-line transcript round-trip |
| `spike-tool-catalog` | #1226's host-side catalog dispatch | **REFUTED in part** — pi emits only `toolName:"call_tool"`, provider-wire identity lost (`test/identity.test.js`). Exposure numbers (artifacts here): 40 tools all-resident 10,344B; summaries+call_tool 2,867B (−72%); search+call 1,129B but +1 round-trip/task with decaying advantage (`multiturn-comparison.json`, `token-costs.json`) |

# todos-v2 — handoff-ready work orders (v2 plan)

Each `TODO-*.md` in this folder is a **self-contained work order for one autonomous coding agent** (pi, gpt-5.5-xhigh, or similar). An agent receives exactly one TODO file plus repo access; it must not need this README or the conversation history — but hand it this README too when possible, for the dependency graph.

Supersedes `../todos/TODO-00..07` where they overlap; unchanged v1 material is referenced, not duplicated.

## Dispatch protocol

1. One TODO file = one agent assignment. Do not hand two files to one agent run.
2. Respect the dependency graph below. Parallel lanes are safe to dispatch concurrently.
3. Every PR produced must cite: the TODO bead id, the area plan file (00–09), the migration phase (../06-migration-phases.md), and the acceptance section (../07-tests-review-acceptance.md).
4. Work happens on a dedicated branch per bead or per TODO (agent's choice, small PRs preferred). Never on main, never in a shared checkout.
5. Behavior freeze unless the bead explicitly changes a documented invariant. The landed #416 contracts (`packages/boring-bash/src/shared`) are load-bearing for the governance PR line — extending is fine, breaking is not.
6. Each TODO ends with Verification commands and Review gates — a bead is done when both pass, not when code compiles.

## Dependency graph

```txt
TODO-P0-adr-decisions ──► TODO-P1-headless-core ──┬──► TODO-P2-bash-package-providers ──► TODO-P3-routes-tools-move ──► TODO-P4-file-ui-plugin
                                                  │            └──► TODO-E1-environment-attachments ──► TODO-E2-mcp-projection
                                                  └──► TODO-T1-durable-events-approvals ──► TODO-T2-transport-adapters ──► TODO-S1-slack-channel ──► TODO-S2-embed-contract
```

Parallel lanes after P1: **bash lane** (P2→P3→P4), **environment lane** (E1→E2, needs P2), **transport lane** (T1→T2→S1→S2). Phases 5–8 (below) follow their listed prerequisites.

## Work orders

| File | Phase (../06) | Depends on | Size |
| --- | --- | --- | --- |
| `TODO-P0-adr-decisions.md` | Phase 0 | — | S |
| `TODO-P1-headless-core.md` | Phase 1 | P0 | L |
| `TODO-T1-durable-events-approvals.md` | Phase T1 | P1 | L |
| `TODO-T2-transport-adapters.md` | Phase T2 | T1 | M |
| `TODO-P2-bash-package-providers.md` | Phase 2 | P1 | M |
| `TODO-P3-routes-tools-move.md` | Phase 3 | P2 | M/L |
| `TODO-P4-file-ui-plugin.md` | Phase 4 | P3 | M |
| `TODO-E1-environment-attachments.md` | Phase E1 | P2 | M |
| `TODO-E2-mcp-projection.md` | Phase E2 | E1 | M |
| `TODO-S1-slack-channel.md` | Phase S1 | T2 (+P1) | M |
| `TODO-S2-embed-contract.md` | Phase S2 | S1 | S/M |

## Phases 5–8 — not re-authored here (v1 TODOs remain canonical, with these v2 deltas)

Dispatch these from `../todos/` when their prerequisites complete; apply the deltas:

- **Phase 5 (provisioning/readiness)** — `../todos/TODO-03*`: add one bead — *credential brokering rule*: secrets injected at the environment boundary (provider adapter), never into sandbox process env or model transcript; test: no sandbox-side read of a brokered secret (08 trust boundary).
- **Phase 6 (plugin/child-app)** — unchanged; prerequisite on the shared child-app platform plan stands.
- **Phase 7 (multi-agent)** — add: surface adapters address agents via the same `agentId` scoping; one addressing entry binds to one `agentId`; test: two surfaces × two agents in one workspace do not collide.
- **Phase 8 (cleanup)** — add exit criterion: `@hachej/boring-agent` README documents the four-part surface contract (../08) as the stable public API.

## Simplicity & no-compat policy (applies to every TODO — read as binding)

All `@hachej/*` consumers live in this monorepo. There is **no external migration audience** and therefore **no deprecation windows, no deprecated aliases, no `/legacy` paths, no type-only re-export stubs that outlive their phase**. At 0.x, breaking an internal API is free — the rule is:

1. **Migrate every importer in the same PR** that moves or renames a thing. Grep is the migration tool, not a shim.
2. **Transitional code has a deadline.** If an old path must stay alive while the new one lands (e.g. `?cursor=` NDJSON until the T2 cutover), it carries a `// TODO(remove:<bead-id>)` marker and a deletion bead **in the same TODO file**. A phase is not done while any of its markers remain. Phase 8 *verifies* zero markers — it is not a dumping ground for deferred deletions.
3. **No abstraction without two real consumers in the same phase** (or one named consumer in the immediately following phase of this pack). No "might need later" parameters, no speculative generics, no registry/plugin system for a single entry, no config indirection beyond the one typed config object.
4. **No parallel implementations past their cutover.** When the DS transport passes conformance, the bespoke replay dies in the same PR stack. When tools/routes move to boring-bash, the origin files are deleted, not stubbed.
5. **New options never grow env-var fallbacks.** Env/file parsing lives in host/CLI composition only (P1).
6. **If a bead seems to need a compat shim for anything outside this repo — stop and ask.** Do not build it speculatively.

The only legitimate compat surfaces (do NOT break these): on-disk pi session JSONL (existing user sessions must load), the landed #416 shared contracts in `packages/boring-bash/src/shared` (governance PRs consume them), and server↔front within one release train (see versioning below).

## Versioning & flagging (how cutovers ship)

No feature-flag framework. Version is carried where it already exists:

- **Wire**: `AgentEvent.v` is the protocol version (starts at 1); DS stream routes are **new paths** added in T1 alongside the old `?cursor=` route, so old front + new server coexist during development. That additive window *is* the flag — T2 flips the front, then deletes the old route in the same phase (rule 2).
- **Dark-launch seam**: the front transport is already injectable (`usePiSessions({ createRemoteSession })`). T2 may land the DS transport dark behind that injection for at most one PR, then flip the default and delete the legacy path. Do not add a user-facing toggle.
- **Package**: bump `@hachej/boring-agent` minor at the T2 cutover (protocol change) and at P3 (tool/route relocation). Server and front ship together in the CLI package, so no long-lived skew exists; the only skew is the dev-time stale front bundle (`pnpm -C packages/cli build:front` after merges).

## Global non-negotiables (apply to every TODO)

- `@hachej/boring-agent` keeps **zero value imports** from `@hachej/boring-bash` (enforced: `packages/boring-bash/scripts/check-invariants.mjs` — extend, don't bypass).
- Surfaces never own the loop; surface packages import only the public agent contract (+ their channel ingress package).
- Two handles: `sessionId` runtime-owned; platform addressing surface-owned; public agent APIs never accept platform addressing.
- One approval channel: HITL declared on the tool, travels as stream events.
- `filesystem + path + operation + actor` is the resource identity; path alone never selects a filesystem.
- Existing workspace behavior and company_context no-leak conformance stay green in every phase.
- EU-sovereign defaults (00 invariant 15): no bead may introduce a US-hosted service as a default or hard dependency; US-hosted providers are optional providers behind the capability matrix.

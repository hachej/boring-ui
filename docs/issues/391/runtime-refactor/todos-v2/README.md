# todos-v2 — handoff-ready work orders (v2 plan)

Each `TODO-*.md` in this folder is a **self-contained work order for one autonomous coding agent** (pi, gpt-5.5-xhigh, or similar). An agent receives exactly one TODO file plus repo access; it must not need this README or the conversation history — but hand it this README too when possible, for the dependency graph.

Supersedes the now-**non-canonical** `../todos/TODO-00..07` where they overlap; unchanged v1 material is referenced, not duplicated.

## Dispatch protocol

1. One TODO file = one agent assignment. Do not hand two files to one agent run.
2. Respect the dependency graph below. Parallel lanes are safe to dispatch concurrently.
3. Every PR produced must cite: the TODO bead id, the area plan file (00–09), the migration phase (../06-migration-phases.md), and the acceptance section (../07-tests-review-acceptance.md).
4. Work happens on a dedicated branch per bead or per TODO (agent's choice, small PRs preferred). Never on main, never in a shared checkout.
5. Behavior freeze unless the bead explicitly changes a documented invariant. The landed #416 contracts (`packages/boring-bash/src/shared`) are load-bearing for the governance PR line — extending is fine, breaking is not.
6. Each TODO ends with Verification commands and Review gates — a bead is done when both pass, not when code compiles.

## Dependency graph

```txt
TODO-P0 ──► TODO-P1 ──┬──► TODO-P2 ──► TODO-P3 ──┬──► TODO-P4
                      │                          ├──► TODO-E1 ──► TODO-E2
                      │                          └──► TODO-P5 ──► TODO-P6a ─┬─► TODO-P7 ──► TODO-P8
                      │                                                     └─► TODO-P6b (child-app scoping)
                      └──► TODO-T1 ──► TODO-T2 ──┬──► TODO-S1 ──► TODO-S2
                                                └──► TODO-S3

Cross-deps not drawable inline: E1 needs P2 **and** P3; **P6 splits into P6a and P6b** — P6a
(child-app-independent: manifest validation, plugin runtime context, AgentRegistry, hosted-plugin
fail-closed, shared runtime, reload) is ← P5; P6b (child-app scoping: BBP6-001, BBP6-006) is ← P6a
**and** the shared child-app platform type (`ResolvedChildAppContext`, #376), **HARD BLOCKED** until
it lands; **P7 needs P6a and E1 and T2** (the AgentRegistry from P6a, not P6b's child-app scoping; E1
attachments; and T2's `sessionId`-only transport + two-handles guard, which carries the T1 durable
approvals/`resolveInput` the external-hook route and `/info` channel facts read); P8 gates
on **all** lanes **except P6b** — P6b is a **tracked follow-up** gated on the shared child-app platform
type, **not an epic exit gate**: the epic ships without it and P8 only verifies the P6b follow-up issue
is filed (it never waits on P6b landing); S3 also needs P7 (and T2).
```

Parallel lanes after P1: **bash lane** (P2→P3→P4), **environment lane** (E1→E2, needs P2+P3), **provisioning→child-app→multi-agent lane** (P5→P6a→P7→P8, off P3; P6b branches off P6a and is HARD BLOCKED on the shared child-app platform type), **transport lane** (T1→T2→{S1→S2, S3}). Phases 5–8 + S3 are canonical v2 work orders (below), each following its listed prerequisites.

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
| `TODO-E1-environment-attachments.md` | Phase E1 | P2, P3 | M |
| `TODO-E2-mcp-projection.md` | Phase E2 | E1 | M |
| `TODO-P5-provisioning-secrets.md` | Phase 5 | P3 | L |
| `TODO-P6-plugin-child-app.md` | Phase 6 | **P6a**: P5 · **P6b**: P6a + child-app platform type (HARD BLOCKED) | L |
| `TODO-P7-multi-agent-inspection.md` | Phase 7 | P6a (AgentRegistry) + E1 + T2 | L |
| `TODO-P8-verification-cleanup.md` | Phase 8 | all lanes | M |
| `TODO-S1-slack-channel.md` | Phase S1 | T2 (+P1) | M |
| `TODO-S2-embed-contract.md` | Phase S2 | S1 | S/M |
| `TODO-S3-control-plane-ux.md` | Phase S3 | T2 + P7 | M |

## Phases 5–8 + control-plane UX — canonical v2 work orders (in this folder)

These are now first-class v2 work orders here — **no longer delegated to `../todos/`**. Dispatch each when its prerequisites (dispatch table above) complete:

- **`TODO-P5-provisioning-secrets.md`** (Phase 5, off P3) — provisioning/readiness extension + the *credential brokering rule*: brokered secrets are host-side handles consumed only by trusted-core tools and never enter any sandboxed environment (the `direct` provider is a host process, not a sandbox — nothing is injected there) (00 invariant 14, 08 trust boundary).
- **`TODO-P6-plugin-child-app.md`** (Phase 6, **split into P6a/P6b**) — **P6a** (manifest validation, plugin runtime context, `AgentRegistry`, hosted-plugin fail-closed, shared runtime, reload) dispatches off **P5** and is child-app-independent (grep-gated: zero child-app fields in the three named contracts); **P6b** (consume resolved child-app context, Macro scoping) is **HARD BLOCKED** on the shared child-app platform type (`ResolvedChildAppContext`, #376) — STOP-and-report, no local fallback shape, and do not define a competing child-app registry here.
- **`TODO-P7-multi-agent-inspection.md`** (Phase 7, off **P6a** [the `AgentRegistry`, not P6b's child-app scoping] **+ E1 + T2**) — multi-agent routing/session/search + the agent inspection endpoint; surface adapters address agents via the same `agentId` scoping (one addressing entry → one `agentId`).
- **`TODO-P8-verification-cleanup.md`** (Phase 8, gates on **all** lanes **except P6b**) — verification phase: assert zero `TODO(remove:*)` markers repo-wide; `@hachej/boring-agent` README documents the four-part surface contract (../08) as the stable public API. **P6b is a tracked follow-up (gated on the shared child-app platform type), not an epic exit gate** — P8 does not wait on it; it only verifies the P6b follow-up issue is filed.
- **`TODO-S3-control-plane-ux.md`** (Phase S3, off T2 **and** P7) — workspace-as-control-plane UX (08 "The steering surface").

`../todos/TODO-00..07` are **NON-CANONICAL wherever they conflict with the v2 pack** — in particular their compat-export / re-export shim / deprecation-window language contradicts the v2 no-compat policy below. Consult them only for v1 bead intent that the v2 files explicitly reference; where they disagree, the v2 files (and this README) win.

## Simplicity & no-compat policy (applies to every TODO — read as binding)

All `@hachej/*` consumers live in this monorepo. There is **no external migration audience** and therefore **no deprecation windows, no deprecated aliases, no `/legacy` paths, no type-only re-export stubs that outlive their phase**. At 0.x, breaking an internal API is free — the rule is:

1. **Migrate every importer in the same PR** that moves or renames a thing. Grep is the migration tool, not a shim.
2. **Transitional code has a deadline.** If an old path must stay alive while the new one lands (e.g. `?cursor=` NDJSON until the T2 cutover), it carries a `// TODO(remove:<bead-id>)` marker and a deletion bead. A phase is not done while any of its markers remain. Phase 8 *verifies* zero markers — it is not a dumping ground for deferred deletions. **Cross-TODO cutover carve-out (deletion-bead ownership):** the deletion bead a marker names may live in a **later** TODO than the one that introduced the transitional code, **as long as the marker explicitly names that owner**. Canonical case: the legacy `?cursor=` NDJSON path (and the `pi-chat/:sessionId/*` write routes) is kept alive across T1 but its **deletion is owned by `BBT2-006` in `TODO-T2`** — so a `TODO(remove:BBT2-006)` marker planted in T1-era code is legitimately deleted by its **named T2 owner** at the T2 cutover, not by T1. The invariant that survives: **every marker names a real deletion bead, and no marker outlives its named owner's phase** (Phase 8 still verifies zero remain repo-wide).
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

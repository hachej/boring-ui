# TODO-P8 — Verification and cleanup (zero deferred deletions)

Handoff: self-contained work order for one autonomous coding agent (pi or gpt-5.5-xhigh). Cite plan files by relative path. No prior conversation assumed.

## Context (read first)

- Plan: `docs/issues/391/runtime-refactor/INDEX.md` § "Phase 8 — Verification + cleanup" — the v2 rewrite: **Phase 8 is a VERIFICATION phase, not a deferred-deletion dump.** Assert zero `TODO(remove:*)` markers repo-wide (add to invariant scripts); update package docs; convert remaining plan tasks into beads/issues. There is no "migration window" — all import migrations happened in-PR per the no-compat policy. Additional exit criterion: `@hachej/boring-agent` README documents the four-part surface contract (`08`) as the stable public API.
- Plan: `docs/issues/391/runtime-refactor/INDEX.md` — the BINDING "Simplicity & no-compat policy". Rule 2 is the one P8 enforces: "Transitional code has a deadline … carries a `// TODO(remove:<bead-id>)` marker and a deletion bead. A phase is not done while any of its markers remain. **Phase 8 verifies zero markers — it is not a dumping ground for deferred deletions.**" Rule 4: no parallel implementations past their cutover. **Cross-TODO owners are legitimate:** rule 2's cutover carve-out lets a marker name a deletion bead that lives in a **later** TODO than the one that introduced the transitional code (canonical case: the `?cursor=` legacy path's `TODO(remove:BBT2-006)` is owned by `TODO-T2`, not the T1-era code that planted it). P8 does not care *which* TODO owns a marker — it enforces that **every surviving marker names a real deletion bead and that its named owner's phase has landed** (i.e. zero markers repo-wide at exit); a marker whose named owner is a later, still-in-flight TODO simply means that owner phase is not done yet, not that P8 must absorb it.
- Plan: `docs/issues/391/runtime-refactor/architecture/08-pluggable-agent-surfaces.md` § "What every framework converges on" — the **four-part surface contract** to be documented as stable public API: (1) message in (`AgentSendInput`), (2) indexed replayable event stream out (`AgentEvent`), (3) approvals as request→response events on the same stream (`resolveInput` / `ResolveInputResponse`), (4) runtime-owned `sessionId` + surface-owned addressing (two handles). Also § "The headless façade: `createAgent()`" (the full public runtime API) and § "Decisions this file locks".
- Plan: `docs/issues/391/runtime-refactor/architecture/00-global-isa.md` invariants (all must be green at exit) and § "Issue coverage posture" (what this plan is allowed to claim vs merely support with extension points).

### Depends on

- **Every delivered runtime phase** of this pack **except P6b, M1, M2, D1, and S4; M2 may land after P8 as a committed follow-up** (P1–P7, T1–T2, E1–E2, **X1**, S1–S3, Phase 5, **P6a**). S3 is in the epic (VISION row 6 — workspace-as-control-plane — requires it), and X1 is in the epic (mount/farm substrate), so P8 gates on both. P8 is the terminal runtime gate. It **must not** land while any earlier runtime phase's `TODO(remove:*)` marker is still live — that reopens the owning phase (see "The rule", below).
- **P6b, M1, M2, D1, and S4 are explicitly NOT P8 gates; M2 may land after P8.** P6b (child-app scoping, BBP6-001/BBP6-006) is HARD BLOCKED on the shared child-app platform type (`ResolvedChildAppContext`, #376) and is a **tracked follow-up outside the epic exit** — the epic ships without it. M1 is the outreach-demo sidecar; D1/S4 are factory/onboarding follow-ups; M2 is the committed MCP agent-surface follow-up. **P8 does not wait on those lanes landing**; it only **verifies their follow-up/status tracking is filed** (BBP8-004). This is what prevents a P8 exit deadlock: P8 gating on every lane would otherwise be unsatisfiable while follow-up lanes are intentionally outside the runtime epic exit.

### Current repo reality this bead verifies (verified paths)

- **No `TODO(remove:` markers exist yet** — `! rg -n "TODO\\(remove:" packages apps plugins scripts` exits 0 today. Markers are introduced by earlier phases (T1's `?cursor=` window, T2's front cutover, P2's provider move, etc.) and deleted in-phase. P8 asserts the count is back to **zero** across the whole repo.
- Invariant script wiring to extend (do NOT bypass — `README.md` global non-negotiable): root `pnpm lint:invariants` = `pnpm --dir packages/agent run lint:invariants && pnpm --filter @hachej/boring-bash run check:invariants && pnpm lint:workspace-plugin-invariants` (verified `package.json`). Root `pnpm audit:imports` = `pnpm tsx scripts/audit-imports.ts`. Agent invariants = `bash scripts/check-invariants.sh .` (ripgrep-based `run_check` pattern helper, verified `scripts/check-invariants.sh`). `scripts/audit-imports.ts` holds the `FORBIDDEN_PATTERNS` array (verified) — the natural home for old-path-import gates.
- **Moved-path gates to assert empty** (each was migrated + deleted in-PR by its phase; P8 proves no straggler importer resurfaced):
  - P2/P3: no `@hachej/boring-agent/server` value import of moved providers (`createDirectSandbox`, `createBwrapSandbox`, `createRemoteWorker*`, `createVercelSandboxWorkspace`) — they live under `@hachej/boring-sandbox/providers` now — nor of `resolveMode`/`autoDetectMode`/`hasBwrap` — those live under `@hachej/boring-bash/modes` now. Also assert agent has zero value import from `@hachej/boring-sandbox`.
  - P4: no `filesystemPlugin` import from `@hachej/boring-workspace` (moved to `@hachej/boring-bash/plugin`); no `boring-bash/plugin → @hachej/boring-workspace` value import.
  - T1/T2: no live `ask-user.v1.*` WorkspaceBridge handler (deleted in BBT1-005); no `?cursor=` NDJSON front path / `schedulePiChatReconnect` / `replay_gap` recovery (removed in T2 BBT2-003); `piChatReplayBuffer.ts` gone if T2 removed it.
- README to update: verified current package reality is that `packages/agent/package.json` has **no** `"readme"` field and ships `files: ["dist", "docs"]`; the canonical package README is therefore `packages/agent/README.md`, with `packages/agent/docs/runtime.md` as the runtime deep-dive. P8 must document the four-part surface contract + `createAgent()` public API in those docs. Do not put contract authority in a front entrypoint header.

## Goal / exit criteria

Match [`../../INDEX.md`](../../INDEX.md) Phase 8 (v2):

1. **Zero `TODO(remove:*)` markers repo-wide**, asserted by a check wired into `pnpm lint:invariants` (fails CI if any marker survives).
2. `@hachej/boring-agent` package docs document the **four-part surface contract** (`08`) + the `createAgent()` public runtime API as the stable public surface.
3. Remaining plan tasks (anything in `00`–`09` not yet a landed bead, plus the explicitly deferred boundaries) converted into tracked beads/issues — nothing left only in prose.
4. No code imports old moved paths (grep gates green for every relocation in P2/P3/P4/T1/T2).
5. All `00` invariants + package invariant scripts + `audit:imports` green; full build+test green.

## Non-negotiables

- **The rule (state it, enforce it): a surviving `TODO(remove:*)` marker reopens the phase of its NAMED deletion-bead owner** (which, per rule 2's cross-TODO carve-out, may be a *later* TODO than the one that planted the marker — e.g. `TODO(remove:BBT2-006)` reopens T2, not the T1-era code that carries it). P8 does NOT delete other phases' transitional code and does NOT convert a live marker into a new "cleanup later" bead. If the marker is still live, its named owner's phase is not done — file it back to that owner phase, do not absorb it here ([`../../README.md`](../../README.md) rule 2; [`../../INDEX.md`](../../INDEX.md) Phase 8: "not a dumping ground for deferred deletions").
- Extend the existing invariant scripts; do NOT add a parallel lint framework (`README.md` global non-negotiable: "extend, don't bypass").
- Documentation states the **stable** public API only — the four-part contract, `createAgent()`, the two-handles rule. Do not document internal/transport internals as public.
- Do NOT relax any `00` invariant to make the gate pass. If an invariant genuinely cannot hold, that is a finding to escalate, not to weaken.
- Respect the legitimate compat surfaces that MUST stay (never "clean these up"): on-disk pi session JSONL, the landed #416 shared contracts (`packages/boring-bash/src/shared`), server↔front within one release train (`README.md` / `08` decision 10).

## Do NOT

- Do NOT touch `/home/ubuntu/projects/boring-ui-v2`. Work on a dedicated branch/worktree per the PR-PLAN branch naming; never commit to main directly; every bead lands as a PR per INDEX.
- Do NOT delete another phase's transitional code to make the marker count zero — reopen that phase instead.
- Do NOT introduce a new deferred-deletion marker or a "Phase 9" dumping ground.
- Do NOT remove the #416 shared contracts, the JSONL session compat, or any still-in-train server↔front seam.
- Do NOT re-add old-path re-export shims to "fix" a gate — the fix is migrating the straggler importer.

## Beads

### BBP8-001 — Repo-wide `TODO(remove:*)` marker gate (zero-tolerance) · size S
- **Title**: A check that fails if any `TODO(remove:<bead-id>)` marker remains, wired into `pnpm lint:invariants`.
- **Files create/touch**: create `scripts/check-no-remove-markers.mjs` (repo-wide ripgrep/glob scan for the literal `TODO(remove:` across `packages/`, `plugins/`, `apps/`, `scripts/` — excluding `node_modules`, `dist`, and this `docs/issues/391/**` plan folder, which legitimately *describes* the marker regime). Print each offending file:line and the owning bead id parsed from the marker, then exit non-zero. Wire it into root `package.json`: add to the `lint:invariants` chain (or `lint`) so `pnpm lint:invariants` runs it. Do not put it in `check-invariants.sh` (that is scoped to a single package root; the marker gate is repo-wide).
- **Notes**: The scan must extract the bead id inside `TODO(remove:<id>)` and print it, so a surviving marker names the phase to reopen (enforces "the rule"). Zero markers exist today → the gate passes on introduction; it only bites when an earlier phase left one live.
- **Tests**: `scripts/__tests__/check-no-remove-markers.test.mjs` (or inline) — a temp fixture containing `TODO(remove:BBX-001)` makes the script exit non-zero and print `BBX-001`; a clean tree exits 0. Assert the real repo is currently clean.
- **Acceptance**: `pnpm lint:invariants` includes the marker gate; a planted marker fails it naming its bead; the repo is clean (0 markers).

### BBP8-002 — Document the four-part surface contract as stable public API · size M
- **Title**: `@hachej/boring-agent` package docs describe the four-part surface contract + `createAgent()` as the stable public API.
- **Files touch/create**: `packages/agent/README.md` (canonical package README; package.json has no `readme` field) + `packages/agent/docs/runtime.md`. Document, from `08`: (1) message in — `AgentSendInput { sessionId?, content, inputAssets?, actor, ctx?, originSurface? }` (omit `sessionId` to start a session; `inputAssets?` are user-supplied files/images/blobs routed by the T2 intake strategy, not a capability axis); (2) event stream out — the indexed replayable `AgentEvent { v, eventIndex, timestamp, sessionId, chunk }`; (3) approvals — `needsApproval` on the tool → request event → `resolveInput(sessionId, requestId, ResolveInputResponse)`, one channel; (4) two handles — runtime-owned `sessionId`, surface-owned addressing; public APIs accept `sessionId`/`SessionCtx` only. Include the `createAgent()` façade surface — the **nine** members `start`/`stream`/`send`/`resolveInput`/`interrupt`/`stop`/`sessions`/`readiness`/`dispose` (`interrupt(sessionId)` = abort current turn, `stop(sessionId)` = end/close session) — and the surface-adapter three-step (`08` § "Surface adapters"). Link the conformance suites (`08` § "Conformance") as the executable contract.
- **Notes**: This is the [`../../INDEX.md`](../../INDEX.md) Phase 8 additional exit criterion and README Phase 8 delta. Keep it a description of what shipped (P1/T1/T2/S1) — do not spec new API. If the `AGENTS.md`/`DECISIONS.md` ADR from Phase 0 needs a back-reference, add a one-line pointer, do not duplicate.
- **Tests**: doc build/lint if the repo has one (`pnpm check:generated-artifacts` if docs are generated); otherwise a link-check that the referenced symbols exist (`createAgent`, `AgentEvent`, `AgentSendInput`, `ResolveInputResponse`) as exports.
- **Acceptance**: the four-part contract + `createAgent()` are documented as stable public API; referenced symbols exist.

### BBP8-003 — Old-moved-path import gates (P2/P3/P4/T1/T2 relocations) · size M
- **Title**: Assert no importer of any relocated symbol/path resurfaced; each relocation gate is green.
- **Files touch**: `scripts/audit-imports.ts` `FORBIDDEN_PATTERNS` (and/or the package `check-invariants` scripts) — add patterns proving the migrations are complete and no straggler exists:
  - agent old provider exports: `createDirectSandbox`/`createBwrapSandbox`/`createRemoteWorker*`/`createVercelSandboxWorkspace` (now in `@hachej/boring-sandbox/providers`) and `resolveMode`/`autoDetectMode`/`hasBwrap` (now in `@hachej/boring-bash/modes`) are not exported from `@hachej/boring-agent/server` and not imported from there. Agent has zero value import from either `@hachej/boring-bash` or `@hachej/boring-sandbox`; the sandbox→agent edge is type-only.
  - `filesystemPlugin` is not exported/imported from `@hachej/boring-workspace` (it lives in `@hachej/boring-bash/plugin`).
  - no live `ask-user.v1.*` bridge handler; no `?cursor=` NDJSON front transport / `schedulePiChatReconnect` / `replay_gap` recovery; `piChatReplayBuffer.ts` absent if T2 removed it.
- **Notes**: Most of these gates were added in-phase (P2 BBP2-008, P4 BBP4-014, T2 BBT2-004). P8 **confirms they are present and green**, and adds any that a phase omitted. A straggler importer here is a **missed in-PR migration** — fix by migrating the importer, never by re-adding a shim (`README.md` rule 1/4).
- **Tests**: run the gates against the repo; deliberately add a banned import in a scratch file → gate fails; revert. Each relocation has a corresponding passing assertion.
- **Acceptance**: every P2/P3/P4/T1/T2 relocation gate present and green; no old-path importer anywhere.

### BBP8-004 — Convert remaining plan prose into tracked beads/issues · size S
- **Title**: Nothing actionable left only in `00`–`09` prose; everything is a landed bead or a tracked follow-up issue.
- **Files touch**: create tracking issues/beads (per the repo's `br`/beads workflow) for the explicitly deferred items and any un-beaded plan task. Known deferrals to file as future issues (do NOT implement here):
  - agent-as-directory authoring (north star, `00`/`08` — deferred post-P7, its own future issue);
  - `FileTreeDataProvider` pluggable boundary (deferred to `#295`, P4 BBP4-012);
  - the **document-authority write/edit override seam** (the whole seam — not just a registry — deferred out of this epic; arrives with its first real authority implementation #367/#226, P4 BBP4-013);
  - **governed-context-in-embeds** (injecting a readonly `company_context` binding into a spreadsheet/product embed) — the **post-E2 follow-up** descoped from S2 (`TODO-S2` BBS2-001);
  - **P6b — child-app scoping** (BBP6-001 consume `ResolvedChildAppContext`, BBP6-006 Macro scoping) — HARD BLOCKED on the shared child-app platform type (`ResolvedChildAppContext`, #376); a **tracked follow-up OUTSIDE the epic exit**. **P8 files this follow-up issue and confirms it is filed — it does not wait on P6b landing**;
  - **M2 — MCP agent surface** (`work/M2-mcp-agent-surface/`) — committed follow-up that may land after P8; P8 verifies it is tracked with its registry/exposure/conformance scope;
  - **D1 — tenant provisioning** (`work/D1-tenant-provisioning/`) — factory lane outside the runtime epic exit; P8 verifies it is tracked with M2/P6a/P5 prerequisites;
  - **S4 — agent onboarding status** (`work/S4-agent-onboarding/`) — onboarding/status follow-up outside the runtime epic exit; P8 verifies it is tracked with S3/M2/D1 prerequisites;
  - `00` still-open decisions 5 (provisioning sharing defaults) and 7 (surface addressing store location); decision 3 (providers package location) is already resolved by `08` decision 11 and must not be reopened;
  - any Phase 5 (provisioning/readiness) and Phase 6a task not yet beaded.
- **Notes**: This bead **catalogs and files**, it does not build. Cross-check each `00` § "Issue coverage posture" item: mark which acceptance actually landed (so the plan does not overclaim) and file the rest. It also runs the plan-pack navigability gate from `07`: canonical files outside legacy `todos/` must not reference old nonexistent TODO filenames or the removed architecture-six file; every cross-work-package pointer should be a real relative link, with `INDEX.md` as the single ordering authority.
- **Tests**: n/a (tracking artifacts). Acceptance is the filed issue list referenced from the plan or a `docs/issues/391/runtime-refactor/BACKLOG.md`-style index if the repo prefers in-repo tracking.
- **Acceptance**: every deferred/un-beaded plan task has a tracked issue/bead id; no actionable item lives only in prose. **The P6b, M2, D1, and S4 follow-up/status tracks are filed** (and P8 confirms they are filed, without gating on those lanes landing).

### BBP8-005 — Final invariant + build/test sweep · size S
- **Title**: The whole pack's guarantees hold simultaneously.
- **Files touch**: none (verification bead); fix-forward only if a gate fails (each fix is a finding routed to its owning phase, not patched here).
- **Notes**: Run the full gate set (Verification section). Any red gate that traces to an earlier phase is escalated to that phase (reopen), consistent with "the rule". P8 lands only when everything is green with zero markers.
- **Tests**: the Verification commands below.
- **Acceptance**: all `00` invariants green; zero markers; full build+test green; no old-path importer.

## Verification — exact commands verified against package.json scripts

```bash
# the marker gate (new — BBP8-001) + all existing invariants + import audit (root package.json)
pnpm lint:invariants        # agent check-invariants.sh + boring-bash check:invariants + workspace plugin invariants + (new) marker gate
pnpm audit:imports          # tsx scripts/audit-imports.ts — old-moved-path gates (BBP8-003)
node scripts/check-no-remove-markers.mjs   # BBP8-001 direct run: expect 0 markers, exit 0

# per-package invariants (confirm each relocation boundary)
pnpm --filter @hachej/boring-bash run check:invariants
pnpm --filter @hachej/boring-workspace run lint:plugin-invariants
pnpm --filter @hachej/boring-agent run lint:invariants
pnpm --filter @hachej/boring-agent run check:isolation

# full build + test (root package.json: build:packages then per-pkg)
pnpm typecheck              # build:packages then -r typecheck
pnpm test                   # build:packages then -r test

# spot-checks: no live moved-path importer / legacy approval or cursor path (each should print nothing)
! rg -n -U "import\\s*\\{[^}]*\\b(resolveMode|autoDetectMode|hasBwrap|createDirectSandbox|createBwrapSandbox|createRemoteWorkerModeAdapter|createRemoteWorkerSandbox|createVercelSandboxWorkspace)\\b[^}]*\\}\\s*from\\s*['\"]@hachej/boring-agent/server['\"]" packages apps plugins -g '!**/*.md'
! rg -n "ask-user\\.v1\\." packages apps plugins -g '!**/*.md'
! rg -n "\\?cursor=|schedulePiChatReconnect|replay_gap|PiChatReplayBuffer" packages apps plugins -g '!**/*.md'
```

## PR-PLAN reconciliation

Matches [`../../PR-PLAN.md`](../../PR-PLAN.md) P8 rows exactly:

- `pr1-marker-import-gates` → BBP8-001 + BBP8-003.
- `pr2-surface-contract-docs` → BBP8-002.
- `pr3-track-remaining-prose` → BBP8-004.
- BBP8-005 is the final merge gate on the stack, not a separate PR. Any red gate reopens its owning phase; P8 does not absorb it.

## Review gates

- `pnpm lint:invariants` runs the `TODO(remove:*)` gate; the repo has **zero** markers; a planted marker fails the gate and names its owning bead.
- No surviving marker was "absorbed" into a P8 cleanup bead — any live marker reopened its owning phase instead.
- Four-part surface contract + `createAgent()` documented as stable public API; referenced symbols exist.
- Every P2/P3/P4/T1/T2 relocation import gate present and green; no old-path importer.
- Every deferred/un-beaded plan task filed as a tracked issue/bead; `00` coverage posture reconciled (no overclaim).
- Full `pnpm typecheck` + `pnpm test` + `pnpm audit:imports` green; all `00` invariants hold; #416 contracts + JSONL session compat untouched.

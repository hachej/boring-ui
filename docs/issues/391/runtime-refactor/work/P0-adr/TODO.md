> **Status: historical snapshot/evidence; non-dispatchable.**
> Decision 28 and `docs/issues/391/plan.md` govern current sequencing. This file
> cannot dispatch work; any retained idea requires explicit adoption by the
> active child plan and Decision 28 Bead graph.

# TODO-P0 — ADR + decision ratification

Coordinator: never assign this whole file. Dispatch one bead/PR with this
file's context, dependencies, and non-negotiables included in the assignment.

## Context (read first)

Phase 0 of the #391 runtime refactor (v2). This phase writes zero product code. It ratifies the architecture in the plan pack into the repo's durable decision docs and points the GitHub issue at the v2 pack, so Phase 1 ([`../P1-headless-core/TODO.md`](../../../../805/runtime-refactor/work/P1-headless-core/TODO.md)) starts from a ratified contract.

Required reading (relative to repo root):

- `docs/issues/391/runtime-refactor/README.md` — plan-pack index + implementation/review rules.
- `docs/issues/391/runtime-refactor/architecture/00-global-isa.md` — intent/strategy/architecture, package ownership table, non-negotiable invariants 1–14, open-decisions list.
- `docs/issues/391/runtime-refactor/architecture/08-pluggable-agent-surfaces.md` — **the 11 locked decisions this phase ratifies** live in its "Decisions this file locks" section (§ near the end), including decision 11 for the three-package runtime stack.
- `docs/issues/391/runtime-refactor/INDEX.md` — "Phase 0" section is the deliverable list this TODO expands.
- `docs/issues/391/runtime-refactor/architecture/09-environments-attachable.md` — backing detail for decision 7 (attachable environments).

Repo facts (verified — cite these exact paths):

- Locked-decision registry: `docs/DECISIONS.md`. It is a numbered list of entries, each a 4-field table (**What / Why / Rationale / Re-evaluate when**). Highest existing entry is **§18**. §7a–§7f cover the current Workspace+Sandbox runtime-mode model; §3 is "Wire protocol"; §5 "Harness interface"; §9 "Sessions"; §16 entry-points. A "Process" section at the file end states: *"Any PR that changes a locked decision must update this document."*
- Runtime doc: `packages/agent/docs/runtime.md` — describes the three modes (`direct` / `local` / `vercel-sandbox`) and provisioning; the Workspace+Sandbox pairing is treated as always-present.
- ADRs do **not** live in a separate `docs/adr/` tree — there is none. The decision registry `docs/DECISIONS.md` is the ADR surface. Do not invent a new ADR directory; extend the registry.
- The plan pack itself is the canonical design record; Phase 0 links it from `docs/DECISIONS.md` and #391, it does not duplicate it.

## Goal / exit criteria

- A new locked decision (the v2 runtime-free + surface-agnostic ADR) is merged into `docs/DECISIONS.md` in the existing 4-field format, and all 11 locked decisions from `08` are each ratified (recorded or cross-referenced) with a status of `decided` / `deferred`.
- `packages/agent/docs/runtime.md` no longer implies pure/headless agents require a Workspace+Sandbox pair.
- `docs/DECISIONS.md` §7e ("Pairing invariant") carries a supersession note scoping the pairing to boring-bash-active runtimes only.
- Issue #391 body/pointer references the v2 pack (`docs/issues/391/runtime-refactor/`), not the legacy monolith. A ready-to-post comment body is drafted in this repo (do not require live `gh` access to author it).
- Supersession confirmations are present in `00` open decisions and `VISION.md` locked decisions where `08`/`09` override older surface/runtime text.

## Non-negotiables

- Match the existing `docs/DECISIONS.md` entry format exactly (numbered `## N. Title`, then the What/Why/Rationale/Re-evaluate-when table). The registry is historical and append-only in spirit — **do not rewrite prior entries**; add supersession notes instead.
- Every decision recorded must be traceable to its source line in `08-pluggable-agent-surfaces.md` (cite the relevant decision number from that file's locked-decisions list).
- No code, no route, no package changes in this phase.
- Do not overclaim issue coverage: reuse the "directly owned vs materially advanced" language from `00-global-isa.md` "Issue coverage posture".

## Do NOT

- Do NOT create a new `docs/adr/` directory or a parallel decision system — extend `docs/DECISIONS.md`.
- Do NOT delete or reword §7a–§7f; only annotate §7e with a supersession note.
- Do NOT restate the full plan-pack content inside `docs/DECISIONS.md`; link to the pack.
- Do NOT mark any of the 11 decisions `open` — `08` already locks them; record them as `decided` (or `deferred` only where the locked decision explicitly delegates implementation to a later phase).

## Beads

### BBP0-001 — Write the v2 runtime-free + surface-agnostic ADR entry — S

- **Description:** Add a new numbered locked decision to `docs/DECISIONS.md` (next free number, currently **§19**) capturing: `@hachej/boring-agent` becomes headless model/session/tool core with **zero value imports** from `@hachej/boring-bash`; `@hachej/boring-bash` owns fs+exec/file-UI/provider adapters; surfaces (workspace UI, Slack, spreadsheet, CLI) are thin ingress/egress adapters over one event-stream contract; the five-layer model (Surfaces / Transport / Agent core / Features / Runtime) from `00-global-isa.md` "Direction".
- **Files to touch:** `docs/DECISIONS.md` (append entry).
- **Implementation notes:** Use the 4-field table. In **What**, cite the package-ownership table from `00-global-isa.md`. In **Re-evaluate when**, reference the deferred wire-protocol work `08` actually names — **migrating the `PiChatEvent` reducer/view-model to native `UIMessage`/tool-approval parts** (the repo already depends on `ai ^6`, so it is not an AI-SDK version bump). Link the entry to `docs/issues/391/runtime-refactor/README.md` and `08-pluggable-agent-surfaces.md`.
- **Tests to add:** none (doc). Add the entry's `## 19.` heading and any new cross-doc links to the markdown link-check surface if one exists (see Verification).
- **Acceptance:** A future implementer reading only `docs/DECISIONS.md §19` understands why pure agents and boring-bash are separate packages and what the surface contract is, without rereading the framework research.

### BBP0-002 — Ratify all 11 locked decisions from `08` + the v2 north star — S

- **Description:** Record the status of each decision in the "Decisions this file locks" section of `08-pluggable-agent-surfaces.md` (re-read it — the list below covers all 11). Also ratify the **v2 north star** (`00-global-isa.md` "North star": eve-class UX, workspace as control plane, Flue internals) and **invariant 15 (EU-sovereign defaults)** as part of the §19 entry. Enumerate explicitly so nothing is silently dropped:
  1. **Wire protocol** — keep the existing harness stream unit `PiChatEvent` as the v1 event payload (matching 08's `AgentEvent.chunk: PiChatEvent` envelope), add the indexed `AgentEvent` envelope; no parallel event union. The repo already depends on `ai ^6`; the deferred work is not an AI-SDK version bump but migrating the `PiChatEvent` reducer/view-model to native `UIMessage`/tool-approval parts (08 decision 8). → `decided`. Cross-reference `docs/DECISIONS.md §3` (existing "Wire protocol").
  2. **Pure mode** — pi-coding-agent with `runtime: 'none'` and sealed cwd, behind the Phase 1 audit; not a second harness. → `decided`.
  3. **Surfaces live outside the agent package** — per-channel packages (Flue model), not `boring-agent` subpaths. → `decided`.
  4. **Readonly fs is v1** — already landed via #416; resolves `00` open-decision 6. → `decided (landed)`.
  5. **One-namespace rule superseded** — replaced by named `(filesystem, path)` bindings (landed via #416). → `decided (superseded)`.
  6. **Channel ingress reused, not written** — depend on `@flue/*` channel packages pinned at `1.0.0-beta.x`; vendoring is the fallback; hosting inside Flue's runtime is not adopted. → `decided`.
  7. **Environments are attachable resources** — fs+sandbox has identity independent of any agent; agents/subagents/external agents attach; external agents attach via MCP projection (see `09-environments-attachable.md`). → `decided`.
  8. **Front chat provider unchanged** — keep the current UI/provider projection; defer UIMessage/tool-approval part migration. → `decided`.
  9. **No feature-flag framework** — version rides existing carriers (`AgentEvent.v`, additive DS routes during T1/T2, minor bumps at T2/P3). → `decided`.
  10. **No retro-compat / no speculative abstraction** — no shims past cutover; no abstraction without real consumers. → `decided`.
  11. **Three-package runtime stack** — `@hachej/boring-agent` defines contracts and imports neither runtime package; `@hachej/boring-bash` owns fs/tools/routes/UI + runtime-mode resolution and imports boring-sandbox values + agent types; `@hachej/boring-sandbox` owns concrete providers, FUSE-S3 mounts, lifecycle, and capability facts, importing agent types only. → `decided`.
- **Files to touch:** `docs/DECISIONS.md` (either fold into §19 as a sub-list, or add a compact "§19a — v2 surface decisions ratification" table that lists all 11 with status + source pointer — pick one and be consistent).
- **Implementation notes:** For decisions 4 and 5, note they are already shipped (#416) and this is ratification only. For decision 11, explicitly state that `00` open decision 3 is resolved by the three-package stack. For any still-deferred `00-global-isa.md` item (for example provisioning sharing defaults or surface addressing-store persistence if not fully closed by `08`/T2/P7), record it as `deferred` with the owning phase, so nothing reads as silently decided.
- **Tests to add:** none.
- **Acceptance:** Every locked decision in `08` (1–11) plus the north star + EU-sovereignty invariant has an explicit status and a source pointer; no decision is `open`; deferred items name their resolving phase.

### BBP0-003 — Annotate runtime docs + §7e pairing invariant — S

- **Description:** Update `packages/agent/docs/runtime.md` to state that Workspace+Sandbox is a boring-bash-active concept and that pure/headless agents (`runtime: 'none'`) have no workspace, no sandbox, no cwd, no file routes, no bash tools. Add a supersession note to `docs/DECISIONS.md §7e` ("Pairing invariant") scoping the pairing to runtimes where a filesystem/exec environment is attached.
- **Files to touch:** `packages/agent/docs/runtime.md`; `docs/DECISIONS.md` (§7e annotation only).
- **Implementation notes:** Keep §7e's original table intact; add a short blockquote note beneath it: pairing holds when a boring-bash environment is present; pure mode has no pair. Mirror the wording in `00-global-isa.md` non-negotiable invariant 1.
- **Tests to add:** none.
- **Acceptance:** No doc implies a pure agent needs Workspace+Sandbox; §7e still preserves the no-split-brain rule for boring-bash-active runtimes.

### BBP0-004 — Draft #391 pointer comment + issue-body reconciliation — S

- **Description:** Point issue #391 at the v2 pack. Because a headless coding agent may not have live `gh` access, author the comment/body text as a file in the repo so a human or a `gh`-enabled step can post it verbatim.
- **Files to touch/create:** create `docs/issues/391/runtime-refactor/work/P0-adr/_issue-391-comment.md` (draft comment body); no code.
- **Implementation notes:** The draft must: link `docs/issues/391/runtime-refactor/README.md` and `08-pluggable-agent-surfaces.md`; state that the legacy monolith plan is superseded (preserved snapshot at `docs/issues/391/runtime-refactor/architecture/legacy-monolith-source.md`); list the v2 phase set from `INDEX.md` (Phases 0–8 + tracks T/S/E); use "directly owned vs materially advanced if acceptance lands" language from `00-global-isa.md`. If `gh` is available, post it (`gh issue comment 391 --body-file …`) and record the URL; otherwise leave the file for a human to post.
- **Tests to add:** none.
- **Acceptance:** A single copy-paste-ready comment body exists in-repo that reconciles #391 with the v2 pack and contains no phase drift versus `INDEX.md`.

### BBP0-005 — Supersession confirmations inside the plan pack — S

- **Description:** Verify the supersession confirmations live where readers now enter the v2 pack: `00-global-isa.md` "Open decisions before implementation" marks surface decisions resolved and points to `08`, and `VISION.md` "Decisions locked" lists the locked surface/runtime decisions. Add a one-line note in those locations only if genuinely absent.
- **Files to touch:** `docs/issues/391/runtime-refactor/architecture/00-global-isa.md` and/or `docs/issues/391/runtime-refactor/VISION.md` only if a required supersession confirmation is absent.
- **Implementation notes:** Do not renumber `00`'s decision list; annotate in place only if needed. This is the lowest-risk bead — a pure cross-reference pass.
- **Tests to add:** none.
- **Acceptance:** No stale surface supersession is asserted only in the README; the confirmation is present in `00` and `VISION.md`, with resolved surface decisions pointing to `08`/`09` where applicable.

## Verification

Doc-only phase. Run:

- Markdown/link sanity: `pnpm audit:imports` is code-only — instead grep the new links resolve: `grep -o "docs/issues/391/[^) ]*" docs/DECISIONS.md` and confirm each path exists.
- `pnpm --filter @hachej/boring-bash run check:invariants` — this script (`packages/boring-bash/scripts/check-invariants.mjs`) asserts the pack docs still carry the `named filesystem bindings` + `(filesystem, path)` wording; keep those strings present in the pack after edits.
- Confirm no code changed: `git diff --stat` shows only `docs/**` and `packages/agent/docs/runtime.md`.
- If `gh` is available: `gh issue view 391` shows the v2 pointer after BBP0-004 posts.

## Review gates

- Thermo architecture review of the pack (per `README.md` "Review rule") must be clean before Phase 1 coding starts: no import cycle, no duplicated provisioning/readiness system, no fs/bash split brain, no cwd leak, no scope leak, no overclaimed issue closure.
- A reviewer must confirm all 11 `08` decisions are recorded with a status and a source pointer, and that §7e's supersession note does not weaken the no-split-brain guarantee for boring-bash-active runtimes.
- No implementation bead in [`../P1-headless-core/TODO.md`](../../../../805/runtime-refactor/work/P1-headless-core/TODO.md) may start until BBP0-001..005 are merged and #391 points to the v2 pack.

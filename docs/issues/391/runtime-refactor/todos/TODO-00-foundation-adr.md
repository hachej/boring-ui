> **Status: historical snapshot/evidence; non-dispatchable.**
> Decision 28 and `docs/issues/391/plan.md` govern current sequencing. This file
> cannot dispatch work; any retained idea requires explicit adoption by the
> active child plan and Decision 28 Bead graph.

# TODO-00 — Foundation, ADRs, and invariants

## Purpose

Create the unambiguous architecture foundation before touching code. This prevents import cycles, duplicated systems, split-brain runtime behavior, and accidental loss of the framework research that motivated the refactor.

## Foundation proof/logging standard

These are documentation/architecture beads, but they still need concrete proof. Each implementation PR for this file's beads should include a small validation/proof script or command transcript with detailed logging of:

- docs/ADR files touched;
- GitHub issue number(s) referenced;
- expected invariant strings found or missing;
- markdown link-check result;
- import-invariant test targets that later code beads must implement;
- open-decision ids and their status (`decided`, `deferred`, `blocked`);
- reviewer/model review artifact paths and durable summary location.

No secrets should appear in logs. Do not rely on `.tmp` as the only durable record of an architecture decision.

## Beads / tasks

### BBA-000 — Lock ADR: runtime-free agent + boring-bash ownership

**Depends on:** none.

**Why:** Implementation must start from a shared language. `@hachej/boring-agent` becomes a pure model/session/tool harness. `@hachej/boring-bash` owns optional files/bash/file UI/provider adapters.

**Scope:**

- Add an ADR under `docs/DECISIONS.md` or adjacent ADR location.
- State the core research lessons the ADR is preserving:
  - Flue: one `SessionEnv`-style backing environment for fs/tools/shell; session durability is not file durability; subagent profiles are not isolated sandboxes;
  - Eve: import-free discovery before executing authored code; path-derived declarations; override/disable defaults; per-node sandbox policy; two-phase bootstrap/onSession lifecycle; one model-visible `/workspace` namespace.
- State package ownership:
  - agent owns model loop, sessions, runner API, tool registry, channel-neutral event stream, non-bash operational hooks, provisioning engine types/orchestration over injected adapters;
  - boring-bash owns fs+exec environment, file routes/tools/UI, requirement normalizer, provider adapters/capabilities;
  - workspace owns UI bridge/RPC/plugin host and remains the owner of `UiBridge.postCommand`;
  - core/app composition owns auth/DB/workspaces/billing/child-app context resolution.
- State child-app ownership boundary: `docs/plans/shared-child-app-platform.md` owns child-app registry/workspace-kind/billing/hostname decisions; this refactor only consumes resolved child-app context for runtime policy intersection.
- State `@hachej/boring-agent` has no value imports from `@hachej/boring-bash`.
- State provisioning ownership: existing agent-owned engine remains adapter-injected; bash normalizer/adapters live outside agent.
- State compatibility strategy: moved boring-bash values must not be re-exported from agent/workspace barrels if that creates package cycles; type-only exports or host/composition shims are allowed when safe.
- State user authority model: humans are principals/supervisors/approval channels, not model-callable root agents.

**Unit/doc checks:**

- Markdown link check for ADR references.
- Static import invariant test planned in BBA-011.
- Workspace↔boring-bash acyclicity test planned in BBA-011/BBA-034.
- Proof script logs every required ADR keyword/invariant so reviewers can see if any core lesson was omitted.

**Acceptance:** ADR is merged into docs, referenced by #391, and contains enough context that a future implementer understands why pure agents and boring-bash are separate without rereading the original research reports.

### BBA-001 — Update runtime docs and current invariant wording

**Depends on:** BBA-000.

**Why:** Existing docs say Workspace + Sandbox swap as one runtime-mode pair. That remains true only when boring-bash is active; pure agents have no pair.

**Scope:**

- Update `packages/agent/docs/runtime.md` and relevant `docs/DECISIONS.md` §7 wording.
- Clarify:
  - pure agent: no workspace/sandbox/cwd and no boot-time plugin discovery over host cwd unless explicitly configured;
  - boring-bash active: file tree root, shell cwd, model-visible cwd, git/status/search all share one source of truth;
  - storage-primary vs sandbox-primary are explicit runtime choices;
  - session history durability is separate from file durability;
  - Pi transcripts/session lists live under host durable `BORING_AGENT_SESSION_ROOT` (normally `/data/pi-sessions`), not workspace/container home;
  - UI bridge/RPC stays workspace-owned; boring-bash contributes file surfaces but does not replace `UiBridge.postCommand`.

**Tests/proof:**

- Docs links validated.
- Grep/proof output shows no doc implies pure agents require `Workspace + Sandbox`.
- Reviewers can answer where `BORING_AGENT_SESSION_ROOT`, workspace roots, sandbox `/workspace`, and UI bridge ownership live.
- Proof log lists each updated doc path and the invariant it now states.

**Acceptance:** No doc implies pure agent has `Workspace + Sandbox`, and boring-bash-active docs still preserve the no-split-brain runtime invariant.

### BBA-002 — Choose v1 namespace decision

**Depends on:** BBA-000.

**Why:** Multi-mount public semantics can break the single `/workspace` model. V1 should not ship ambiguous file/bash paths.

**Scope:**

- Decide: preserve one public `/workspace` namespace for v1.
- Mark `BashVolumeView.mounts` as internal/future unless materialized under one root.
- Document forbidden split-brain states:
  - file tree reads one root while bash edits another;
  - git/status reads a different source than file routes/search/bash;
  - API path filters hide files that raw shell can still access;
  - session durability is treated as file durability.
- State partial workspace exposure with exec must be physical mount/seed/copy, not just API filtering.

**Tests/proof:**

- Add planned tests in BBA-023/BBA-030/BBA-037 for file/bash/git source agreement.
- Proof log records the chosen v1 namespace decision and every deferred multi-mount follow-up.

**Acceptance:** No public v1 API promises arbitrary visible multi-mount overlays, and every provider/source-of-truth task knows which single namespace it must satisfy.

### BBA-003 — Establish provider capability vocabulary

**Depends on:** BBA-000.

**Why:** `exec: true` is not enough. `just-bash`-style shells, host direct shells, bwrap, Vercel, and remote-worker have different safety and capability properties.

**Scope:**

- Define capability terms: fs mode, exec, real bash, real binaries, network isolation, persistence, watch/search, service ports, provisioning support.
- Include providers: none, readonly, direct, bwrap, vercel-sandbox, remote-worker.
- Explain mode/provider distinction: `local` mode uses `bwrap` provider.
- State provider fallback policy: never silently downgrade to a less isolated or less capable provider; fail closed with stable diagnostics.
- State remote-worker handshake must report actual hardening claims before policy grants trust.

**Tests/proof:**

- Provider mapping unit tests required by BBA-021.
- Provider capability validation/fail-closed tests required by BBA-021/BBA-046.
- Proof log prints the final provider matrix and every unsupported/fallback decision.

**Acceptance:** Implementers cannot confuse mode id with provider id, or treat `exec: true` as sufficient proof of bash safety.

### BBA-004 — Align #391 issue body and docs to plan pack

**Depends on:** BBA-000.

**Why:** The GitHub issue is the public coordination point. It must not contradict the canonical plan pack.

**Scope:**

- Ensure #391 links to `docs/plans/boring-bash-agent-runtime-refactor/README.md` and the TODO pack under `todos/README.md`.
- Ensure phase list in issue matches `TODO-06`/`06-migration-phases.md` phases 0–8.
- Ensure issue coverage language says "directly owned" vs "materially advanced if acceptance lands".
- Ensure issue body does not reintroduce stale monolith wording, unsafe value re-export promises, or overbroad "all backlog solved" claims.

**Tests/proof:**

- Manual `gh issue view 391` check.
- Markdown body comparison in proof comment.
- Proof log records issue URL, body source file, phase count, and issue-coverage wording check.

**Acceptance:** No phase drift between issue, plan pack, and TODO pack.

### BBA-005 — Add plan review artifacts and no-implementation gate

**Depends on:** BBA-000.

**Why:** User requested iterative plan-space review before implementation. We must preserve the review trail and prevent premature coding.

**Scope:**

- Keep raw review artifacts under `.tmp/boring-bash-plan-reviews/` / `.tmp/boring-bash-todo-reviews/` during iteration.
- Record durable Gemini/Claude review round summaries in the plan pack, GitHub issue, or another tracked docs note; `.tmp` alone is not durable.
- Add a checklist stating no implementation starts until TODO pack passes thermo review and Gemini/second-model review reaches clean/no-relevant-feedback state.

**Tests/proof:**

- `ls .tmp/boring-bash-plan-reviews/` and `.tmp/boring-bash-todo-reviews/` show round artifacts.
- Durable summary cites review verdicts and patch rounds.
- Proof log records which feedback was accepted, rejected as non-relevant, or deferred.

**Acceptance:** Plan pack and TODO pack have clean review results before code beads are created, and future implementers can find the review outcome even if `.tmp` is cleaned.

### BBA-006 — Resolve or explicitly defer remaining open decisions

**Depends on:** BBA-000.

**Why:** Several implementation tasks depend on open decisions from the plan pack. They must be decided or explicitly deferred before coding beads are created.

**Scope:**

- Provider package location: default to `@hachej/boring-bash/providers` for v1; document if a private provider package is deferred.
- Multi-agent route shape: choose path prefix `/api/v1/agents/:agentId/...` or request-scope/header equivalent before BBA-061.
- Provisioning sharing default: choose requirement-controlled scope with explicit `workspace | agent | plugin | session` metadata unless owner decides otherwise.
- Readonly fs: decide v1. Proposed default: implement readonly facade in v1 because file viewers/search/review agents need fs without exec.
- Compatibility strategy: confirm no moved boring-bash values are re-exported from agent/workspace barrels if doing so creates cycles; choose host/composition shim vs explicit import migration.
- Review artifact durability: decide where the durable summary lives if `.tmp` is cleaned.
- Confirm one public `/workspace` namespace for v1; advanced multi-mount remains internal/future.
- Confirm pure agent harness strategy: pi with no cwd/sealed root, or non-pi harness.

**Tests/proof:**

- Decision record lists each item, decision/defer status, owner, rationale, and affected BBA tasks.
- BBA-021/BBA-061/BBA-062 cannot start until this record exists.
- Proof log prints unresolved decisions and fails the gate if any required decision has no status.

**Acceptance:** No open decision silently shapes implementation, and no implementation bead starts with an unstated product/architecture choice.

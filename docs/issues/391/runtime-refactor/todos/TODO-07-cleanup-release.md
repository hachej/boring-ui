> **Status: historical snapshot/evidence; non-dispatchable.**
> Decision 28 and `docs/issues/391/plan.md` govern current sequencing. This file
> cannot dispatch work; any retained idea requires explicit adoption by the
> active child plan and Decision 28 Bead graph.

# TODO-07 — Cleanup, deprecation, release readiness

## Purpose

Finish the migration safely after new package boundaries, routes, tools, plugins, provisioning, and multi-agent features are proven.

This cleanup phase is not a rubber-stamp. It protects users from silent API breaks, package cycles, lost docs, broken deployments, leaked secrets, and overclaimed GitHub issue closure after the refactor lands.

## Beads / tasks

### BBA-070 — Compatibility import audit and migration map

**Depends on:** BBA-022, BBA-025, BBA-030, BBA-031, BBA-032, BBA-033, BBA-034, BBA-040, BBA-042, BBA-051, BBA-053, BBA-060, BBA-061.

**Why:** The refactor moves public values out of `@hachej/boring-agent` and `@hachej/boring-workspace`. Cleanup must not accidentally reintroduce value re-exports that create agent↔bash or workspace↔bash cycles, and it must not silently break downstream imports without a clear migration path.

**Scope:**

- Find all imports from old moved paths across apps, packages, plugins, examples, docs, tests, scripts, and generated declarations if present.
- Classify each import as:
  - safe type-only compatibility export;
  - required source migration to `@hachej/boring-bash`;
  - host/composition-level value shim allowed because the host already depends on both packages;
  - forbidden value re-export that would create a package cycle.
- Preserve type-only compatibility exports where safe.
- Do not keep value compatibility re-exports in packages that would create agent↔bash or workspace↔bash cycles.
- Host/composition-level value shims are allowed only where the host already depends on both packages.
- Mark deprecations and required import migrations in package docs, changelog, and migration examples.
- Include workspace/front barrel exports in the audit: moved filesystem UI values must not force boring-bash to import workspace internals while workspace also imports boring-bash.

**Tests/proof:**

- Static import audit output lists every old moved path and its classification.
- Current apps compile after import migration or through safe host-level shims.
- New sample app compiles using new `@hachej/boring-bash` imports.
- Static acyclicity tests pass for agent↔bash, workspace↔bash, and core/host composition.
- Type-only exports are verified as type-only in emitted JS where possible.

**E2E/smoke logging:**

- Compatibility smoke writes a structured report with old path, new path, classification, package owner, whether emitted JS imports a value, and migration status.

**Acceptance:** No package cycle, no silent public API break, and every old moved import has either a safe compatibility path or an explicit migration diagnostic.

### BBA-071 — Remove compatibility exports after migration window

**Depends on:** BBA-070 and explicit maintainer approval.

**Why:** Compatibility shims are temporary. Removing them must be deliberate, non-destructive, and backed by proof that all maintained code has migrated.

**Scope:**

- Remove old type-only or host-level compatibility exports only after explicit maintainer confirmation.
- There should be no forbidden value re-export paths to remove from agent/workspace because they were never added.
- Update package exports, package docs, changelog, and migration notes.
- No file deletion without explicit written permission; if removal of files is needed, get written approval first.
- Do not use destructive filesystem/git commands.

**Tests/proof:**

- `rg` confirms no maintained code imports old moved paths.
- Typecheck/build confirms package exports are coherent after compatibility removal.
- Static acyclicity tests still pass.
- Migration guide tells downstream users exactly what changed.

**E2E/smoke logging:**

- Removal smoke logs removed export names, remaining aliases, packages checked, and compile/test results.

**Acceptance:** Maintained code no longer depends on old moved paths, and removal does not violate no-deletion/no-destructive-operation rules.

### BBA-072 — Update docs, examples, and migration guide

**Depends on:** BBA-070.

**Why:** The architecture change is large. Users and future implementers need docs that explain the why, not just changed import paths.

**Scope:**

- Update package docs for agent, workspace, core, CLI, plugin CLI, and boring-bash.
- Document:
  - pure no-filesystem agents;
  - boring-bash activation;
  - provider/mode matrix;
  - source-of-truth model (`sandbox-primary` vs `storage-primary`);
  - plugin requirements and hosted plugin fail-closed behavior;
  - child-app/workspace-kind scoping;
  - multi-agent sessions and `agentId` routing;
  - secret status/grant model;
  - managed service lifecycle;
  - external hook/session-search behavior if shipped;
  - host durable session storage rule: transcripts live under `BORING_AGENT_SESSION_ROOT`, not workspace/container home.
- Add migration examples for:
  - pure agent app;
  - coding workspace with boring-bash;
  - readonly reviewer agent;
  - hosted plugin manifest requiring readonly fs;
  - trusted plugin requiring managed service/SDK;
  - Macro child-app scoped requirements.

**Tests/proof:**

- Markdown link check across changed docs.
- Example snippets typecheck where possible.
- Docs mention no raw secrets in logs/prompts/browser contexts.
- Docs do not imply pure agents have `Workspace + Sandbox`.

**E2E/smoke logging:**

- Documentation smoke collects generated example commands, verifies they run or typecheck, and logs example name, package, command, exit code, and linked docs path.

**Acceptance:** A future implementer or app author can understand package ownership, runtime modes, and migration steps without reading the old monolith.

### BBA-073 — Full regression matrix

**Depends on:** all implementation beads and BBA-072.

**Why:** This refactor crosses package boundaries, runtime providers, plugins, sessions, UI, and deployment modes. A final matrix is required before declaring the migration safe.

**Scope:**

Run and document a full matrix:

- pure agent;
- direct;
- local/bwrap;
- vercel-sandbox;
- remote-worker mock/real where available;
- readonly facade;
- hosted plugin;
- trusted plugin service;
- Macro child-app scoped workspace;
- multi-agent workspace;
- external hook path if implemented;
- session-history search/deep-link path if implemented;
- document-authority write/edit override if implemented.

**Unit/regression tests:**

- Run all targeted unit suites from the implementation beads, including:
  - import/acyclicity invariants;
  - pure-mode no-host-cwd tests;
  - provider capability validation;
  - source-of-truth/split-brain tests;
  - readiness/provisioning tests;
  - plugin manifest validation tests;
  - multi-agent session isolation tests;
  - secret/status no-leak tests;
  - document-authority stale-write tests where applicable.

**E2E/smoke logging:**

- Each script writes structured JSON and markdown proof with:
  - workspace id;
  - agent id;
  - session id;
  - provider/mode;
  - sourceOfTruth;
  - childAppId/workspaceKind;
  - plugin ids;
  - requirement ids;
  - readiness transitions;
  - route/tool catalog;
  - file/git/bash root comparison;
  - secret status without secret values;
  - timings;
  - stable error codes;
  - stdout/stderr truncation metadata where commands run.
- Logs must be detailed enough to diagnose failures without reproducing locally.
- Logs must not include secrets or tokens.

**Acceptance:** No critical regression; logs are sufficient to debug failures; all optional/unavailable providers are explicitly marked skipped with reason.

### BBA-074 — Issue triage and closure plan

**Depends on:** BBA-073.

**Why:** This refactor materially advances many issues but directly owns only parts of the backlog. Issue closure must be evidence-based and not overclaim unrelated product work.

**Scope:**

- Update #391 with proof, final architecture summary, package ownership, and test matrix links.
- Identify which issues can be closed, partially advanced, or left untouched.
- Do not close an issue unless its acceptance criteria are met and a proof comment links to tests/logs.
- Keep product plugins, multi-project UI, performance, billing/auth/db, desktop, visual polish, dependency migrations, docs annotation UI, and event-bus typing separate unless actually implemented.
- Apply labels/status according to project workflow.

**Tests/proof:**

- GitHub issue comments cite exact tests/proof.
- Each closed/advanced issue includes a short mapping from acceptance criteria to proof artifact.
- No issue comment includes secrets, host-private paths, or unredacted logs.
- If using bead tooling for follow-up graph checks, use only `br` and `bv --robot-*`; never run bare `bv` and never edit `.beads/*.jsonl` by hand.

**Acceptance:** Issue state accurately reflects delivered functionality and does not inflate scope.

### BBA-075 — Release readiness and maintainer decision packet

**Depends on:** BBA-072, BBA-073, BBA-074.

**Why:** The final output should let the maintainer confidently decide whether to cut a release, keep iterating, or split follow-up work.

**Scope:**

- Verify package builds and exports.
- Verify CLI, full-app, workspace playground, and relevant plugin flows.
- Verify compatibility notes and migration guide.
- Prepare release notes if cutting a release.
- Produce a maintainer decision packet:
  - what changed;
  - what stayed compatible;
  - known deferred decisions;
  - risks;
  - follow-up issues/beads;
  - full test matrix summary;
  - rollback/mitigation notes for deployment.

**Checks:**

- typecheck;
- relevant unit tests;
- e2e smoke scripts;
- package build;
- docs link check;
- static import/acyclicity tests;
- no secrets in logs;
- no unapproved deletions;
- no destructive git/filesystem operations;
- no direct work on `main` unless explicitly authorized.

**E2E/smoke logging:**

- Release-readiness script aggregates all prior proof logs and writes a final summary with command, exit code, duration, artifact path, and pass/fail/skip reason for every gate.

**Acceptance:** Maintainer can decide to cut release or continue with follow-up beads using a complete, auditable proof packet.

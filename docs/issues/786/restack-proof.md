# PR #796 clean-room restack proof

Date: 2026-07-20
Base: `origin/issue/776-task-session-binding` at `39115fd9c`
Local branch: `restack/796-on-804`
Initial clean-room implementation commit: `a234be2`
Current reviewed head: `b047b838382816b3a760ef3828ab2d9120ca9b72`
Beads: `wt-391-forward-786-human-intention-handover-cks.1` through `.11`

## Method

The polluted `fix/786-human-intention-artifacts` branch was **not** rebased, merged, or cherry-picked wholesale. A new worktree/branch was created directly from PR #804. Product hunks were selectively reconstructed from these focused commits:

- `56befa8f7` — artifact contract and Human Intention projection; unrelated skill/docs hunks excluded
- `ae0171e37` — inline Inbox question form
- `37063181d` — Inbox demo fixture and Attention metadata
- `3aa19969a` — duplicate artifact type cleanup
- `679a291bc` — server-backed demo/runtime corrections
- `0d44b3b5b` — state-publisher test cleanup

Excluded completely:

- planning/delegation skill bundles and policy docs;
- unrelated agent attachment history changes;
- unrelated core workspace-skill provisioning;
- all other non-Human-Intention commits from the original PR branch.

## Preserved behavior checklist

- [x] `ask_user` accepts an optional associated `{surfaceKind,target}` artifact seam from the focused source slice.
- [x] Artifact metadata projects through Workspace Attention into Inbox.
- [x] Inbox opens an associated artifact independently from answer actions.
- [x] Pending structured question forms render and submit/cancel inline in Inbox detail.
- [x] Inbox demo is server-backed through a real `AskUserRuntime` and durable file store.
- [x] Obsolete pane auto-open runtime options remain removed.
- [x] Existing #804 native-session, Tasks trusted directory composition, and first-persistence behavior remain authoritative.
- [x] Clean-room review fixed two latent focused-source defects: runtime persistence/browser hydration now retain the associated artifact, and injected runtimes share the exact store used by bridge handlers/state publication.

The singular artifact seam is intentionally retained only as the clean source baseline for Bead `.1`; Beads `.2`–`.3` replace it with the approved unified `HumanArtifact[]` contract. Focused regression tests cover runtime persistence, browser hydration, shared-store ownership, and split-store rejection.

## Conflict resolutions

Two playground files overlapped with #804:

- `apps/workspace-playground/src/front/App.tsx`
  - preserved #804 `nativeSessionStartEnabled` behavior;
  - added the #796 Inbox-demo metadata/session path.
- `apps/workspace-playground/src/server/dev.ts`
  - preserved #804's trusted directory-loaded Tasks plugin and provider options;
  - injected the focused server-backed Ask User runtime directly;
  - removed duplicate default Ask User package registration for this playground composition.

For the focused file set, the reconstructed tree matches `origin/fix/786-human-intention-artifacts` except these expected #804-preserving playground differences and the pre-existing #804 `plugins/ask-user/package.json` version/dependency delta.

## Initial Bead `.1` file allowlist

The initial clean-room reconstruction changed only:

- `apps/workspace-playground/src/front/App.tsx`
- `apps/workspace-playground/src/server/dev.ts`
- `packages/workspace/src/front/attention/WorkspaceAttentionProvider.tsx`
- `plugins/ask-user/e2e/ask-user.spec.ts`
- focused files under `plugins/ask-user/src/{front,server,shared}`
- this proof document

No planning skill, agent attachment, core provisioning, or workflow-policy file is included.

## Automated proof

```bash
pnpm install --frozen-lockfile
pnpm --filter @hachej/boring-ui-kit build
pnpm --filter @hachej/boring-agent build
pnpm --filter @hachej/boring-workspace build
pnpm --filter @hachej/boring-ask-user typecheck
pnpm --filter @hachej/boring-ask-user test
pnpm --filter @hachej/boring-ask-user build
pnpm --filter @hachej/boring-workspace typecheck
pnpm --filter workspace-playground typecheck
bash scripts/check-invariants.sh plugins/ask-user
```

Results:

- Ask User typecheck: passed
- Ask User tests: **101 passed, 1 skipped**
- Ask User build: passed
- Workspace typecheck/build: passed
- Workspace playground typecheck: passed
- Ask User package invariants: passed

Independent reviews:

- Gemini 3.1 Pro spec review: PASS
- GPT-5.4 standards/thermonuclear review: found two latent focused-source defects (artifact persistence/hydration and split store ownership); both fixed with regression tests; rereview PASS

The clean local branch was pushed as `origin/restack/796-on-804` for proof and subsequent Beads. Existing PR #796 branch/base and the canonical dirty checkout were not modified.

## Completed workflow and bounded Autoresearch

Subsequent focused Beads added the approved plural artifact contract, non-blocking `manage_handover`, stateless successful-run projection, Chat Handover cards, reverse task provenance, complete Inbox, TaskCard **Needs you**, and lazy latest linked-session outputs. The owner-requested PR #881 Autoresearch protocol then converged in four of five permitted writer rounds.

Final Autoresearch revision: `b047b838382816b3a760ef3828ab2d9120ca9b72` (`success`). See [`autoresearch.md`](./autoresearch.md) for commit/tree-bound iteration records, evidence digests, finding dispositions, performance thresholds, and reviewer records.

Current proof summary:

- Ask User: **114 passed, 1 skipped**
- Tasks: **91 passed**
- Agent final focused host/session suites: **76 passed**
- Workspace focused UI/auth suites: **17 passed**
- Core full-app composition: **6 passed**
- CLI workspaces-mode integration: **11 passed**
- Playground Inbox E2E: **1 passed**
- Agent, Ask User, and Tasks changed-path invariants: passed
- GPT-5.4 final functional/spec/security review: **CLEAN**
- xAI final UI/interaction/accessibility review: **CLEAN**
- Opus: unavailable due provider quota; recorded without silent substitution

Live proof used successful native session `019f801f-cd17-7ebe-ae33-6d0259842cec` and interrupted session `019f832e-0713-7955-88bb-3e183f9526ee`. It verified 12 ordered artifacts with collapse after 10, two explicit related tasks, no automatic surface opening, exact chat reopening without session creation, answer/resume, failed/interrupted suppression, empty next-run registry, and restart reconstruction with one Handover match and 12 artifacts.

Additional evidence:

- [`visual-proof/chat-handover.png`](./visual-proof/chat-handover.png)
- [`visual-proof/chat-handover-mobile.png`](./visual-proof/chat-handover-mobile.png)
- [`visual-proof/human-intention-inbox-mobile.png`](./visual-proof/human-intention-inbox-mobile.png)
- [`visual-proof/task-needs-you-mobile.png`](./visual-proof/task-needs-you-mobile.png)
- [`visual-proof/task-handover-restart.png`](./visual-proof/task-handover-restart.png)

The remote `fix/786-human-intention-artifacts` branch and PR #796 base remain untouched pending explicit owner approval.

# PR #796 clean-room restack proof

Date: 2026-07-20  
Base: `origin/issue/776-task-session-binding` at `39115fd9c`  
Local branch: `restack/796-on-804`  
Reviewed implementation commit: `a234be2`  
Bead: `wt-391-forward-786-human-intention-handover-cks.1`

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

## File allowlist

The restack changes only:

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

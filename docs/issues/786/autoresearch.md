# PR #796-on-#804 bounded Autoresearch record

## Run contract

- Bead: `wt-391-forward-786-human-intention-handover-cks.11`
- Controller: explicit-only `/skill:autoresearch` v1 from PR #881, source revision `399f1d5fb43c29cacb16c38dd28c1bf498ebcfa9`
- Target: Tasks → exact native session → blocking Human Intention Inbox → shared artifacts → stateless Handover
- Writer cap: **5**; writer rounds used: **4**
- Selection cap: at most three material findings per writer round
- Writer: one writer in `.worktrees/pr-796-on-804`
- UI context: `.impeccable.md` (`precise`, `calm`, `editorial`)
- Terminal state: **success**
- Final revision: `b047b838382816b3a760ef3828ab2d9120ca9b72`
- Final tree: `fab4d739a022d0b102cde84d17ff7e9119b77fc4`

PR #881's Automation product changes were not merged into this stack. PR #874's registered UI-review package is not present on the #804 base, so this run used exact Playwright captures plus independent blind functional and UI/interaction/accessibility reviewers. It did not copy gates, change baselines, or silently substitute an unavailable reviewer.

## Deterministic proof contract

Commands used across the baseline and candidate revisions:

```bash
pnpm --filter @hachej/boring-agent typecheck
pnpm --filter @hachej/boring-agent exec vitest run \
  src/server/__tests__/createAgentApp.test.ts \
  src/server/__tests__/registerAgentRoutes.test.ts \
  src/server/pi-chat/__tests__/piChatHistory.test.ts
pnpm --filter @hachej/boring-workspace typecheck
pnpm --filter @hachej/boring-workspace exec vitest run \
  src/app/front/__tests__/HandoverTimelineCard.test.tsx \
  src/app/front/__tests__/handoverChatProjection.test.ts \
  src/app/front/__tests__/useWorkspaceShellCapabilitiesController.test.tsx \
  src/server/workspaceBridge/__tests__/authPolicy.test.ts
pnpm --filter @hachej/boring-ask-user typecheck
pnpm --filter @hachej/boring-ask-user test
pnpm --filter @hachej/boring-tasks typecheck
pnpm --filter @hachej/boring-tasks test
pnpm --filter @hachej/boring-core typecheck
pnpm --filter @hachej/boring-core exec vitest run \
  src/app/server/__tests__/createCoreWorkspaceAgentServer.provisioning.test.ts
pnpm --filter @hachej/boring-ui-cli typecheck
pnpm --filter @hachej/boring-ui-cli exec vitest run \
  src/__tests__/workspacesModeRuntimePlugins.test.ts
pnpm --filter workspace-playground typecheck
pnpm --filter workspace-playground exec playwright test e2e/inbox-demo.spec.ts
bash scripts/check-invariants.sh packages/agent
bash scripts/check-invariants.sh plugins/ask-user
bash scripts/check-invariants.sh plugins/tasks
git diff --check
```

The first CLI filter and first Playwright `--project=chromium` invocation were command-shape errors (`@hachej/boring-cli` does not exist and this config has no named project). Each was retried once on the same tree with the commands above and passed. Full-package Workspace invariants report known pre-existing repository debt unrelated to this diff; changed packages/files introduced no new invariant violation, and the package's type/tests passed.

Bundle/performance threshold was ±5% for affected built JS/CSS:

- iteration 1 Agent + Tasks: `+0.0710%`
- iteration 2 Agent: `+0.1794%`
- iteration 3: server-only Core proxy, no front bundle change
- iteration 4 Tasks: `+0.5726%`

All were below threshold. Raw command output and SHA-256 manifests are under `.tmp/autoresearch/iter-{0..4}/` in the proof worktree; no tokens, answers, secrets, or transcript bodies are recorded.

## Iterations

### Iteration 0 — immutable baseline

- Commit: `bb5d39c8a07b14798769c2cfc94ae17c95f4a497`
- Tree: `171d8059074430a1a0ed2e6636db207595343c88`
- Deterministic result: green after the two command-shape retries above
- Proof summary: Agent 47 focused tests; Workspace 17 focused tests; Ask User 114 passed / 1 skipped; Tasks 90 tests; CLI 11 tests; playground E2E 1 test; builds and relevant invariants passed
- Reviewers:
  - GPT-5.4 high, fresh CLI session, functional/spec/security: findings
  - xAI Grok 4.3 high, fresh CLI session, UI/interaction/accessibility: findings
  - Opus: unavailable due provider extra-usage exhaustion; recorded, not substituted silently

Normalized queue and selection:

1. `functional:session-link-authz:list-exposes-unauthorized-exact-id` — selected.
2. `functional:trusted-identity:requestful-auth-ignores-resolved-actor` — selected.
3. `ui:responsive:evidence-missing` — selected as a proof fix; captured 390×844 Chat, Inbox, and Tasks states.
4. `functional:session-link-authz:unlink-requires-live-session-auth` — rejected: stale/missing links must remain removable without loading a transcript; link IDs are opaque and the route remains inside trusted workspace actor scope.
5. Subjective stripe/back-link/session-label findings — rejected because they conflict with `.impeccable.md` bans or repeat context already supplied by the containing session surface.

### Iteration 1

- Commit: `728c1b6b11acfb702a498801046758980722838c`
- Tree: `1c4d35b27d835894a8dc42205bd1b94f9412e2d2`
- Fixed:
  - task-scoped lists no longer expose unauthorized exact native IDs;
  - dynamic Agent trusted readers use the resolved actor and reject a mismatched request user;
  - desktop/mobile evidence committed.
- Deterministic result: Agent 47 focused tests; Tasks 91 tests; changed-path invariants and diff check passed.
- Review queue:
  1. `functional:standalone-host:trusted-actor-mismatch` — selected.
  2. `functional:standalone-host:handover-reader-missing` — selected.
  3. Caller-supplied `omittedSessionIds` echo findings — rejected: values originate in the bounded request and collapse absent/denied/empty into one state; no server-derived identity or metadata is added.
- UI reviewer: clean.

### Iteration 2

- Commit: `0e68398654cf4d870e0f60844fbb19ed4a05202a`
- Tree: `c63b50dffd7ca8f21e5b7ae566552dcd39bf9a56`
- Fixed:
  - extracted one redacted structured-run projection helper;
  - standalone `createAgentApp` now matches dynamic host actor checks and Handover support.
- Deterministic result: Agent 76 focused tests, typecheck, build, invariants, and diff check passed.
- Review queue:
  1. `functional:core-host:handover-reader-proxy-dropped` — selected with explicit scope rationale: the deployed Core host is a required composition boundary, and the change is a narrow trusted passthrough plus integration test.
- UI reviewer: clean.

### Iteration 3

- Commit: `3e2711de8e28946ce6eed36159ee9b561b07cf56`
- Tree: `46464c90e2d02e08b17c16fc1d63839d6ffea140`
- Fixed: Core/full-app trusted plugin context forwards `readSessionRunDetails` without widening public authority.
- Deterministic result: Core typecheck and six focused composition tests passed.
- Review queue:
  1. `functional:stale-link-ui:list-filter-removes-unlink-row` — selected.
  2. Visual long-list/focus/contrast claims — rejected after code and mobile evidence inspection: collapse-after-10 is present, focus rings are explicit, and artifacts are rows rather than nested cards.

### Iteration 4 — terminal

- Commit: `b047b838382816b3a760ef3828ab2d9120ca9b72`
- Tree: `fab4d739a022d0b102cde84d17ff7e9119b77fc4`
- Fixed: unauthorized/stale task links retain a redacted unlinkable row while exact native IDs, activity requests, Handover requests, and chat actions remain unavailable.
- Deterministic result: Tasks 91 tests, typecheck, build, invariants, and diff check passed.
- GPT-5.4 functional/spec/security verdict: **CLEAN**.
- xAI UI/interaction/accessibility verdict: **CLEAN**.
- Progress: all carried blocker/high/medium findings resolved or explicitly rejected with locked-product rationale; no equal-or-higher deterministic regression.
- Terminal state: **success**. The fifth permitted writer round was not used.

## Full E2E scenario record

Recorded identifiers only:

- successful integrated native session: `019f801f-cd17-7ebe-ae33-6d0259842cec`
- interrupted native session: `019f832e-0713-7955-88bb-3e183f9526ee`
- related tasks: `github:workspace/#863` and `github:workspace/#861`

Verified:

1. Explicit task/native links persisted; no title, prompt, branch, file, or prose inference.
2. One run performed Handover upsert, stable-ID update, obsolete removal, then blocking `ask_user`.
3. `ask_user` attached 11 explicit artifacts; successful Handover contained 12 artifacts in registration order and collapsed after 10.
4. Chat, Inbox, Tasks, Workbench, and folders did not auto-open.
5. Inbox showed the live form, both explicit related tasks, and shared artifact rows; Handover created no informational Inbox item.
6. Task `#863` showed **Needs you** and exact linked sessions.
7. Artifact opening did not resolve the request; exact chat reopening did not create a session.
8. One answer resumed the run; the resolved item disappeared while links/history remained.
9. Chat rendered one distinct successful Handover card after concise final prose.
10. Interrupting a run after Handover registration produced terminal error/interruption behavior and zero Handover matches.
11. The next successful no-tool run on that same session started with an empty registry and produced zero Handover matches.
12. Restart reconstructed the successful Handover from structured native history: one match, 12 artifacts, no second store/event.
13. Expanded TaskCard session disclosure lazily rendered the same latest outputs after restart.
14. One session linked to two tasks resolved both through explicit reverse provenance.
15. Unit/integration tests prove denied redaction, unavailable unlink, failed suppression, bounded batches, and no denied transcript/body leakage.

Visual evidence:

- `visual-proof/human-intention-inbox.png`
- `visual-proof/human-intention-inbox-mobile.png`
- `visual-proof/task-needs-you.png`
- `visual-proof/task-needs-you-mobile.png`
- `visual-proof/chat-handover.png`
- `visual-proof/chat-handover-mobile.png`
- `visual-proof/task-handover-restart.png`

## Residual risks

- Opus remained unavailable due provider quota. GPT-5.4 and xAI were independent fresh-session reviewers; no silent model substitution was made.
- The live playground accumulated multiple proof links/questions, so the restart screenshot shows another still-pending **Needs you** item on the same task. The integrated request itself resolved, and automated lifecycle tests cover exact clearing.
- Full-package Workspace invariants have unrelated pre-existing failures; no attempt was made to broaden this focused PR into that cleanup.

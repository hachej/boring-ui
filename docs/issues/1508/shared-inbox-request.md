# [Shared Inbox] One Factory host over a shared projects folder

Owner request (2026-09-04). Today `apps/factory-playground` is one process per epic: the workspace root is one epic's git worktree and the epic key is baked into the seat instructions. Several epics or repositories mean several UIs and several Inboxes. Owner ruling: run ONE Factory instance whose workspace root is a shared projects folder (e.g. `~/projects`) with every repository inside, so one Agents list and one Inbox cover all epics. Do not build multi-workspace routing; make the epic a per-session concept inside one workspace.

## Slices, in dependency order

1. **[Shared Inbox] In-host epic registry** — a persisted registry under the Factory state root: `{ epicKey, featureName, repoRoot (an epic worktree inside the shared folder), branch, remoteUrl, provider }`; `epic up` creates the worktree `<repo>/.worktrees/epic-<slug>` (or clones another repository under the shared folder first) and registers it; `epic down` unregisters; `epic list` reads the registry. No new process per epic. Meta exposes the registry.
2. **[Shared Inbox] Epic resolved per session, not per host** — the epic-binding and precedence appendices stop naming one key; the Orchestrator's request names the feature and the host registers the epic; `dispatch_worker`/`fresh_review` briefs carry the epic key and repo root; every host tool (`factory_status`, `supervise`, `demo_sandbox`, sandbox leases, snapshot registry) resolves the epic from the calling session's binding (session → epic map persisted next to supervision), running `br`/`git` in that epic's repoRoot. Workers never edit a repository's canonical checkout, only the registered epic worktree. Depends on 1.
3. **[Shared Inbox] Tasks and receipts per epic** — the Tasks plugin reads Beads from each registered epic's repoRoot (multi-root Beads ops) and labels cards with the feature name; acceptance and recovery scripts take an epic key instead of EPIC_WT. Depends on 1.

## Proof

`pnpm exec tsc --noEmit` and `pnpm exec vitest run` in `apps/factory-playground`; a live run with ONE host over `~/projects` registering two epics (one in boring-ui-v2, one in a clone of `hachej/boring-cdc`), both Gate 1 questions answered from the same Inbox, both Workers committing in their own epic worktrees, sandbox proof per epic.

## Risks

Tool scope covers every repository under the shared folder; the epic worktree rule and fresh review are the guard. The shared folder is not a git repository, so nothing may assume `git`/`br` at the workspace root.

## Out of scope

Multi-workspace routing (CLI hub pattern), merging, per-repository personas, Vercel quota.

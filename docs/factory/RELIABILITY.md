# Factory reliability model

Status: implemented in the native Factory playground (`apps/factory-playground`), proven by live runs recorded under `docs/issues/1508/`. Applies to the ratified Factory contract in `.agents/factory/README.md`; conflicts are listed at the end.

## Durable truth

The durable sources are the Bead graph (`br`), git (each epic branch, pushed after every commit), session transcripts (host-owned JSONL under the shared `BORING_AGENT_SESSION_ROOT`), the epic registry (`<stateRoot>/epics.json`), and session bindings (`<stateRoot>/session-bindings.json`). Everything else is a projection that the host rebuilds on boot. No agent context is trusted to remember anything; agents write durable facts down (Bead comments, commits) before they would need them.

## Supervision is host-owned

The Orchestrator does not keep timers. It calls the `supervise` tool (start/stop/status, 30s..60m). The host persists one epic-labelled entry per session (`<state>/supervision.json`), fires ticks, and skips a tick while the session is busy instead of queueing it. Adoption moves that entry to the new registry Orchestrator. On boot the host prunes every entry except the active registry Orchestrator with a matching binding, so an adopted-away session cannot be re-armed. A crash therefore costs at most one interval when the surviving registry state still owns a valid supervision entry. The stale-claim rule below is unchanged.

## Claims and recovery

`br` has no leases. A claim is `assignee=<worker session id>` + `in_progress`, made atomically with the Worker's own session id (the host states it in the dispatch brief). On every tick the Orchestrator reads `factory_status`, a host projection of the epic: Beads with assignee and session liveness (`none | unknown | exists-idle | exists-busy`), comment activity, and local/remote HEAD.

Stale claim rule: `in_progress` and the assignee session is `unknown` or `exists-idle` with no handoff comment and no new commit. Recovery is `br update <id> --assignee "" --status open`, a comment naming the old session, and a fresh `dispatch_worker`. A claim whose session is `exists-busy` is never released. A dead Worker's uncommitted edits stay in the shared worktree; the next Worker adopts what is correct and says so in its handoff. After a restart every session reads idle, so a Worker killed mid-turn is recovered by exactly this rule (proven: `live-epic-recovery.mjs`).

## Execution never blocks the editing machine

Workers edit the shared epic worktree; tests, builds and servers run in a dedicated sandbox holding the exact committed HEAD. Local provider: shared git clone at HEAD with `node_modules` linked. Remote provider (Vercel): the tracked tree at HEAD reaches the sandbox either via `git archive` upload or, when the epic branch is pushed (the default), via the sandbox's own `git fetch` of the exact SHA — `.factory-sha` marks the SHA either way. Uncommitted edits never enter a sandbox; sandbox filesystems never flow back. Leases have TTLs and are reaped.

The base snapshot every lease boots from is **warm by default**: `pnpm --filter factory-playground snapshot:vercel` clones the monorepo, runs `pnpm install`, and builds every package before snapshotting, so a lease's bootstrap only has to fetch/checkout the exact SHA, reinstall iff the lockfile hash moved, and rebuild only the packages that changed since the snapshot's base SHA (pnpm's changed-since filter) — a real command like `pnpm --filter factory-playground test` then runs immediately instead of paying a full monorepo install+build per lease. `--bare` opts back into the original node+git-only snapshot for cases that don't need warm packages.

**One warm snapshot per epic, not one shared snapshot for everyone.** A snapshot baked once from `main` and reused as a single `BORING_FACTORY_VERCEL_SNAPSHOT_ID` works until an epic branch diverges from `main` across most packages — the changed-since selector then matches nearly the whole monorepo and the serial rebuild (required to avoid OOM on a default-resource lease) blows the lease timeout (observed live). When `BORING_FACTORY_VERCEL_SNAPSHOT_ID` is unset, `snapshotRegistry.ts` builds and caches by registry `epicKey`, from that registry entry's epic worktree HEAD—not the host's canonical workspace root—and clones the credential-stripped `origin` derived from that validated worktree. Refresh triggers are unchanged: lockfile hash, expiry, or the changed-package-count guard. The host warms every active registry entry on boot. A fixed snapshot ID remains a deliberate host-wide override.

## Review is a rule, not a chair

`fresh_review` starts a brand-new `boring-reviewer` session bound to one SHA and returns only its verdict and provenance (session, model, brief digest). The Worker records that provenance in the Bead handoff; a `request-changes` verdict is fixed and re-reviewed before handoff.

## Skill precedence

The canonical `exec` and `owner-gate` blocks assume per-Bead PRs, push-after-commit to a personal branch and blocking `ask_user` gates. The host attaches a `factory-precedence` appendix that overrides those steps for Factory seats: one epic branch and PR, no Worker PRs, no Worker `ask_user`, handoff = Bead comment, Gate 2 (merge) never belongs to an agent. The Worker seat no longer receives `owner-gate`. Owner reconciliation of the canonical skill text is a follow-up; the persona manifests are unchanged so fleet digest pins still match.

## What is still not covered

- Security confinement: the local provider isolates by routing only. Use the Vercel provider for untrusted execution.
- Remote serving: the Vercel provider exposes no preview URL surface yet.
- Concurrency: two Workers on one epic share the worktree without file reservations by owner ruling; collisions are resolved in place. Add reservations only if runs show collisions.
- Quotas: model credit exhaustion surfaces as failed turns; the Orchestrator sees a stale claim and re-dispatches, which can loop. A per-epic dispatch budget is not implemented.

## Owner handoff: two Inbox gates

Every seat's real tool catalog includes the workspace-scoped `ask_user` capability. Factory policy reserves owner contact and both gates for the Orchestrator; its call lands in the Workspace Inbox and blocks the seat until the owner decides.

- **Gate 1, plan approval.** After the Bead graph exists: title `[br-<bead>] Plan approval: <title>`, context = goal, Bead list in dependency order, proof commands, risk and rollback, what approve triggers. Plan ceremony is scaled to the epic (one plan note, at most one adversarial review, no HTML review page unless UI changes). Nothing is dispatched before approve.
- **Gate 2, merge approval.** When `factory_status` shows every epic Bead handed off with SHA, sandbox proof and `fresh_review` approve: the Orchestrator opens or updates the epic PR with the Owner Review card (`docs/procedures/owner-review-card.md`) plus a `## Handover` section, starts a `demo_sandbox` (Vercel, exact SHA, public URL, TTL capped by `BORING_FACTORY_DEMO_MAX_MINUTES`), then raises `ask_user` with PR URL, head SHA, demo URL and lifetime, please-test steps and handover lines. On approve it comments on the PR and never merges; on changes it opens follow-up Beads.

Both gates survive restarts: pending questions are persisted by the ask-user store and are not swept on boot.

The visual is mandatory at both gates (owner ruling): `show-me` is attached to the Orchestrator seat, and Gate 1's `ask_user` call carries a `show-me-plan` artifact (`docs/issues/<issue>/show-me-plan.md`: structure, behavior, and diff views of what the epic touches) while Gate 2's PR body carries a `## Show me` section between the Owner Review card and `## Handover` (diff-shaped views plus one sequence diagram of the shipped flow, derived from the actual commits), mirrored to `docs/issues/<issue>/show-me-<short sha>.md` and passed as an artifact. `live-epic-acceptance.mjs` asserts both artifacts exist and carry a fenced view.

## Operations

Running several work threads at once is `apps/factory-playground/scripts/factory-epic.mjs` — see the app's README, "Launching your work threads", for the full command reference. Operational shape:

- **One Factory Hub per machine**: one process, one sessions list, and one Inbox at workspace scope `factory-hub`. The host workspace is the canonical repository checkout; it is not an epic worktree.
- **Epic isolation**: each registry entry carries its own repository root, worktree (`<repositoryRoot>/.worktrees/epic-<key>`), branch (`epic/<key>`), Orchestrator, child-session bindings, supervision record, demos, and sandbox snapshot. Multi-repository entries are represented by the schema but not accepted by the current launcher yet.
- **State**: `<stateRoot>/epics.json` is the authoritative runtime epic registry and `<stateRoot>/session-bindings.json` maps every Factory session to its epic. Coupled mutations write the registry first and bindings second; each file is atomic. Supervision, demos, leases, and snapshots carry or key by the same epic key.
- **Recovery**: boot validates canonical registry paths, restores missing registry Orchestrator bindings, preserves child bindings to active epics, and drops/logs orphan bindings to missing or closed epics before any re-arm. It then prunes stale supervision, re-arms only matching registry Orchestrators, cleans expired demos, and warms active snapshots. The idempotent adopt endpoint reattaches shared sessions, transfers supervision, and safely copies native transcripts from the former per-epic session roots into the hub namespace; it rejects cross-epic binding collisions and preserves the legacy source files.
- **Lifecycle**: `factory-epic.mjs hub up` starts the shared `5230` API / `5220` UI. `up` provisions and builds an epic worktree, then calls intake; `list` reads live facts from the host; `down` marks the entry closed and never deletes its worktree.

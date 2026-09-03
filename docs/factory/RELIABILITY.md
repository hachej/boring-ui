# Factory reliability model

Status: implemented in the native Factory playground (`apps/factory-playground`), proven by live runs recorded under `docs/issues/1508/`. Applies to the ratified Factory contract in `.agents/factory/README.md`; conflicts are listed at the end.

## Durable truth

Only three things must survive anything: the Bead graph (`br`), git (the epic branch, pushed after every commit), and session transcripts (host-owned JSONL under `BORING_AGENT_SESSION_ROOT`). Everything else is a projection that the host rebuilds on boot. No agent context is trusted to remember anything; agents write durable facts down (Bead comments, commits) before they would need them.

## Supervision is host-owned

The Orchestrator does not keep timers. It calls the `supervise` tool (start/stop/status, 30s..60m). The host persists the entry (`<state>/supervision.json`), fires ticks, skips a tick while the session is busy instead of queueing it, and re-arms every entry on boot. A crash therefore costs at most one interval.

## Claims and recovery

`br` has no leases. A claim is `assignee=<worker session id>` + `in_progress`, made atomically with the Worker's own session id (the host states it in the dispatch brief). On every tick the Orchestrator reads `factory_status`, a host projection of the epic: Beads with assignee and session liveness (`none | unknown | exists-idle | exists-busy`), comment activity, and local/remote HEAD.

Stale claim rule: `in_progress` and the assignee session is `unknown` or `exists-idle` with no handoff comment and no new commit. Recovery is `br update <id> --assignee "" --status open`, a comment naming the old session, and a fresh `dispatch_worker`. A claim whose session is `exists-busy` is never released. A dead Worker's uncommitted edits stay in the shared worktree; the next Worker adopts what is correct and says so in its handoff. After a restart every session reads idle, so a Worker killed mid-turn is recovered by exactly this rule (proven: `live-epic-recovery.mjs`).

## Execution never blocks the editing machine

Workers edit the shared epic worktree; tests, builds and servers run in a dedicated sandbox holding the exact committed HEAD. Local provider: shared git clone at HEAD with `node_modules` linked. Remote provider (Vercel): the tracked tree at HEAD is exported with `git archive` and uploaded as the sandbox template on top of an immutable base snapshot, with `.factory-sha` marking the SHA. Uncommitted edits never enter a sandbox; sandbox filesystems never flow back. Leases have TTLs and are reaped.

## Review is a rule, not a chair

`fresh_review` starts a brand-new `boring-reviewer` session bound to one SHA and returns only its verdict and provenance (session, model, brief digest). The Worker records that provenance in the Bead handoff; a `request-changes` verdict is fixed and re-reviewed before handoff.

## Skill precedence

The canonical `exec` and `owner-gate` blocks assume per-Bead PRs, push-after-commit to a personal branch and blocking `ask_user` gates. The host attaches a `factory-precedence` appendix that overrides those steps for Factory seats: one epic branch and PR, no Worker PRs, no Worker `ask_user`, handoff = Bead comment, Gate 2 (merge) never belongs to an agent. The Worker seat no longer receives `owner-gate`. Owner reconciliation of the canonical skill text is a follow-up; the persona manifests are unchanged so fleet digest pins still match.

## What is still not covered

- Security confinement: the local provider isolates by routing only. Use the Vercel provider for untrusted execution.
- Remote serving: the Vercel provider exposes no preview URL surface yet.
- Concurrency: two Workers on one epic share the worktree without file reservations by owner ruling; collisions are resolved in place. Add reservations only if runs show collisions.
- Quotas: model credit exhaustion surfaces as failed turns; the Orchestrator sees a stale claim and re-dispatches, which can loop. A per-epic dispatch budget is not implemented.

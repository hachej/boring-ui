# Factory reliability model

Status: implemented in the native Factory playground (`apps/factory-playground`), proven by live runs recorded under `docs/issues/1508/`. Applies to the ratified Factory contract in `.agents/factory/README.md`; conflicts are listed at the end.

## Durable truth

The durable sources are the Bead graph (`br`), git (each epic branch, pushed after every commit), session transcripts (host-owned JSONL under the shared `BORING_AGENT_SESSION_ROOT`), the epic registry (`<stateRoot>/epics.json`), session bindings (`<stateRoot>/session-bindings.json`), and host dispatch/review history (`<stateRoot>/dispatches.json`). Everything else is a projection that the host rebuilds on boot. No agent context is trusted to remember anything; agents write durable facts down (Bead comments, commits) before they would need them.

## Supervision is host-owned

The Orchestrator does not keep timers. It calls the `supervise` tool (start/stop/status, 30s..60m). The host persists one epic-labelled entry per session (`<state>/supervision.json`), fires ticks, and skips a tick while the session is busy instead of queueing it. Adoption moves that entry to the new registry Orchestrator. On boot the host prunes every entry except the active registry Orchestrator with a matching binding, so an adopted-away session cannot be re-armed. A crash therefore costs at most one interval when the surviving registry state still owns a valid supervision entry. The host-owned stale-claim rule is defined below.

## Claims and recovery

`br` has no leases. A claim is `assignee=<worker session id>` + `in_progress`, made atomically with the Worker's own session id (the host states it in the dispatch brief). On every tick the Orchestrator reads `factory_status`, a host projection of the epic: Beads with assignee and session liveness (`missing | idle | busy`), comment/handoff activity, local/remote HEAD, and the host counters below.

Stale claim is a host fact. An `in_progress` claim with a missing assignee session is stale immediately. An idle assignee with no canonical, Bead-specific handoff comment is stale only after `BORING_FACTORY_STALE_IDLE_MS` (default `600000`, 10 minutes), measured from that session's last activity. `factory_status` returns `stale: true`, the reason, and `recoveryCommand: "recover_stale_claims"`. The Orchestrator calls that host tool; it re-reads the facts, releases every still-stale claim with `br update <id> --assignee "" --status open`, and adds a comment naming the dead session and reason. A busy claim is never released. A dead Worker's uncommitted edits stay in the shared worktree; the next Worker adopts what is correct and says so in its handoff.

## Dispatch and review caps

`dispatch_worker` resolves one exact target Bead from `beadId` or from the single
epic Bead ID named in the brief. Before creating a child session it enforces:

- `BORING_FACTORY_MAX_CONCURRENT_WORKERS` (default `2`) busy Workers per epic.
- `BORING_FACTORY_MAX_DISPATCHES_PER_BEAD` (default `2`) admitted dispatches per Bead.

At either cap the host creates no session, marks the target Bead `blocked`, adds a
blocker comment, and tells the Orchestrator to raise an Inbox question with `ask_user`
instead of retrying. Admission is serialized so concurrent calls cannot both pass the
same check.

`fresh_review` records rounds per `(epic, Bead)` when `beadId` is present, otherwise
per persisted SHA lineage for the calling Worker. `BORING_FACTORY_MAX_REVIEW_ROUNDS`
(default `4`) does not suppress the capped review: that review runs and returns
`capReached: true` with instructions to hand off at the current SHA and file remaining
findings as follow-up Beads instead of fixing forward again.

Each dispatch/review record contains the epic, target, child session, timestamp, and
latest outcome in atomically replaced `<stateRoot>/dispatches.json`. A restarted host
reads the same file before admission. `factory_status` exposes `busyWorkers`,
`dispatchesPerOpenBead`, and review rounds by Bead or SHA lineage, together with the
active limits.

## Execution never blocks the editing machine

Workers edit the shared epic worktree; tests, builds and servers run in a dedicated sandbox holding the exact committed HEAD. Local provider: shared git clone at HEAD with `node_modules` linked. Remote provider (Vercel): the tracked tree at HEAD reaches the sandbox either via `git archive` upload or, when the epic branch is pushed (the default), via the sandbox's own `git fetch` of the exact SHA — `.factory-sha` marks the SHA either way. Uncommitted edits never enter a sandbox; sandbox filesystems never flow back. Leases have TTLs and are reaped.

The base snapshot every lease boots from is **warm by default**: `pnpm --filter factory-playground snapshot:vercel` clones the monorepo, runs `pnpm install`, and builds every package before snapshotting, so a lease's bootstrap only has to fetch/checkout the exact SHA, reinstall iff the lockfile hash moved, and rebuild only the packages that changed since the snapshot's base SHA (pnpm's changed-since filter) — a real command like `pnpm --filter factory-playground test` then runs immediately instead of paying a full monorepo install+build per lease. `--bare` opts back into the original node+git-only snapshot for cases that don't need warm packages.

**One warm snapshot per epic, not one shared snapshot for everyone.** A snapshot baked once from `main` and reused as a single `BORING_FACTORY_VERCEL_SNAPSHOT_ID` works until an epic branch diverges from `main` across most packages — the changed-since selector then matches nearly the whole monorepo and the serial rebuild (required to avoid OOM on a default-resource lease) blows the lease timeout (observed live). When `BORING_FACTORY_VERCEL_SNAPSHOT_ID` is unset, `snapshotRegistry.ts` builds and caches by registry `epicKey`, from that registry entry's epic worktree HEAD—not the host's canonical workspace root—and clones the credential-stripped `origin` derived from that validated worktree. Refresh triggers are unchanged: lockfile hash, expiry, or the changed-package-count guard. The host warms every active registry entry on boot. A fixed snapshot ID remains a deliberate host-wide override.

## Review is a rule, not a chair

`fresh_review` starts a brand-new `boring-reviewer` session bound to one SHA and returns its verdict, provenance (session, model, brief digest), round, and cap state. The Worker records that provenance in the Bead handoff; a `request-changes` verdict is fixed and re-reviewed before handoff until the host cap says to hand off and create follow-up Beads.

## Gate 1 plan budget

Intake persists a host deadline and the kickoff prints its exact timestamp: Gate 1 must
be raised within `BORING_FACTORY_PLAN_BUDGET_MS` (default `1200000`, 20 minutes).
When supervision is armed before Gate 1, the first idle tick at or after that deadline
uses the prompt `raise Gate 1 now with what you have`. This is a nudge only; it never
stops, aborts, or kills the Orchestrator.

## Skill precedence

The canonical `exec` and `owner-gate` blocks assume per-Bead PRs, push-after-commit to a personal branch and blocking `ask_user` gates. The host attaches a `factory-precedence` appendix that overrides those steps for Factory seats: one epic branch and PR, no Worker PRs, no Worker `ask_user`, handoff = Bead comment, Gate 2 (merge) never belongs to an agent. The Worker seat no longer receives `owner-gate`. Owner reconciliation of the canonical skill text is a follow-up; the persona manifests are unchanged so fleet digest pins still match.

## What is still not covered

- Security confinement: local demos are host processes, not containers. Their limited
  host confinement consists only of an exact-SHA disposable lease root as the working
  directory and a scrubbed environment allowlisting `PATH`, `HOME`, `LANG`, `TZ`,
  `NODE_OPTIONS`, `CI`, the loopback `HOST`/selected `PORT`, and non-secret demo
  lease/SHA/readiness values. The command can still read or modify any host path allowed
  to the Factory OS user and has the user's network authority. Use Vercel for untrusted
  execution. A hard executable or shell-builtin allowlist is intentionally out of scope;
  local inputs are limited to one shell command line with control/redirection operators
  rejected. Container-grade confinement belongs to SBX1: the earlier gVisor plan is
  superseded by the ratified Firecracker microVM decision in `docs/DECISIONS.md` §31.
- Local demo listeners are checked through Linux `/proc` and rejected unless the demo
  process group owns only loopback listeners on its selected port. A validated,
  non-wildcard `BORING_FACTORY_DEMO_HOST` address is served by a host-owned reverse proxy
  to that loopback listener; the child never receives the advertised address. This limits
  accidental listener exposure but is not a sandbox or network-egress boundary.
- Concurrency: two Workers on one epic share the worktree without file reservations by owner ruling; collisions are resolved in place. Add reservations only if runs show collisions.
- Provider quotas: model credit exhaustion still surfaces as failed turns. Host dispatch and review caps bound retries, but do not predict or replenish provider credit.

## Owner handoff: two Inbox gates

Every seat's real tool catalog includes the workspace-scoped `ask_user` capability. Factory policy reserves owner contact and both gates for the Orchestrator; its call lands in the Workspace Inbox and blocks the seat until the owner decides.

- **Gate 1, plan approval.** After the Bead graph exists: title `[br-<bead>] Plan approval: <title>`, context = goal, Bead list in dependency order, proof commands, risk and rollback, what approve triggers. Plan ceremony is scaled to the epic (one plan note, at most one adversarial review, no HTML review page unless UI changes). Nothing is dispatched before approve.
- **Gate 2, merge approval.** When `factory_status` shows every epic Bead handed off with SHA, sandbox proof and `fresh_review` approve: the Orchestrator opens or updates the epic PR with the Owner Review card (`docs/procedures/owner-review-card.md`) plus a `## Handover` section, starts an exact-SHA `demo_sandbox` with TTL capped by `BORING_FACTORY_DEMO_MAX_MINUTES`, then raises `ask_user` with PR URL, head SHA, demo URL and lifetime, please-test steps and handover lines. Vercel lease-creation failures fall back visibly to the local provider. Gate 2 requires a URL when the tool can provide one; after both attempts fail, the Orchestrator still raises the gate and records the exact error under `Demo:`. An owner or host waiver relayed in the prompt is authoritative. On approve it comments on the PR and never merges; on changes it opens follow-up Beads.

Both gates survive restarts: pending questions are persisted by the ask-user store and are not swept on boot.

The visual is mandatory at both gates (owner ruling): `show-me` is attached to the Orchestrator seat, and Gate 1's `ask_user` call carries a `show-me-plan` artifact (`docs/issues/<issue>/show-me-plan.md`: structure, behavior, and diff views of what the epic touches) while Gate 2's PR body carries a `## Show me` section between the Owner Review card and `## Handover` (diff-shaped views plus one sequence diagram of the shipped flow, derived from the actual commits), mirrored to `docs/issues/<issue>/show-me-<short sha>.md` and passed as an artifact. `live-epic-acceptance.mjs` asserts both artifacts exist and carry a fenced view.

## Operations

Running several work threads at once is `apps/factory-playground/scripts/factory-epic.mjs` — see the app's README, "Launching your work threads", for the full command reference. Operational shape:

- **One Factory Hub per machine**: one process, one sessions list, and one Inbox at workspace scope `factory-hub`. The host workspace is the canonical repository checkout; it is not an epic worktree.
- **Epic isolation**: each registry entry carries its own repository root, worktree (`<repositoryRoot>/.worktrees/epic-<key>`), branch (`epic/<key>`), Orchestrator, child-session bindings, supervision record, demos, and sandbox snapshot. Multi-repository entries are represented by the schema but not accepted by the current launcher yet.
- **State**: `<stateRoot>/epics.json` is the authoritative runtime epic registry, `<stateRoot>/session-bindings.json` maps every Factory session to its epic, and `<stateRoot>/dispatches.json` records dispatch/review admission and outcomes. Coupled registry/binding mutations write the registry first and bindings second; each state file is atomic. Supervision, limits, demos, leases, and snapshots carry or key by the same epic key.
- **State**: `<stateRoot>/epics.json` is the authoritative runtime epic registry and `<stateRoot>/session-bindings.json` maps every Factory session to its epic. Coupled mutations write the registry first and bindings second; each file is atomic. Supervision, demos, leases, and snapshots carry or key by the same epic key.
- **Demos**: `<stateRoot>/demos.json` records one active demo per epic. A local entry carries
  its process group, Linux process-start identity, and disposable lease root so `stop` can
  terminate the full command tree without signaling a reused PID and release the clone.
  Group liveness is independent of the leader, so surviving children remain stoppable. Boot
  reconciliation drops dead local processes, stops expired demos, restores owner-host proxies,
  and re-arms TTL cleanup; the active URL is projected into workspace metadata and the Epics list.
- **Recovery**: boot validates canonical registry paths, restores missing registry Orchestrator bindings, preserves child bindings to active epics, and drops/logs orphan bindings to missing or closed epics before any re-arm. It then prunes stale supervision, re-arms only matching registry Orchestrators, cleans expired demos, and warms active snapshots. The idempotent adopt endpoint reattaches shared sessions, transfers supervision, and safely copies native transcripts from the former per-epic session roots into the hub namespace; it rejects cross-epic binding collisions and preserves the legacy source files.
- **Lifecycle**: `factory-epic.mjs hub up` starts the shared `5230` API / `5220` UI. `up` provisions and builds an epic worktree, then calls intake; `list` reads live facts from the host; `down` marks the entry closed and never deletes its worktree.

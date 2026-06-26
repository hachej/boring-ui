# beads-rust / `br` workflow analysis for Seneca/background agents

Scope: local read-only inspection of `br` CLI help, schemas, `.beads/` metadata, and sample JSON output in this repo.

## What `br` models well

### Task IDs

- IDs are stable, human-copyable strings with a repo prefix and short suffix, e.g. `boring-ui-v2-reorg-r32b`.
- Hierarchical work can use dotted IDs, e.g. `boring-ui-v2-reorg-cx6v.12` under an epic.
- Local config/DB tracks the active prefix; JSONL rows store the full ID.

Lesson for Seneca: use opaque-but-readable IDs, not database integers. Keep the prefix meaningful for cross-repo/background-agent logs, and allow dotted child IDs when decomposing epics.

### Core task fields

Observed/schema fields include:

- `id`, `title`, `description`, `design`, `acceptance_criteria`, `notes`
- `status`, `priority` (`0` critical through `4` backlog), `issue_type`
- `assignee`, `owner`, `created_by`, timestamps, `closed_at`, `close_reason`
- `labels`, `external_ref`, `due_at`, `defer_until`
- dependency/dependent counts in list views; full relations in detail views

Lesson: split long task intent from mutable operator notes. Seneca should preserve acceptance criteria and proof fields as first-class data, not only chat text.

### Statuses

Schema status enum includes:

```text
open, in_progress, blocked, deferred, draft, closed, tombstone, pinned
```

Common flow in project docs:

```bash
br ready
br show <id>
br update <id> --claim --actor <agent>
br close <id> --reason "..."
br sync --flush-only
```

Lesson: keep statuses simple. `blocked` can be computed from open dependencies for listing, but an explicit blocked/manual state is still useful. `deferred` is separate from blocked.

### Dependencies

`br` supports typed dependencies:

```text
blocks, parent-child, conditional-blocks, waits-for, related,
discovered-from, replies-to, relates-to, duplicates, supersedes, caused-by
```

Important command shape:

```bash
br dep add <issue> <depends-on> --type blocks
br dep list <issue> --direction down   # what this issue waits on
br dep list <issue> --direction up     # what waits on this issue
br dep tree <issue> --direction both --max-depth 3
br dep cycles
```

Sample JSONL dependency row is embedded in each issue as:

```json
{"issue_id":"boring-ui-v2-00rm","depends_on_id":"boring-ui-v2-gi4n","type":"blocks"}
```

Lesson: model dependency direction explicitly as `issue depends_on target`; render it in UI as both blockers and dependents to avoid ambiguity.

### Agent claims / assignment

- Assignment is a field: `assignee`.
- Atomic claiming exists: `br update <id> --claim`, documented as `assignee=actor + status=in_progress`.
- `--actor <ACTOR>` controls audit/creator attribution.
- Project workflow also uses out-of-band Agent Mail/file reservations for collision control; `br` alone is not the whole lock protocol.

Useful examples:

```bash
br update boring-ui-v2-reorg-r32b --claim --actor SenecaWorker-7
br update boring-ui-v2-reorg-r32b --assignee "" --status open
br ready --unassigned --limit 10 --json
br list --assignee SenecaWorker-7 --status in_progress --json
```

Lesson: a background-agent system should provide one atomic claim transition. Do not make workers separately set `assignee` and `in_progress`. If file/workspace locks are separate, show them beside task claims so humans see the full collision state.

## Listing and detail flows

### Discovery views

```bash
br ready --limit 20
br ready --unassigned --label workspace-bridge --json
br blocked --detailed --limit 20
br list --status open --priority 1 --limit 50 --json
br list --all --sort updated_at --reverse --limit 20
br search "ask-user"
br count --group status
br stats
```

`ready` means open, unblocked, not deferred. `blocked` returns blockers with `blocked_by` arrays in JSON.

### Detail views

```bash
br show <id>
br show <id> --json
br show <id> --format toon
br dep list <id> --direction both --json
br comments list <id>
br audit log <id>
```

`show --json` returns the full issue plus labels, dependencies/dependents, comments/events where present. It is the right handoff payload for an agent before work starts.

Lesson: Seneca should have separate optimized list rows and rich detail payloads. List rows need enough for triage (`id/title/status/priority/type/assignee/dependency counts`), while detail should include description, acceptance, proof notes, comments, and dependency objects.

## Storage and sync tradeoffs

Observed local storage:

```text
.beads/beads.db          # SQLite working database
.beads/issues.jsonl      # git-friendly export
.beads/config.yaml       # issue prefix/config
.beads/metadata.json     # database/jsonl filenames
.beads/*.lock            # write/sync locks
.beads/.br_history/      # local history backups
```

`br info --json` reports direct SQLite mode, DB path, JSONL path, issue count, and file sizes. `br sync --status --json` reports dirty count, last import/export times, JSONL hash, and freshness.

Sync commands and safety:

```bash
br sync --status         # read-only freshness/hash check
br sync --flush-only     # DB -> JSONL
br sync --import-only    # JSONL -> DB, validates first
br sync --merge          # 3-way merge using base snapshot
br sync --rebuild        # import and remove DB-only entries
```

Safety guards noted by CLI:

- No git commands or auto-commits.
- Writes only inside `.beads/` unless explicitly allowed.
- Atomic temp-file-then-rename writes.
- Export guards against empty DB overwriting non-empty JSONL and stale DB missing JSONL issues.
- Import rejects conflict markers and invalid JSON.
- Global flags: `--no-auto-flush`, `--no-auto-import`, `--allow-stale`, `--no-db` JSONL-only mode.

Tradeoff lesson:

- SQLite is good for fast local queries, atomic claim/update, dependency traversal, and locks.
- JSONL is good for git diffs, offline review, conflict recovery, and durable sync across clones/agents.
- Dual storage needs freshness checks and explicit sync discipline. Seneca should either make one store authoritative or expose very clear dirty/stale state in UI and worker APIs.
- Append-only audit/comment logs are useful for background-agent accountability, but task state itself benefits from indexed DB queries.

## Command examples worth copying into Seneca docs

```bash
# Find work
br ready --unassigned --limit 10 --json
br blocked --detailed --json
br list --status in_progress --assignee SenecaWorker-7 --json

# Inspect before claiming
br show boring-ui-v2-reorg-r32b --json
br dep list boring-ui-v2-reorg-r32b --direction both --json

# Claim / assign
br update boring-ui-v2-reorg-r32b --claim --actor SenecaWorker-7
br update boring-ui-v2-reorg-r32b --assignee SenecaWorker-7 --status in_progress

# Add graph edges
br dep add child-id parent-id --type parent-child
br dep add implementation-id adr-id --type blocks
br dep tree epic-id --direction up --max-depth 4
br dep cycles

# Complete / reopen
br close boring-ui-v2-reorg-r32b --reason "ADR approved; gates recorded"
br reopen boring-ui-v2-reorg-r32b

# Sync/debug storage
br info --json
br sync --status --json
br sync --flush-only
```

## Design recommendations for Seneca/background agents

1. Make `claim(taskId, actor)` atomic and idempotent; return the winning assignee and status.
2. Represent blockers as typed edges, not prose-only checklists.
3. Provide `ready`, `blocked`, `mine`, and `detail` APIs as separate optimized flows.
4. Keep a compact list schema and a rich detail schema; agents should not parse huge descriptions from every list call.
5. Record acceptance criteria, gate commands, proof/evidence, and close reason as structured fields or clearly named sections.
6. Surface sync/freshness/dirty state if using DB + file export. Hidden auto-sync is convenient but dangerous under multi-agent concurrency.
7. Treat comments/audit as append-only event streams; keep canonical task fields mutable but versioned/audited.
8. Use human-readable IDs in logs and transcripts so background-agent runs can be joined to tasks without DB lookups.
9. Keep dependency direction consistent in API names: `depends_on` for blockers, `dependents` for downstream work.
10. If claims do not reserve files/resources, show that explicitly and integrate with a separate reservation layer.

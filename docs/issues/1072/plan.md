---
github: https://github.com/hachej/boring-ui/issues/1072
issue: 1072
state: ready-for-agent
updated: 2026-08-04
flag: not-needed
track: owner
---

# gh-1072 Boring factory agents and Beads Tasks integration

## Problem

The canonical `feedback`, `triage`, `plan`, `exec`, `fresh-eyes`, and `handoff`
procedures should be usable one-shot through `/skill:<name>` or through a named
Boring Agent selected in Workspace. AgentHost already supports addressed,
deployment-static agents, but there are no checked-in factory identities and the
front still browses one static `agentTypeId`.

Tasks already combines configured sources such as GitHub. It has no Beads (`br`)
source, source-failure isolation, or readable native task-detail surface. The
owner cannot inspect public outcomes and their granular execution graph together.

## Solution

Ship one owner-requested final PR with two independently green lanes and mandatory
review gates before convergence:

1. **Factory-agent fixture lane** — checked-in Concierge, Triage, Steward,
   Worker, and Reviewer definitions; trusted composition of the exact canonical
   skill content; a generic fleet selector; and real AgentHost playground proof.
2. **Tasks/Beads lane** — a generic detail API, source-level failure isolation,
   a read-only Workspace-authorized `br` adapter, and an accessible in-Workspace
   Bead detail sheet.

The Tasks board selects all configured sources by default. This config therefore
shows GitHub issues and Beads together:

```yaml
plugins:
  tasks:
    providers:
      - provider: github
        repo: auto
      - provider: beads
```

The lanes remain separate commits/review units. Any unresolved tier-2 finding in
one lane blocks convergence but not proof/review of the other.

## Decisions

### Authored identity is not executable authority

Repository fixtures use:

```text
agents/boring/<role>/agent.json
agents/boring/<role>/instructions.md
```

`agent.json` contains only `schemaVersion`, `definitionId`, `version`, safe
display metadata, and `instructionsRef`. It contains no model, plugin, tool,
credential, path, capability, or non-empty `skillRefs`.

The role statements in `instructions.md` are **behavioral policy**, not a security
boundary. This PR does not claim that Concierge or Reviewer lacks filesystem or
shell capability. Enforced least-privilege tool profiles require a separate
trusted runtime-policy issue. The instructions must state that limitation rather
than implying sandbox enforcement.

### Trusted skill activation and one-shot equivalence

Every active workflow skill remains explicit-only. Merely naming an invisible
skill in authored prose is insufficient. Playground host composition therefore
owns a role-to-skill table and performs this trusted boot sequence:

1. materialize the authored identity;
2. resolve the canonical checked-in `SKILL.md` files from host-authorized roots;
3. verify their recorded content digests;
4. append the exact primary/supporting skill content to the configured AgentHost
   instructions with source name/digest boundaries; and
5. fail boot when a required skill is absent or changed from the admitted digest.

The generic authored-source → `ConfiguredAgentHostAgentSpec` mapper accepts
trusted instruction appendices, plugin bindings, and model policy; none may come
from authored JSON. Public-seam tests cover every admitted binding and resolve
only `.agents/skills/{feedback,triage,plan,exec,fresh-eyes,handoff}/SKILL.md`—never
similarly named copies under `skill-library`. Each content/digest must equal the
canonical file used by the corresponding one-shot `/skill:<name>` invocation.

This is a repository/playground dogfood fixture. Root `agents/boring/**` is not
claimed to be distributed in an installed npm package. Seneca may later package
the same definitions/skills behind pinned provenance; that is out of scope.

### Models remain trusted host policy

`agent.json` has no default model. Trusted composition may set
`ConfiguredAgentHostAgentSpec.model.preferred` as `provider:id`; omission uses the
deployment's configured default. The mapper tests a supplied role preference and
strict isolation, but this PR bakes in no vendor/model ID or credential. Concrete
Seneca defaults remain private deployment policy.

### Roles

| Agent | Canonical skill content | Behavioral purpose |
| --- | --- | --- |
| Concierge | `feedback`, `triage`, `handoff` | Owner-facing routing and narration. |
| Triage | `triage`, `handoff` | Advance one issue transition. |
| Steward | `plan`, `handoff` | Plan, approval artifact, Bead materialization, integration supervision. |
| Worker | `exec`, `handoff` | Execute one claimed Bead in its assigned worktree. |
| Reviewer | `fresh-eyes`, `handoff` | Produce a fresh exact-revision verdict. |

One-shot use remains `/skill:<name> <args>`. Named-agent use selects the role and
passes ordinary arguments; its trusted composed instructions already contain the
same skill content.

### Fleet selection and session semantics

`WorkspaceAgentFront`'s existing `agentTypeId` prop is the immutable **host
default**. No new default marker is added to `AgentGateway`.

The selector maintains a separate `selectedAgentTypeId` used for:

- filtering the session inventory in v1;
- creating new sessions; and
- plugin actions that intentionally create a new chat.

Rules:

- fetch options from `GET /api/v1/agents`;
- persist selection per Workspace UI storage scope;
- if stored selection is absent/stale, use the host-default prop when present;
- if the host default is unexpectedly absent, keep legacy host-default behavior
  and surface a non-blocking fleet diagnostic rather than guessing “first item”;
- changing selection does not mutate, rename, reconnect, or close existing
  addressed sessions/panes;
- existing open panes remain keyed by `{agentTypeId, sessionId}` even when IDs
  collide across agents;
- the visible session inventory shows only the selected agent in v1—no fleet-wide
  aggregate list;
- selection changes the owner for future session creation, not the owner of an
  already-open session or in-flight turn;
- single-agent, fleet-loading, and fleet-error states preserve the current
  default-Agent path.

The playground composes the real five-agent fleet and proves selector behavior.
Production Seneca composition is not enabled by default.

### Generic Tasks source-failure isolation

One unhealthy source must not hide healthy GitHub issues. Replace board-level
`Promise.all` failure with per-source settlement. Successful source configs/tasks
render; each failing source produces a visible retryable source error. Refresh can
retry one source or all. Cached successful data remains labeled stale when its
refresh fails.

The HTTP client retains stable `{code, message, retryable}` error data instead of
throwing only an untyped message.

### Generic detail DTO

Add exact JSON-safe contracts:

```ts
interface BoringTaskRelation {
  id: string
  title?: string
  status?: string
  nativeType?: string
  direction: "parent" | "child" | "blocked-by" | "blocks" | "related"
}

interface BoringTaskMetadataItem {
  id: string
  label: string
  value: string
}

interface BoringTaskDetail {
  task: BoringTaskCard
  body?: string
  acceptanceCriteria?: string
  notes?: string
  metadata: BoringTaskMetadataItem[]
  relations: BoringTaskRelation[]
  updatedAt?: string
}
```

Extend `BoringTaskCard` generically with optional `priority?: string`,
`issueType?: string`, and `assignee?: string`; Beads maps numeric priority to
`P<n>`. These are card fields, not encoded into tags or description.

Bounds are normative: IDs/status/native types 256 characters; titles 512;
preview descriptions 512; tag/metadata labels 128; metadata values 2,048; body,
acceptance, and notes 256 KiB each; at most 64 metadata entries, 512 relations,
and 1 MiB decoded detail response. Reject over-limit provider data as
`TASK_BEADS_INVALID_RESPONSE`.

Relations are sorted by direction then ID and deduplicated by
`(direction,id,nativeType)`. Native mapping is: explicit `parent` → `parent`;
`children` → `child`; `dependencies` with `parent-child` matching the parent →
`parent`; other `dependencies` → `blocked-by`; `dependents` → `blocks`; native
`related`/`discovered-from` → `related`. Preserve `nativeType`. Unknown provider
fields are ignored. Server mapping strips host paths before DTO construction;
browser rendering is plain pre-wrapped text—no raw HTML or Markdown dependency.

Add optional `detail` capability/`getTask`, generic service dispatch,
`POST /api/boring-tasks/sources/tasks/get`, and stable unknown-source,
unsupported-detail, and not-found behavior. Detail bypasses the two-minute list
cache.

### Beads execution authority and placement

Routes and request DTOs receive no root/path/cwd. The Beads source receives an
injected `BeadsOperations` capability already bound by trusted host composition
to one Workspace execution location. It exposes only:

```ts
runRead(args: readonly string[], limits): Promise<{ stdout: string }>
```

The source cannot select a host path. Local/playground composition provides a
path-validating adapter bound to the admitted Workspace root; remote/runtime
Workspaces without a matching operations adapter report
`TASK_BEADS_RUNTIME_UNAVAILABLE`. Request body, provider config, card data,
`source_repo`, and `source_repo_path` never influence execution placement.

This is the adapter boundary required by the Workspace invariant. The legacy
GitHub root-shaped adapter is recorded debt and is not copied into the Beads
source.

### Fixed read protocol and ID safety

Supported runtime is pinned/tested at `br 0.2.16`. Fixed commands are:

```text
br list --all --json --no-auto-flush --no-auto-import
br show --json --no-auto-flush --no-auto-import -- <validated-id>
```

The adapter uses `execFile`, never a shell. Bead IDs must be NFC ASCII matching
`^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$`; control/whitespace/non-ASCII/traversal-like
or leading-dash IDs fail before execution. `--` remains mandatory. Tests include
`--db=...`, `--config`, `../`, whitespace/control, overlength, and Unicode.

The provider invokes no mutation/import/flush command. Read-only proof uses a
reproducible two-layer fingerprint:

1. canonical JSON SHA-256 of complete `br list --all` output sorted by ID plus
   `br show` output for every fixture ID (and the selected live-smoke ID), with
   object keys recursively sorted; and
2. byte SHA-256/size inventory before and after for `issues.jsonl`, `beads.db`,
   `beads.db-wal`/`beads.db-shm` when present, `metadata.json`, and `config.yaml`.

The semantic JSON digest and authoritative JSONL/DB byte digests must remain
unchanged. Transient lock-file inventory/mtime is reported separately and never
silently omitted. This proves through public `br` output and file bytes without
querying SQLite internals.

### Beads mapping

List status mapping is explicit:

| Native | Board |
| --- | --- |
| `open` | `open` |
| `in_progress` | `in-progress` |
| `blocked` | `blocked` |
| `deferred` | `deferred` |
| `ready_for_human` | `ready-for-human` |
| `closed` | `closed` |
| anything else | `other` |

Cards map ID, title, compact description, status, labels, priority, issue type,
assignee, and parent/epic when present. Detail maps full description,
acceptance criteria, notes, parent, dependencies, dependents/children when
present, and safe source-repository name. `source_repo_path` and path-shaped
unknown fields are discarded.

Duplicate list IDs fail the Beads source only; GitHub remains visible.

### Closed error contract

Export these stable codes with HTTP status and retryability:

| Code | HTTP | Retryable |
| --- | ---: | :---: |
| `TASK_INVALID_BODY` | 400 | no |
| `TASK_BEADS_ID_INVALID` | 400 | no |
| `TASK_SOURCE_NOT_FOUND` | 404 | no |
| `TASK_NOT_FOUND` | 404 | no |
| `TASK_BEADS_NOT_FOUND` | 404 | no |
| `TASK_BEADS_STORE_NOT_FOUND` | 404 | no |
| `TASK_SOURCE_DETAIL_UNSUPPORTED` | 409 | no |
| `TASK_BEADS_STORE_UNHEALTHY` | 409 | yes |
| `TASK_BEADS_RUNTIME_UNAVAILABLE` | 409 | no |
| `TASK_BEADS_VERSION_UNSUPPORTED` | 409 | no |
| `TASK_BEADS_BINARY_NOT_FOUND` | 503 | no |
| `TASK_BEADS_TIMEOUT` | 504 | yes |
| `TASK_BEADS_OUTPUT_TOO_LARGE` | 502 | yes |
| `TASK_BEADS_COMMAND_FAILED` | 502 | yes |
| `TASK_BEADS_INVALID_JSON` | 502 | yes |
| `TASK_BEADS_INVALID_RESPONSE` | 502 | yes |
| `TASK_BEADS_DUPLICATE_ID` | 502 | no |
| `TASK_SOURCE_LIST_FAILED` | 502 | yes |
| `TASK_SOURCE_ERROR` | 500 | yes |

Partial list success returns:

```ts
interface BoringTaskSourceError {
  sourceId: string
  code: BoringTaskErrorCode
  message: string
  retryable: boolean
  stale: boolean
}
interface TaskListOutput {
  configs: Record<string, BoringTaskBoardConfig>
  tasks: BoringTaskCard[]
  errors: Record<string, BoringTaskSourceError>
}
```

An explicitly requested unknown source rejects the request; a known source list
failure enters `errors` while other sources succeed. Messages contain no command
output, environment, cwd, DB path, or raw stderr. The front preserves
code/retryability. Config rejects unsupported keys and duplicate Beads providers.

### Workspace detail UX

A detail-capable card has a dedicated title/open control rather than making a
draggable article ambiguously interactive. Opening displays a responsive sheet
inside `TasksOverlay` with `role="dialog"`, accessible name, Escape close, focus
containment, and focus return to the originating control. It shows identity,
status, metadata, description, acceptance, notes, and relations; supports
loading, retry, source failure, and close/back. Nested chat/external/action
controls retain their current behavior and never open detail.

No derived file, global surface resolver, external page, raw HTML, or Markdown
renderer is introduced.

## Flag / Abstraction

- Needed?: No global flag. Beads is present only with an explicitly configured
  provider and injected operations adapter. Factory agents are present only when
  trusted host composition supplies them.
- Rollback: remove the Beads provider/config and factory specs. Existing GitHub
  Tasks and legacy default Agent remain.

## Test Seams

- Agent: compiler/materializer → trusted mapper → real AgentHost listing/session
  create → Workspace selector.
- Skills: named-role composed source/digest equals canonical one-shot `SKILL.md`.
- Tasks: source/service HTTP contracts → all-settled board → detail dialog.
- Beads: injected operations capture exact argv; supported live `br 0.2.16` smoke
  validates asymmetric list/show JSON and semantic no-mutation fingerprints.
- Avoid: private Seneca credentials/provider IDs, SQLite internals, raw host paths,
  or React implementation details.

## Acceptance

1. Five authored fixtures compile/materialize and contain no executable authority.
2. Named roles receive exact digest-verified canonical skill content through
   trusted host composition; missing/mismatched skill content fails boot.
3. Trusted role model/plugin policy cannot originate from authored JSON; supplied
   preferred model remains isolated and optional.
4. Workspace lists/selects five addressed agents, filters the selected inventory,
   creates under the selected owner, preserves old addressed panes, handles
   colliding session IDs, and retains default/single-agent compatibility.
5. Role constraints are documented as behavioral—not enforced capability claims.
6. Tasks config accepts one strict `{provider:"beads"}` entry; GitHub and Beads
   render together and one source failure does not hide the other.
7. Beads cards preserve ID/title/status/preview/labels/priority/type/assignee and
   parent/epic when available, without host paths or semantic task mutation.
8. Bead detail returns full description, acceptance, notes, metadata, parent and
   dependency/dependent relations through the exact bounded DTO.
9. Option injection, malformed/oversized output, timeout, binary/runtime/store
   failures, duplicate IDs, and unknown detail use the closed redacted errors.
10. The accessible detail dialog passes keyboard, Escape, focus return,
    loading/error/retry/close, nested-action, and drag regression tests.
11. Agent, Workspace, Tasks, and playground tests/typechecks/builds plus import/
    invariant checks pass.
12. Automated browser assertions and current-head screenshots show fleet
    selection, GitHub + Beads source isolation, and one open Bead detail.

## Proof

- `pnpm --filter @hachej/boring-agent test`
- `pnpm --filter @hachej/boring-agent typecheck`
- `pnpm --filter @hachej/boring-agent build`
- `pnpm --filter @hachej/boring-workspace test`
- `pnpm --filter @hachej/boring-workspace typecheck`
- `pnpm --filter @hachej/boring-workspace build`
- `pnpm --filter @hachej/boring-tasks test`
- `pnpm --filter @hachej/boring-tasks typecheck`
- `pnpm --filter @hachej/boring-tasks build`
- `pnpm --filter workspace-playground test`
- `pnpm --filter workspace-playground build`
- supported `br 0.2.16` list/show compatibility + semantic fingerprint smoke
- `pnpm audit:imports && pnpm lint:invariants && git diff --check`
- browser assertions: selection persistence/fallback, addressed create, source
  isolation, dialog focus/retry/Escape/close
- screenshots: factory selector; combined sources; open Bead detail

## Slices

### A — Handoff, identities, and trusted skill composition

**Delivers:** reviewed handoff skill/procedure, five authored fixtures, trusted
mapper/role-skill composition, digest equivalence, optional model policy tests.

**Blocked by:** None.

**Gate:** tier-1 + tier-2 review green before fleet UI convergence.

### B — Fleet selector and playground proof

**Delivers:** explicit selected-new-session semantics, generic selector, addressed
inventory/create behavior, real five-agent playground composition.

**Blocked by:** A for final integration; UI may develop against configured-agent
fixtures before A completes.

**Gate:** Agent/Workspace builds and browser assertions green.

### C — Generic detail and source isolation

**Delivers:** exact bounded DTO, typed errors, optional detail capability/route,
all-settled source loading, per-source retry/stale behavior.

**Blocked by:** None.

**Gate:** Tasks shared/server/front tests and typecheck green.

### D — Workspace-authorized Beads provider

**Delivers:** injected operations boundary, fixed argv/ID validation, parsers,
status/detail mapping, strict config, closed errors, live compatibility/fingerprint
proof.

**Blocked by:** C.

**Gate:** security/path review and Tasks build green.

### E — Accessible Bead detail dialog

**Delivers:** dedicated card open control and responsive plain-text detail dialog.

**Blocked by:** C; may develop with a mock adapter while D completes.

**Gate:** component accessibility tests and high-taste visual review green.

### F — Convergence and PR handoff

**Delivers:** one owner-requested final PR composed from independently reviewed
green commits, full proof, tier-2 cross-lane review, browser artifact, exact-SHA
owner handoff.

**Blocked by:** A–E gates.

**Stop/go:** if either lane still has a blocker/major after one focused fix loop,
stop convergence and split the clean lane into a separate PR rather than lowering
the bar.

## Materialized Beads

Plan revision `2026-08-04` was materialized after independent review:

| Slice | Bead |
| --- | --- |
| Root | `wt-391-forward-gh-1072-factory-agents-beads-020e` |
| A | `wt-391-forward-gh-1072-factory-agents-beads-020e.1` |
| B | `wt-391-forward-gh-1072-factory-agents-beads-020e.2` |
| C | `wt-391-forward-gh-1072-factory-agents-beads-020e.3` |
| D | `wt-391-forward-gh-1072-factory-agents-beads-020e.4` |
| E | `wt-391-forward-gh-1072-factory-agents-beads-020e.5` |
| F | `wt-391-forward-gh-1072-factory-agents-beads-020e.6` |

`br dep cycles --json` returned zero cycles. `bv --robot-insights` completed and
identified F as the expected convergence articulation point. A and C are the
initial executable leaves.

## Out of Scope

- Enforced per-role tool/capability denial.
- Production Seneca packaging, concrete model IDs, credentials, capacity, or
  enabling the factory fleet by default.
- Automatic schedules, dispatch, Factory Patrol, swarm dashboard, or agent mail.
- Beads mutation, claim, dependency editing, comments, repair, import, or flush.
- Human approval or merge automation.
- Reworking the legacy GitHub provider's root-shaped adapter.

## Open Questions

None blocking after review revision. One final PR remains the owner-requested
target, with an explicit split fallback if cross-lane review cannot converge.

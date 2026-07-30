---
github: https://github.com/hachej/boring-ui/issues/994
issue: 994
state: ready-for-human
updated: 2026-07-30
flag: not-needed
track: owner
---

# gh-994 Preserve CLI workspace chat sessions across redeploys and identity upgrades

## Problem

`boring-ui workspaces` does not have one durable, stable storage identity for a
workspace's chat history.

Workspaces mode deliberately returns no session namespace in
`packages/cli/src/server/modeApps.ts`. `PiSessionStore` therefore chooses a
directory derived from the workspace filesystem path:

```text
<session-root>/--<encoded-workspace-path>--/
```

This creates two continuity failures:

1. **Location discontinuity.** A deployment or relocation changes the
   filesystem path, so the next process selects another encoded directory and
   leaves the prior transcripts undiscovered.
2. **Ownership discontinuity.** Files can remain in the selected directory but
   disappear when persisted `boringSessionCtx` does not match the context used
   by the route serving the list.

The affected host confirms the second failure and shows that issue #994's
path-only diagnosis is incomplete:

- the registry id remained `boring-ui-factory-a1188e94`;
- the workspace path and path-derived directory remained stable;
- the directory contained 29 JSONL files, including linked transcript graph
  members, not necessarily 29 browser-visible sessions;
- 26 headers had no `boringSessionCtx`, two had only the workspace id, and one
  had `{ workspaceId, userId: "local" }`;
- the legacy sessions endpoint returned one session while the addressed Agent
  Host endpoint returned two.

No transcript was deleted. Different readers selected different ownership
projections over the same surviving files.

`BORING_AGENT_SESSION_ROOT` alone cannot solve relocation. With no namespace,
`PiSessionStore` still appends the encoded cwd. A durable root protects bytes
from an ephemeral home directory, but lookup still changes with the workspace
path.

## Solution

Establish one CLI workspaces-mode storage contract:

1. **Canonical ownership context:** both legacy and addressed session APIs use
   the verified scope `{ workspaceId, userId: authSubjectId }`. In trusted-local
   CLI mode, `authSubjectId` is `"local"`.
2. **Canonical physical namespace:** new workspaces-mode sessions live under a
   versioned, collision-resistant namespace derived from the persisted registry
   id:

   ```text
   <session-root>/cli-ws-v2-<sha256(registry-id)[0:20]>/
   ```

3. **Copy-only compatibility adoption:** before a workspace's session routes are
   activated, a CLI-owned adapter imports uniquely attributable legacy session
   graphs from the current path-derived directory and the historical
   `local-workspace-<registry-id>` directory.
4. **Durable deployment inputs:** deployments persist both the workspace
   registry and session root.
5. **Supported relocation:** the registry can update an existing entry's path
   without changing its id, so a move does not manufacture a new storage
   identity.

Folder mode remains cwd-derived and continues sharing with standalone terminal
Pi. Workspaces mode prioritizes continuity and isolation. It adopts attributable
legacy terminal sessions at activation, but no longer promises permanent live
bidirectional sharing with terminal Pi.

## Decisions

### 1. Canonicalize the verified user scope before migrating bytes

`AgentSessionInventory` currently lists and resolves sessions with only
`workspaceId`, while the trusted-local legacy route can use
`{ workspaceId, userId: "local" }`. Exact `PiSessionStore` matching makes those
surfaces disagree.

Use the verified claim for both dimensions:

```ts
{
  workspaceId: claim.workspaceScopeId,
  userId: claim.authSubjectId,
}
```

Apply the same canonical context to create/list/load/state/events/rename/delete.
This includes the addressed rename path in `embeddedGateway`, not only
`AgentSessionInventory`; every operation that constructs a `SessionCtx` must use
one shared claim-to-context helper. This is stricter for multi-user hosts, not
broader: one user's inventory cannot read another user's transcript merely
because they share a workspace.

Add a characterization fixture reproducing the affected matrix before changing
it:

- unscoped header: hidden by scoped routes until adopted;
- workspace-only header: legacy compatibility candidate, not silently accepted
  by generic multi-user storage;
- exact workspace + user header: visible through both route families;
- explicit other workspace or user: always hidden.

Do not weaken `PiSessionStore.storedCtxBelongsToCtx` globally.

### 2. Use a versioned hashed namespace

Use `cli-ws-v2-${sha256(workspace.id).slice(0, 20)}` rather than embedding the
raw id.

Why:

- parsed registry YAML accepts arbitrary nonempty ids, while session namespaces
  permit only `[A-Za-z0-9_-]+`;
- lossy sanitization can collide;
- a versioned namespace does not coincide with the historical
  `local-workspace-<id>` source directory, allowing immutable-source adoption;
- the persisted id, not its path-derived creation algorithm, is the workspace's
  live authorization identity.

At registry load, reject duplicate ids and duplicate derived canonical
namespaces with a stable configuration error.

### 3. Persist both registry and session root

Deployment guidance must require durable locations for both:

```text
BORING_UI_WORKSPACES_PATH=/data/boring-ui/workspaces.yaml
BORING_AGENT_SESSION_ROOT=/data/pi-sessions
```

A durable namespace is only useful while the registry record survives. Readding
a moved path currently generates a new path-derived id. The fix therefore adds
a supported `relocate(id, newPath)` registry operation and a local-workspaces
HTTP operation that validates the new path but preserves `id`, `createdAt`,
name, and plugin configuration.

Relocation is a live runtime transition, not just a YAML edit. Before committing
the new path, preview legacy adoption. On apply, dispose the old workspace
runtime and invalidate every path-bound cache: plugin runtime/snapshot,
automation store, provisioning result, bridge/backend binding, Agent runtime
scope, and continuity promise. Commit the registry path only after validation;
subsequent chat and non-chat requests must rebuild from the new path. If apply
fails after disposal but before registry write, the old record remains and its
runtime can be lazily recreated.

Local desktop use may retain home-directory defaults. Code can verify
writability but cannot prove that an operator mounted durable storage.

### 4. Adopt complete transcript graphs, not raw file counts

A browser-visible session may consist of a Boring wrapper plus a linked native
Pi transcript. `PiSessionStore` suppresses linked dependency files from the
visible root list. Adoption must inventory graph roots and their dependency
closure before making ownership or count decisions.

For each accepted graph:

- **native Pi transcript without wrapper:** copy the native transcript into the
  canonical namespace, then create a canonical Boring wrapper with the
  canonical scoped context and a link to the copied native file;
- **Boring transcript containing messages:** copy it into the canonical
  namespace and add/complete `boringSessionCtx` only in the destination header;
- **Boring wrapper with a linked native transcript:** copy both files into the
  canonical namespace, rewrite the destination wrapper's link to the canonical
  native copy, and set the destination wrapper's canonical scoped context.

Never leave canonical wrappers pointing at legacy source paths. Normal
continuation, rename, and delete may mutate/delete canonical copies while every
legacy source byte remains unchanged.

Reject missing linked dependencies with a stable diagnostic. Do not recursively
follow paths outside the approved session roots.

### 5. Use conservative CLI-only ownership rules

A graph is automatically attributable only when:

1. its Boring header names the target workspace id and has no user id or the
   canonical user id; or
2. it is unscoped/native, resides in the exact path-derived directory for the
   currently registered canonical workspace path, its header cwd resolves to
   that path, and that source directory maps to exactly one registry entry; or
3. it resides in the exact historical namespace for the same persisted registry
   id and does not explicitly name another workspace or user. Probe this legacy
   namespace only when the raw id satisfies the historical safe namespace
   grammar; unsafe/manual ids have no implicit historical source.

Every automatic source and linked dependency is checked with `lstat` plus
canonical containment under an approved session root. Symlinked sources,
symlinked dependencies, traversal, and out-of-root links are rejected.

Never import a graph with an explicit mismatched workspace id or user id. Never
scan arbitrary encoded directories and guess from titles, basenames, timestamps,
or prompts.

After a path has changed, unscoped sessions under an old path require explicit
operator authority. This is a separate claimed-path rule: canonicalize the
claimed old path; prove it is not the current/claimed path of another registry
entry; require each unscoped header cwd to canonicalize exactly to that claimed
path; and reject explicit mismatched ownership. A dry-run API returns graph
counts, redacted conflicts, and a digest of the proposed adoption plan. Apply
requires that digest and revalidates the inventory before changing the registry,
preventing a preview/apply TOCTOU.

### 6. Preserve source bytes and make adoption independently mutable

Source files are host-owned user data. Adoption never moves, renames, deletes,
compacts, or rewrites them.

Publish every canonical graph atomically and exclusively:

1. inventory the source graph and record size, mtime, and digest;
2. exclusively create a durable destination claim keyed by canonical session id
   and containing the source-graph key and preview plan digest;
3. if a claim exists for the same source graph, resume/recover it; if it names a
   different source graph, return `destination_collision` before writing files;
4. copy/transform to temporary files in the canonical namespace;
5. re-read source size/mtime/digest to detect an active writer;
6. close and flush temporary files;
7. publish dependencies, then wrapper/root, only when final paths are absent;
8. publish that graph's provenance record last with exclusive create and mark
   the destination claim complete.

The destination claim is durable ownership/provenance, not a time-based lock.
Crash recovery validates its source key and plan digest before resuming; it is
never expired or stolen based on age.

If the source changes during adoption, retry a bounded number of times and then
return `source_active`. No persistent filesystem lock is required: a
per-workspace in-process promise serializes normal operation, while exclusive
per-file/per-graph publication makes cross-process attempts either converge on
identical provenance or return `adoption_conflict` without overwriting.

### 7. Manifest provenance prevents resurrection and false collisions

Store one exclusive non-JSONL provenance record per source graph plus one
exclusive destination claim per canonical session id:

```text
.boring-session-adoption-v1/graphs/<sha256(source-root-id + root-relative-path)>.json
.boring-session-adoption-v1/claims/<canonical-session-id>.json
```

A shared read-modify-write manifest is forbidden because two processes could
atomically rename competing snapshots and lose each other's entries. Each
per-graph record contains only storage provenance: source root-relative paths,
source digests, destination session id/files, ownership basis, and completion
status. It must not contain prompts, messages, tool inputs, or provider data.
The provenance directory and records must pass the same no-symlink containment
checks as transcripts.

On later starts:

- a completed provenance record prevents reimport even if canonical files have
  legitimately changed through continuation or rename;
- if a user deleted the canonical session, the completed record prevents the
  immutable source from resurrecting it;
- if a completed record names missing canonical files, report
  `adopted_target_missing` and do not silently reimport;
- if destination files exist without a completed record after a crash, compare
  the staged source identity and canonical graph before completing provenance;
- a same session id with unrelated destination provenance is
  `destination_collision` and is never overwritten;
- concurrent exclusive creation of the same provenance path succeeds only when
  the existing record is byte-identical; otherwise return `adoption_conflict`;
- different source graphs targeting the same canonical session id contend on
  one destination claim, so exactly one source graph can own the destination.

This makes adoption idempotent after normal session mutation, deletion, and
cross-process startup—not merely before first use.

### 8. Failure and diagnostic policy

Stable adoption/configuration codes:

- `registry_identity_conflict`
- `ambiguous_source`
- `ownership_mismatch`
- `destination_collision`
- `destination_claim_conflict`
- `linked_transcript_missing`
- `linked_transcript_outside_root`
- `source_active`
- `adoption_conflict`
- `adopted_target_missing`
- `storage_unavailable`

Policy:

- registry identity conflicts, ambiguous ownership, destination collisions, and
  unavailable canonical storage block that workspace's session activation;
- explicit other-workspace/user graphs are safely skipped and counted without
  logging content;
- unreadable/corrupt individual files are skipped with redacted diagnostics if
  they are not dependencies of an otherwise accepted graph;
- missing/out-of-root dependencies block adoption of that graph but need not
  block unrelated valid graphs;
- public route failures use the existing stable error envelope, with conflict
  conditions mapped to 409 and unavailable storage to 503.

The workspace may still load non-chat surfaces while chat shows an actionable
storage diagnostic. Do not expose transcript contents or absolute host paths to
the browser response.

## Flag / Abstraction

- **Needed?:** No runtime flag. The old behavior is unsafe for continuity.
- **Path:**
  - Agent Host uses the full verified session context consistently.
  - A CLI-owned `sessionContinuity` adapter inspects and adopts legacy graphs.
  - `PiSessionStore` remains a strict single-directory store.
  - `LocalWorkspaceRegistry.relocate` preserves persisted identity across path
    changes.
- **Rollback:** All legacy source bytes remain readable by the old path-derived
  binary. Canonical sessions created or continued after cutover remain in the
  v2 namespace and are not visible to the old binary. Rollback therefore gives
  a stale legacy view; operators must preserve the canonical root and re-upgrade
  to recover post-cutover state. Do not dual-write.

## Proposed interfaces

Exact names may follow local style, but keep responsibilities explicit:

```ts
type CliSessionContinuityInput = {
  sessionRoot: string
  workspace: { id: string; path: string }
  allWorkspaces: Array<{ id: string; path: string }>
  canonicalUserId: string
  claimedOldPath?: string
}

type CliSessionAdoptionPreview = {
  namespace: string
  planDigest: string
  attributableGraphs: number
  skippedGraphs: Array<{ code: CliSessionAdoptionCode; redactedSourceId: string }>
}

type CliSessionAdoptionResult = {
  namespace: string
  adoptedGraphs: number
  alreadyAdoptedGraphs: number
  skippedGraphs: Array<{ code: CliSessionAdoptionCode; redactedSourceId: string }>
}

previewCliWorkspaceSessions(input): Promise<CliSessionAdoptionPreview>
applyCliWorkspaceSessions(input, planDigest): Promise<CliSessionAdoptionResult>
```

The CLI importer needs a supported Agent-owned read-only transcript graph codec
(or shared conformance fixtures) for header parsing, linked-path discovery,
canonical wrapper generation, and session-id extraction. Do not duplicate
private JSONL semantics ad hoc in `modeApps.ts`.

## Test Seams

- **Highest public seam:** `createWorkspacesModeApp` plus Fastify injection of
  both legacy and addressed session list/state/events routes using
  `x-boring-workspace-id`.
- **Agent scope seam:** `AgentSessionInventory` tests prove full verified claim
  propagation and cross-user rejection.
- **Migration seam:** temporary source/canonical roots prove graph adoption,
  provenance, crash recovery, canonical mutation, and source immutability.
- **Registry seam:** registry tests prove relocate preserves id and metadata and
  rejects duplicate identities.
- **Existing prior art:** `packages/cli/src/server/__tests__/modeApps.agentHost.test.ts`
  and Agent legacy transcript compatibility tests.
- **Avoid testing:** UI snapshots or transcript message content. Assert ids,
  counts, route status, graph topology, and byte digests.

## Acceptance

1. Legacy and addressed API surfaces return the same session ids for the same
   verified CLI scope, and list/state/events/rename/delete all reject a different
   user or workspace.
2. A new workspaces-mode session is stored under
   `<session-root>/cli-ws-v2-<id-hash>/`, independent of workspace path.
3. Restarting/redeploying with the same durable registry and session root
   preserves list/state/events behavior.
4. Preview plus `relocate(existingId, newPath, planDigest)` preserves the id and
   canonical namespace, disposes old path-bound runtime state, and serves both
   chat and non-chat requests from the new path without a process restart.
5. A uniquely attributable unscoped native transcript is adopted as a complete
   canonical graph and appears through both API surfaces.
6. A workspace-only legacy header is adopted to the canonical trusted-local
   context and appears through both API surfaces.
7. Historical `local-workspace-<registry-id>` graphs are adopted even though
   the canonical v2 namespace differs.
8. Explicit other-workspace or other-user graphs remain hidden and unmodified.
9. Linked native dependencies are copied into the canonical namespace; canonical
   continuation, rename, and delete never modify legacy source bytes.
10. Repeating adoption after canonical continuation/rename/delete does not
    overwrite, duplicate, collide with, or resurrect the source session.
11. Same-id unrelated destination graphs fail with `destination_collision` and
    overwrite nothing.
12. Source mutation during copy yields a bounded retry or `source_active`.
13. Unsafe/manual registry ids map to deterministic collision-resistant safe
    namespaces; duplicate ids/namespaces fail before activation.
14. Folder mode retains cwd-derived standalone-Pi sharing.
15. Deployment docs require durable registry/session roots and explain recovery
    limits after registry loss or destruction of an ephemeral source volume.
16. Diagnostics never expose transcript bodies, prompts, tool inputs, provider
    data, or raw absolute host paths to clients.

## Proof

- **Exact commands:**

  ```bash
  pnpm --filter @hachej/boring-agent test
  pnpm --filter @hachej/boring-agent typecheck
  pnpm --filter @hachej/boring-ui-cli test
  pnpm --filter @hachej/boring-ui-cli typecheck
  pnpm lint:invariants
  ```

- **Scope convergence proof:** Seed unscoped, workspace-only, exact-scope, and
  mismatched-scope headers; assert legacy and addressed list/state/events/
  rename/delete routes converge without cross-workspace/user exposure.
- **Relocation proof:** Boot workspaces mode against temporary durable roots,
  create a session, preview and apply relocation for the same registry id in the
  live process, then prove list/state/events retain the session while filesystem,
  plugin, and another non-chat route resolve the new path. Restart and repeat the
  continuity assertion.
- **Graph adoption proof:** Hash all source graph files, adopt, continue/rename/
  delete canonical sessions, restart twice, and assert every source hash is
  unchanged and no deleted session resurrects.
- **Crash/idempotency proof:** Exercise destination-without-manifest and
  manifest-with-missing-target states and assert deterministic diagnostics.
- **Manual host verification:** Back up the affected session root, inventory
  visible root session ids (not raw file count), install the candidate, restart,
  and compare before/after ids through both API surfaces. Do not include
  transcript content in artifacts.
- **Screenshot/demo:** Not required; this is persistence and authorization
  behavior.

## Slices

### Slice 1: Canonical verified session scope

**Delivers:**

- One shared verified-claim-to-`SessionCtx` projection used by Agent Host
  inventory and every addressed operation, including the independent
  `embeddedGateway` rename path and deletion.
- Trusted-local legacy route parity for list/state/events/rename/delete.
- Characterization and regression tests for unscoped, workspace-only, exact,
  cross-workspace, and cross-user headers across reads and mutations.

**Blocked by:** None.

**Proof:** Agent Host inventory tests and dual-route CLI acceptance fixture.

**Review budget:** Inside. This is a narrow authorization-correctness change and
must receive an adversarial isolation review.

### Slice 2: Stable namespace, graph adoption, and relocation substrate

**Delivers:**

- Versioned hash namespace derivation and duplicate detection.
- Agent-owned read-only transcript graph codec/conformance seam.
- CLI-owned copy-only graph adoption with canonical dependency copies,
  exclusive per-graph provenance records, per-session destination claims,
  atomic exclusive publication, bounded source-stability checks, stable
  diagnostics, and idempotency after canonical mutation/deletion and concurrent
  startup.
- `LocalWorkspaceRegistry.relocate` preserving id and metadata, plus a preview/
  apply local-workspaces API using claimed-old-path rules and a plan digest.
- Live relocation invalidates every path-bound runtime/cache before rebuilding.
- Unit tests for graph topology, unsafe ids, symlink/containment rejection,
  collisions, source activity, concurrent adoption, partial crashes, linked
  files, source immutability, preview/apply TOCTOU, and live relocation.

**Blocked by:** Slice 1 and owner confirmation of the workspaces-mode product
boundary.

**Proof:** Helper/registry tests with source and canonical digests.

**Review budget:** Inside if kept as a dedicated storage slice; split codec and
CLI adoption into stacked PRs if production additions approach 1,500 lines.

### Slice 3: Workspaces-mode cutover, public proof, and operations docs

**Delivers:**

- Promise-cached adoption before chat activation.
- `getSessionNamespace` returns the canonical v2 namespace.
- Public dual-route restart/relocation/adoption/isolation/rollback tests.
- Folder-mode regression proof.
- CLI/deployment/troubleshooting docs for durable configuration, relocation,
  diagnostics, terminal-Pi tradeoff, rollback staleness, and explicit recovery
  when registry/source mapping is unavailable.

**Blocked by:** Slice 2.

**Proof:** CLI and Agent tests/typechecks, invariant lint, and manual affected-
host id comparison.

**Review budget:** Inside.

## Out of Scope

- Guessing ownership of arbitrary old-path directories.
- A general multi-root `PiSessionStore`.
- Symlinks, hard links, dual writes, or background filesystem watchers.
- Permanent live bidirectional workspaces-mode sharing with terminal Pi.
- Deleting legacy source directories.
- Recovering bytes destroyed with an ephemeral filesystem.
- Global redesign of workspace ids; relocation preserves an existing id.
- Changes to #968/#775 live-channel identity, which does not own physical
  storage placement.

## Open Questions

1. **Owner approval required:** confirm that workspaces mode prioritizes durable
   continuity/isolation over permanent live terminal-Pi sharing.
2. Should the relocation API ship with a UI control now, or remain an API/CLI
   operation in this issue? Recommendation: API/CLI only; UI is a follow-up.
3. Should a graph-specific missing dependency block only that graph (recommended)
   or the entire workspace chat activation?

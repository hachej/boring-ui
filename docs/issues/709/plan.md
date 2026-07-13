# #709 — Native Pi session IDs with a private Boring metadata index

## Problem Statement

Boring currently creates a Pi-shaped wrapper JSONL in Pi's native session directory. The wrapper owns a Boring-visible UUID and stores `pi_session_file`, Boring workspace context, and (for an unmaterialized chat) the pending title. The linked native Pi JSONL owns the actual conversation.

This design causes a user-visible correctness failure. Standalone Pi scans every JSONL in its session directory and cannot understand Boring's `pi_session_file` convention, so `pi /resume` shows two sessions:

- a titled, empty Boring wrapper; and
- the native Pi transcript containing the conversation.

Manual #615 verification on 2026-07-13 reproduced this exactly for `New sessionrr`: the wrapper held the title and the native transcript held two messages but no `session_info` title.

## Solution

For **local direct Pi-backed sessions only**, make the native Pi session ID the durable Boring session ID and make the native Pi JSONL the only durable transcript/list record.

Replace Pi-visible wrappers with a Boring-private metadata index stored outside any Pi-scanned session directory. The index is an enhancement layer, not a second transcript or session-list authority.

```text
Pi native JSONL
  - native session id (also Boring session id)
  - title
  - conversation
  - Pi model/session state

Boring private metadata index
  - workspace/storage scope for local direct Boring UI state
  - pending title for an empty, unmaterialized native session
  - optional native-file hint/cache
  - legacy visible-id -> native-id migration alias
  - migration journal/status/tombstones
  - never a transcript; never visible to `pi /resume`
```

This plan is gated by **Slice 0** and its accepted compatibility artifact. Do not implement native-ID creation/migration until Slice 0 records and accepts the actual Pi SDK/package version used by `packages/agent`, the exact identity/title API or fallback, and real SDK + CLI proof that satisfies the acceptance below. Slices 1–5 are **forbidden** until that artifact is accepted; unresolved Pi support at planning time is intentional and must not be papered over with assumed APIs.

## User Stories / Scenarios

1. **Create, rename, then send**
   - User creates a Boring chat, renames it before the first message, clicks outside to save, sends a prompt, and receives a response.
   - Boring and standalone `pi /resume` show exactly one session with that title and transcript.

2. **Empty chat survives a Boring reload**
   - User creates and renames a chat but sends nothing, then reloads Boring.
   - Boring restores the empty pending chat/title from private metadata.
   - Standalone Pi shows no phantom empty session because Pi has not materialized a transcript.

3. **Restart before first assistant response**
   - The server restarts after a rename but before Pi materializes JSONL.
   - The next Pi session is recreated with the same native ID via a proven Pi API, receives the pending title through a proven Pi API, and materializes one titled native transcript exactly once.

4. **Existing wrapper-linked session**
   - A user has a historical wrapper plus linked native JSONL.
   - Migration resolves old Boring IDs to the native ID; native title wins, except a wrapper-only title is copied once through Pi's SDK/API if native has no title.
   - The legacy wrapper is moved out of Pi's scanned directory without deleting user data.

5. **Standalone Pi session**
   - A native Pi JSONL created by standalone Pi appears once in Boring's local direct session list when it satisfies native discovery admission rules.
   - Boring does not create a Pi-shaped wrapper merely to adopt/read it.

## Decisions

### 0. Compatibility gate: no assumed Pi ID/title API

Current dependency state is ambiguous enough to block implementation:

- root `package.json` overrides `@mariozechner/pi-coding-agent` to `@earendil-works/pi-coding-agent@0.80.3`;
- `packages/agent/package.json` still pins `@mariozechner/pi-coding-agent` to `@earendil-works/pi-coding-agent@0.75.5`;
- `pnpm-lock.yaml` currently resolves the root/importer to `0.80.3`, but the package pin still communicates the wrong support contract.

Slice 0 must prove the actual package imported by `packages/agent` in tests/builds and must record the supported API in a concrete compatibility artifact before any later slice starts.

Required Slice 0 recorded artifact:

```text
docs/issues/709/slice-0-compatibility.md
```

The artifact is the gate, not an optional note. It must contain this checklist with evidence links/commands and a final decision:

- [ ] **Exact package decision:** package name, resolved version, package manager/importer path, lockfile entry, and command output proving this is the version imported by `packages/agent` tests/builds.
- [ ] **Dependency reconciliation decision:** whether `packages/agent/package.json`, root overrides, and `pnpm-lock.yaml` are aligned to the proven version or the plan is blocked until an upgrade lands.
- [ ] **Native ID API decision:** exact SDK symbol/signature/code path that injects/recreates a native Pi session ID before materialization, or an explicitly rejected API with failure output.
- [ ] **Session ID observation decision:** exact SDK symbol/signature proving Boring can read the same native ID before and after materialization.
- [ ] **Title API decision:** exact SDK/CLI symbol or supported call sequence that writes a pending title exactly once across restart/materialization, or a rejected API with failure output.
- [ ] **Fallback decision:** if primary APIs do not exist, the exact fallback mechanics and proof that they preserve native ID + pending title across restart without product code manually fabricating a native transcript.
- [ ] **Real SDK proof:** test file/command/stdout using the real resolved Pi SDK imported by `packages/agent`; JSONL may be inspected after SDK writes but must not be manually fabricated as the proof act.
- [ ] **Real CLI proof:** command/stdout for `pi --session-dir "$nativeSessionDir" --resume` or `PI_CODING_AGENT_SESSION_DIR="$nativeSessionDir" pi --resume` against the same cwd/session directory used by the SDK proof.
- [ ] **Final gate decision:** exactly one of `supported-native-id`, `supported-fallback`, or `blocked-no-support`, with reviewer/owner acceptance recorded.

Candidate APIs to verify, not assume:

- `SessionManager.create(cwd, sessionDir, { id })` / `SessionManager.inMemory(cwd, { id })` or equivalent for native ID injection/recreation;
- `SessionManager.getSessionId()` before transcript materialization;
- Pi-supported title write (`appendSessionInfo`, `AgentSession.setSessionName`, CLI `--name`, or another documented SDK surface) that works before and after restart;
- Pi CLI `--session-id <id>` and `--session-dir <dir>` behavior against the same directory.

Allowed Slice 0 outputs:

1. **`supported-native-id`:** align the package dependency to the proven exact version/API, attach real SDK + CLI proof, accept the artifact, and only then permit Slices 1+.
2. **`supported-fallback`:** document and test the exact fallback that still preserves the same native ID and pending title across restart without manually fabricating a native transcript, accept the artifact, and only then permit Slices 1+.
3. **`blocked-no-support`:** stop; mark Slices 1+ blocked and either upgrade Pi deliberately or change product requirements in a new plan revision.

Until the artifact exists and is accepted, Slices 1–5 are not merely blocked; they are forbidden to start.

### 1. Native Pi ID is the local direct Pi public session ID

After Slice 0 proves support, local direct Pi-backed mode uses:

```text
BoringSessionId === PiSessionManager.getSessionId() === native JSONL header.id
```

This replaces the current documented decision that a Boring wrapper UUID is canonical for Pi-backed local UI state. It does not change generic non-Pi harness IDs.

### 2. Native JSONL is the local direct session-list and title authority

- Boring lists/summarizes native Pi JSONLs directly.
- Native `session_info` is authoritative after materialization.
- Boring never writes a Pi-shaped wrapper JSONL into a Pi session directory in native mode.
- Boring does not parse wrapper titles as durable titles after migration except as a one-time migration input when native has no title.

### 3. Private metadata index is not a second session store

The index may hold only Boring-specific metadata. It must not duplicate messages, Pi model state, or a durable post-materialization title.

Proposed v1 record:

```ts
type PiSessionIdentityMode =
  | "native-local"
  | "legacy-wrapper"
  | "legacy-alias-migrated"

type PiSessionLifecycleState =
  | "pending"
  | "materialized"
  | "migrating"
  | "deleted"
  | "conflict"

interface PiSessionMetadataV1 {
  version: 1
  nativeSessionId: string
  identityMode: PiSessionIdentityMode
  lifecycleState: PiSessionLifecycleState
  workspaceId: string
  storageScope: string
  userId?: string
  /** Hint only. Native header/session id remains authoritative. */
  nativeFileHint?: string
  pending?: {
    title?: string
    createdAt: string
  }
  /** Temporary migration compatibility only. */
  legacyVisibleSessionIds?: string[]
  deletedAt?: string
  backupRef?: string
  migration?: {
    journalId?: string
    phase?: string
    sourceWrapperPath?: string
    wrapperSha256?: string
  }
  createdAt: string
  updatedAt: string
}
```

After native materialization, `pending` is removed. The record may remain for local scope, alias resolution, migration state, and host-specific metadata.

### 4. Exact standalone Pi shared-directory contract

Local direct Boring and standalone Pi must be pointed at the **same native Pi session directory** and **same runtime cwd** for comparison/adoption.

Boring local direct contract:

```text
nativeSessionDir = PiSessionStore.getSessionDir()
runtimeCwd       = createHarness runtime cwd passed to Pi SessionManager
metadataRoot     = outside nativeSessionDir, never a descendant
```

Standalone Pi proof command must use one of these equivalent configurations:

```bash
# Preferred explicit proof: no hidden config assumptions.
cd "$runtimeCwd"
pi --session-dir "$nativeSessionDir" --resume

# Equivalent env proof.
cd "$runtimeCwd"
PI_CODING_AGENT_SESSION_DIR="$nativeSessionDir" pi --resume
```

Do not claim standalone proof from Boring's filtered list. The proof must run the real Pi CLI session selector against the exact directory Boring wrote.

Boring's `BORING_AGENT_SESSION_ROOT` is not a Pi CLI variable. If Boring uses `BORING_AGENT_SESSION_ROOT`, the implementation/proof must resolve it to the actual per-cwd/per-namespace `nativeSessionDir` and pass that exact path to standalone Pi via `--session-dir` or `PI_CODING_AGENT_SESSION_DIR`.

### 5. Metadata location is outside Pi scanning

Add an explicit metadata root:

```text
BORING_AGENT_SESSION_METADATA_ROOT
```

Default it to a sibling of the configured Boring session root, never a child of a cwd-specific Pi session directory:

```text
<session-root>/../pi-session-metadata/v1/
```

Examples:

```text
~/.pi/agent/boring-session-metadata/v1/
/data/pi-session-metadata/v1/
```

Metadata files use a Boring-private format such as `<native-id>.json`, not `.jsonl`.

### 6. Empty chats are a Boring-only pending state

Pi intentionally defers transcript creation. Boring may preserve an empty chat across reload with the private `pending` metadata record, but it must not manufacture a Pi session JSONL to do so.

If product policy later chooses to discard unsent empty chats on reload, the index can omit these records. This plan retains current Boring behavior for compatibility.

### 7. Scope differs by runtime mode; first migration is local direct only

- **In scope for first migration:** local trusted direct Pi adapter using a file-backed native Pi session directory and private local metadata index.
- **Out of scope for first migration:** hosted/multi-user Pi. Hosted cannot use a local metadata index as an authorization source and cannot opt into native discovery until it has a separately complete, durable, host-owned adapter.
- **Hosted requirement before opt-in:** inject a durable metadata/session adapter that enforces workspace/user auth at the host layer, records aliases/tombstones in host storage, and proves restart/runtime replacement behavior. Hosted native-ID opt-in is a separate slice after local direct migration is proven.
- **Non-Pi harnesses:** retain the generic `SessionStore` contract. This migration is isolated to Pi-backed adapters and must not leak Pi imports/IDs into generic workspace shared code.

## Flag / Abstraction

- **Needed?:** Yes, for reversible migration and mixed-version deployment.
- **Path:** `PiSessionIdentityMode = "wrapper-legacy" | "native-local"`, selected by adapter composition/configuration and persisted per session in metadata where possible.
- **Deployment mode:** every upgraded server must be able to read both legacy wrappers and native-local sessions before any wrapper is moved out of Pi's scanned directory.
- **Rollback:** rollback target is the upgraded compatible code with `native-local` creation disabled for new sessions if needed. Do **not** roll back to a wrapper-only binary after wrapper moves begin. Do **not** recreate legacy wrappers for native or migrated sessions.

The flag is migration scaffolding, not a permanent user-facing setting. Remove `wrapper-legacy` only after migration telemetry/proof, alias retention, and rollback-window acceptance.

### Wrapper-move deployment readiness/capability fence

Before **ANY** legacy wrapper file is moved out of Pi's scanned session directory, the deployment must pass and record this fence:

- [ ] **All writers current:** every process that can create, rename, delete, migrate, alias-resolve, or persist session IDs is running the compatible expanded build. This includes web/API workers, Pi chat workers, migration jobs, plugin/ask-user writers, metering/credits writers, workspace bridge writers, and queue/delegate workers.
- [ ] **No old wrapper-only writer remains:** health/deployment inventory proves no running binary can recreate a Pi-visible wrapper or write a stale wrapper ID as canonical after a move.
- [ ] **Metadata root available and locked:** `BORING_AGENT_SESSION_METADATA_ROOT` resolves outside the native Pi session directory, is writable/fsync-capable, has successful atomic-write smoke proof, and the root migration lock plus per-wrapper/per-native locks are available.
- [ ] **Native-mode read path proven in this deploy:** current code can list/load/rename/delete native-local sessions and resolve pending metadata in the target environment before migration starts.
- [ ] **Alias read path proven in this deploy:** old wrapper IDs resolve to canonical native IDs at every API boundary in the target environment before migration starts.
- [ ] **Rollback target confirmed:** rollback is the same compatible expanded build with migration/native creation disabled, never a pre-migration wrapper-only binary.

If any fence item is missing or stale, migration must enter **legacy read-only/no-move** mode: wrappers remain in place, no wrapper backup/move runs, no alias-expiring write is allowed, and legacy sessions may only be read/resumed through the compatibility path until the fence is green.

## Architecture / Data Flow

### New local direct session

1. Boring requests a new Pi-backed chat.
2. Native identity is selected only through the Slice 0-proven Pi API/fallback.
3. Boring returns that native ID as `sessionId` to UI and creates optional private pending metadata.
4. Rename validates once, queues the title through the Slice 0-proven Pi title API for the exact native session, and updates private pending title only while no native transcript exists.
5. Pi writes/materializes the first native JSONL through its SDK/runtime. Boring resolves it by native ID, removes `pending`, and lists the native transcript.

No `pi_session_file` record is created.

### Resume/restart

1. API receives a native ID or legacy alias.
2. API boundary resolves aliases to canonical native ID before touching live caches, event streams, ask-user, metering, or stores.
3. If materialized, native transcript lookup uses Pi's session directory and header ID/file naming.
4. If unmaterialized, metadata provides pending title and the manager is recreated with the same native ID through the proven Pi API/fallback.
5. Native title/transcript win after materialization; pending metadata is removed exactly once.

### Native session discovery admission/auth rules

Local direct Boring may discover standalone Pi sessions only when all rules pass:

1. File is a regular `.jsonl` under the configured `nativeSessionDir` after realpath/path-bound validation; no symlink escape.
2. Prefix parses as a Pi `type: "session"` header with a safe string `id` and supported/migratable Pi session version.
3. File does not contain the explicit legacy wrapper marker (`type: "pi_session_file"`) in its prefix.
4. Header ID is canonical. Filename is only a hint; duplicate header IDs are a stable conflict and neither duplicate is auto-adopted.
5. Header cwd must match the adapter `runtimeCwd` for normal local direct discovery. If a future local mode wants cross-cwd adoption from a shared `--session-dir`, it must be a separately flagged policy with proof.
6. If metadata exists for the native ID, requested `workspaceId`/`storageScope`/`userId` must match it.
7. If no metadata exists, local direct trusted mode may list the native session only for the adapter's configured local workspace/storage scope; hosted mode must reject it until a host-owned metadata record exists.
8. Discovery never creates wrappers. It may create/update private metadata only after Boring explicitly opens/adopts the native session and only in local direct mode.

## Legacy Migration

### Preconditions

- The wrapper-move deployment readiness/capability fence must be green immediately before each migration batch and before each individual wrapper move. If it is not green, stop in legacy read-only/no-move mode.
- Never delete user sessions during migration.
- Migration must be idempotent and crash-safe.
- Preserve an original legacy wrapper in a non-Pi-scanned backup location until an explicit retention policy permits removal.
- All running deploys must understand aliases before wrapper moves begin.

### Crash-safe journal, lock, and recovery

Use a metadata-root journal and lock for index writes, wrapper backup moves, and alias activation.

Required mechanics:

1. Acquire a per-native-ID lock plus a per-wrapper lock before migrating. Lock files live under metadata root, include pid/host/timestamp, and have stale-lock recovery based on process liveness/mtime.
2. Write a journal file before side effects:

```text
<metadata-root>/journals/<native-id>.<old-visible-id>.json
```

Journal fields include phase, source wrapper path, target backup path, native path/header ID, wrapper hash/size/mtime, previous metadata hash, and timestamps.

3. Index writes are atomic: write temp file in the same directory, fsync file, rename, fsync directory. Partial/temp files are ignored except by recovery.
4. Backup move is crash-safe:
   - if source and backup are on the same filesystem, `rename(source, backupTmp)` then `rename(backupTmp, backup)` with fsyncs;
   - if cross-device, copy to `backupTmp`, fsync, verify size/hash, rename to `backup`, fsync, then unlink the original only after journal records `backup_committed`.
5. Alias must be committed before or with the backup phase so either old ID resolves or the old wrapper still exists. Crash after alias-before-move may temporarily leave Pi duplicate visibility; recovery must finish the move. Crash after move-before-complete must still resolve old ID through the alias.
6. Recovery on startup scans journals and completes or marks `conflict`/`recoverable` without guessing. It must never manufacture a replacement native transcript.
7. Every migration phase is idempotent; retrying after interruption yields one native transcript, one backup, and one alias set.

### Per-wrapper procedure

1. Detect a legacy JSONL by `type: "pi_session_file"` plus a Boring header/context.
2. Read linked native file and native header ID.
3. Create/update private metadata keyed by native ID:
   - set `identityMode: "legacy-alias-migrated"` and `lifecycleState: "migrating"` while moving;
   - add wrapper ID to `legacyVisibleSessionIds`;
   - carry Boring scope;
   - carry `pending.title` only when native is absent/unmaterialized;
   - if native exists and lacks `session_info` while wrapper has a real title, append that title once through the proven Pi SDK/API, not a raw JSONL write.
4. Move the wrapper to metadata-root legacy backup, e.g.:

```text
<metadata-root>/legacy-wrappers/<old-visible-id>.jsonl
```

5. Mark metadata `lifecycleState: "materialized"` or `"pending"` and journal complete.
6. Rewrite local UI active-session storage and route/session aliases from old wrapper ID to native ID where possible; resolve aliases at every API boundary during the transition.
7. Verify Pi's cwd session directory contains only the native transcript afterward.

### Collision/conflict policy

- Native session title wins when present.
- Wrapper-only real title is a one-time migration candidate.
- Multiple wrappers pointing to one native ID merge aliases only when scopes are compatible.
- Scope conflicts become stable migration conflicts; do not guess.
- A missing/corrupt native target preserves wrapper backup/source and yields an explicit recoverable migration state; do not manufacture a replacement transcript.

## Durable/raw session-ID consumer inventory

Implementation must audit and update every durable/raw consumer below. Each store/cache needs an alias migration test: old wrapper ID resolves to canonical native ID, canonical writes use native ID, and no component recreates a wrapper.

### Server/session stores

- `packages/agent/src/server/harness/pi-coding-agent/sessions.ts`
  - `list`, `create`, `load`, `rename`, `recordLivePendingTitle`, `loadEntries`, `delete`;
  - `resolveSessionFile`, `loadPiSessionFileSync`, `loadPiSessionFile`, `savePiSessionFile`, wrapper discovery/creation paths, prefix cache, append-in-flight locks.
- `packages/agent/src/server/harness/pi-coding-agent/createHarness.ts`
  - `sessionCacheKey`, `piSessions` live handle map, `getOrCreatePiSession`, `disposePiSession`, `hasPiSession`, `renameLivePendingPiSession`, delete override.
- `packages/agent/src/server/pi-chat/harnessPiChatService.ts`
  - channel map, channel creation promises, replay buffers, message metadata reconciler, active prompt runs, synthetic prompt failures, persisted-state load, delete teardown.
- `packages/agent/src/server/pi-chat/metering.ts`
  - public session IDs, state keys, prompt/follow-up run IDs, reservation/settlement references.
- `packages/agent/src/server/events/eventStreamStore.ts` and `packages/agent/src/shared/events.ts`
  - `sessionStreamPath(sessionKey/sessionId)`, stream meta, idempotency keys, latest seq reads.
- `packages/agent/src/server/http/sessionChangesTracker.ts` and its route/tests
  - raw session-ID change cursors, invalidation/replay keys, and client-facing change notifications.
  - Required alias regression: an old wrapper ID and canonical native ID share one change stream/cursor and cannot produce duplicate or missed list updates.
- `packages/agent/src/core/createAgent.ts`
  - session context cache, send locks, stream paths, access checks.
- HTTP routes in `packages/agent/src/server/http/routes/piChat.ts` and command routes/hooks that accept `:sessionId`, `activeSessionId`, or `x-boring-storage-scope`.

### Frontend/session UI

- `packages/agent/src/front/chat/session/activeSessionStorage.ts`
  - `boring-agent:v2:<scope>:activeSessionId` localStorage.
- `packages/agent/src/front/chat/session/usePiSessions.ts`
  - `pendingCreatedRef`, active-session resolution, switch/rename/delete URLs, include-active query.
- `packages/agent/src/front/chat/PiChatPanel.tsx`
  - external `sessionId`, local submitted session refs, composer blockers, auto-submit guards.
- `packages/agent/src/front/DebugDrawer.tsx` and `packages/agent/src/front/__tests__/DebugDrawer.test.tsx`
  - `sessionId` prop, session/system-prompt route fetches, selected tab/retry state, and debug values that are effectively session-keyed UI state.
  - Required alias regression: rendering DebugDrawer with an old wrapper ID must either canonicalize before fetching or hit alias-aware routes that return the canonical native session; tab/retry/system-prompt state must not leak across alias resolution or trigger wrapper recreation.
- `packages/agent/src/front/chat/pi/remotePiSession.ts`, `piChatReducer.ts`, `piChatStore.ts`, `piChatStream.ts`, `piFollowUpQueueController.ts`
  - remote URLs, snapshots, optimistic outbox, queued follow-ups, pending tool calls, client seq/nonces, reconnect state.
- `packages/agent/src/front/chat/session/composerPolicy.ts`
  - in-memory guards keyed by session ID; scoped composer settings are scope-keyed and should not be alias-migrated unless a future per-session draft store exists.
- Workspace shell/session panes in `packages/workspace/src/front/**`
  - open chat pane IDs, pinned/open session IDs, detached chat, attention badges, drag/drop session IDs, project session open callbacks.

### Plugin/host consumers

- `plugins/ask-user/src/server/askUserStore.ts`, `askUserStatePublisher.ts`, `askUserRuntime.ts`, front runtime/provider/inbox files:
  - `pendingBySession`, `transcriptsBySession`, question `sessionId`, answer `sessionId`, hints/blockers/inbox artifact params.
  - Required test: pending question created under old wrapper ID remains visible/answerable after migration through native ID; answer/cancel clears both alias/native projections exactly once.
- Workspace bridge/auth/idempotency/runtime token files under `packages/workspace/src/**/workspaceBridge/**`:
  - token `sessionId`, resource scope, idempotency records, runtime env `BORING_AGENT_SESSION_ID`, session owner mapping.
- Core credits/metering stores under `packages/core/src/server/credits/**` and schema/telemetry:
  - reservation rows, metering rows, telemetry properties, Stripe/session metadata references.
- First-party plugins that create or act on chat sessions, including `plugins/ccusage-dashboard`, `plugins/github-pr-tracker`, and `plugins/boring-mcp`:
  - created session IDs, prompt URLs, actor resolution, plugin-origin task/session references.
- Task/delegate/work queues that persist or display session references, including managed-agent MCP delegate state if any durable session binding is introduced before this migration lands.

Per-store migration requirement: each durable store either (a) rewrites old IDs to native IDs in a tested migration, or (b) keeps an alias-aware read path plus a tested contract for when aliases expire. Raw in-memory maps must canonicalize at ingress and be cleared/remapped on delete.

## Mixed-version deployment and rollback

1. **Phase A — expand/read both:** ship alias resolver, private metadata adapter, and native discovery read path. New-session creation remains legacy unless Slice 0 is green. No wrapper moves yet.
2. **Phase B — native new sessions local direct:** enable `native-local` only for new local direct sessions. Legacy sessions continue to resolve by wrapper ID/native alias. Hosted remains off.
3. **Phase C — migrate legacy wrappers:** only after the wrapper-move deployment readiness/capability fence is green: all running writers are current, metadata root/locks are available, native-mode read path is proven, alias read path is proven, and rollback targets are compatible. If the fence is not green, stay legacy read-only/no-move. Old wrapper-only binaries are no longer valid rollback targets.
4. **Phase D — contract:** after retention/telemetry, remove wrapper creation and then legacy read paths.

Rollback at any phase uses the latest compatible code with feature flags disabled, not pre-migration wrapper-only code. Rollback must not recreate wrappers for native sessions or migrated aliases. If native creation must be disabled, existing native sessions remain readable/deletable through native ID and aliases.

## Delete semantics

Delete is an explicit user action and is separate from migration backup retention.

- **Native materialized session:** resolve alias to canonical native ID, abort/dispose live handles, close/release event/metering/ask-user state, delete or host-trash the native Pi transcript according to the existing explicit-delete policy, delete metadata or mark `deleted` tombstone, and remove active/open UI references.
- **Pending-only native session:** remove pending metadata/tombstone it; no Pi file exists and none is created.
- **Legacy alias:** resolve to native ID first, then apply native semantics. Remove the alias from active resolution or mark it deleted so old wrapper IDs return stable not-found after delete.
- **Migration backup:** backup files are not Pi-visible and are not restored automatically. If the canonical session is explicitly deleted, mark `backupRef` deleted/delete-eligible; physical removal waits for the retention policy/user recovery decision.
- **Recoverable conflict/missing-native state:** delete via either old or native ID hides the session and tombstones aliases, but preserves backup/source artifacts until retention policy says otherwise.
- **Hosted future adapter:** delete must be host-transactional across host metadata/session stores and must not rely on local file tombstones.

## Test Seams

### Highest public seams

- Authenticated Pi session create/list/load/rename/restart/delete routes.
- Real Pi SDK session manager/session APIs proven by Slice 0.
- Standalone `pi --session-dir "$nativeSessionDir" --resume` manual proof against the same cwd and directory.
- Workspace front active-session/open-pane/session-switching seam.
- Ask-user pending question and workspace attention/inbox seam.

### Existing prior art

- Pi `SessionManager` behavior in the resolved installed SDK, after Slice 0 proves it.
- Existing `PiSessionStore` native title/header parsing and pending-title tests.
- Existing session identity documentation and restart tests.
- File-store atomic-write patterns in Tasks/Automation/AskUser stores, adapted with explicit journal+lock recovery.

### Avoid testing

- Do not mock a Pi wrapper and call that proof of standalone `pi /resume` behavior.
- Do not test only Boring's filtered list; the regression is specifically Pi's independent scanner.
- Do not manually write native Pi JSONL in product code to force early materialization.
- Do not fabricate native transcripts in tests that claim to prove Pi SDK integration; SDK tests must use the real resolved Pi SDK/CLI.

## Acceptance

### Slice 0 gate

- [ ] Create and accept `docs/issues/709/slice-0-compatibility.md` with the required checklist, evidence, and final gate decision.
- [ ] Record actual resolved Pi package version used by `packages/agent` tests/builds and reconcile package pin/override ambiguity.
- [ ] Prove or reject native ID injection/recreation before materialization through the real resolved Pi SDK.
- [ ] Prove or reject pending title application/restart exactly-once through the real resolved Pi SDK.
- [ ] Prove standalone Pi CLI can resume/list the same native directory via `--session-dir` or `PI_CODING_AGENT_SESSION_DIR`.
- [ ] Record one explicit output: `supported-native-id`, `supported-fallback`, or `blocked-no-support`.
- [ ] Until the artifact is accepted with `supported-native-id` or `supported-fallback`, Slices 1–5 remain forbidden and the plan state stays `needs-info`/blocked for implementation beyond Slice 0.

### Native local direct behavior

- [ ] New local direct Pi session uses one native ID for Boring route/UI state and Pi header/transcript.
- [ ] Boring creates no `.jsonl` wrapper or `pi_session_file` marker in Pi's scanned session directory in native mode.
- [ ] Rename before first turn persists as exactly one native `session_info` after materialization.
- [ ] Standalone `pi --session-dir "$nativeSessionDir" --resume` shows one session, with the Boring title and transcript.
- [ ] Empty renamed Boring chat survives Boring reload through private metadata but never appears as a phantom Pi session.
- [ ] Restart before native materialization preserves native ID and pending title.
- [ ] Native discovery admits only authorized/local direct sessions per the admission rules and never creates wrappers.
- [ ] Hosted remains off until a separately complete host-owned adapter lands.

### Migration/compatibility behavior

- [ ] Existing wrapper-linked sessions migrate idempotently without migration-time user-data deletion; wrapper files are moved to private legacy backup outside Pi scanning.
- [ ] No wrapper move can run unless the deployment readiness/capability fence is recorded green; if not green, legacy read-only/no-move behavior is enforced.
- [ ] Migration journal/lock recovery covers interruption before alias, after alias before move, after move before complete, and stale locks.
- [ ] Active session persistence, open panes, DebugDrawer session-keyed state, event streams, queued work, metering, tool context, pending questions/ask-user, attention/inbox, workspace bridge tokens/idempotency, and credits/telemetry resolve aliases/native IDs correctly during migration.
- [ ] Mixed-version deployment supports per-session modes and rollback to compatible code without legacy wrapper recreation.
- [ ] Delete semantics are implemented/tested for native, pending-only, legacy alias, backup, and conflict states.
- [ ] Generic non-Pi harness consumers remain Pi-agnostic.

## Proof

### Automated

Slice 0 proof commands must be added first and their results recorded in `docs/issues/709/slice-0-compatibility.md`. Minimum shape:

```bash
pnpm --filter @hachej/boring-agent test -- --run \
  src/server/harness/pi-coding-agent/__tests__/piSdkCompatibility.test.ts
pnpm --filter @hachej/boring-agent typecheck
cd "$runtimeCwd"
pi --session-dir "$nativeSessionDir" --resume
```

The Slice 0 compatibility test must import the same `@mariozechner/pi-coding-agent` package that `packages/agent` uses and exercise the real SDK. It may inspect JSONL after the SDK writes it, but it must not fabricate a native transcript as the act being tested. The CLI proof must run the real Pi CLI against the same cwd and native session directory; Boring's filtered list is not sufficient.

Regression suite after implementation:

```bash
pnpm --filter @hachej/boring-agent test -- --run \
  src/server/harness/pi-coding-agent/__tests__/createHarness.test.ts \
  src/server/harness/pi-coding-agent/__tests__/sessions.test.ts \
  src/server/pi-chat/__tests__/harnessPiChatService.test.ts \
  src/server/pi-chat/__tests__/piSessionIdentity.test.ts
pnpm --filter @hachej/boring-agent typecheck
bash scripts/check-invariants.sh packages/agent
```

Add targeted tests for:

- resolved Pi SDK version/API gate and accepted Slice 0 compatibility artifact;
- wrapper-move deployment readiness/capability fence, including legacy read-only/no-move when the fence is red;
- same native ID before/after materialization;
- native title exactly once after rename-before-send and restart-before-materialization;
- no wrapper JSONL created for a new Boring session;
- exact standalone directory contract helper/diagnostic;
- native discovery admission/auth/conflict rules;
- pending metadata restart hydration;
- crash-safe journal/idempotency/recovery phases;
- alias resolution for every consumer in the inventory, including ask-user pending/answer/cancel and DebugDrawer session-keyed state/system-prompt fetches;
- mixed-mode deployment/rollback with no wrapper recreation;
- delete semantics for native, pending, alias, backup, conflict;
- hosted adapter injection remains required/off.

### Manual proof (required)

For a clean temporary Pi native session directory and the same cwd:

1. Start Boring local direct with a known `nativeSessionDir` and metadata root outside it.
2. Create Boring chat, rename it, click outside to save, send a prompt, await reply.
3. Run:

```bash
cd "$runtimeCwd"
pi --session-dir "$nativeSessionDir" --resume
```

4. Assert one entry only, with the chosen title and transcript.
5. Create/rename an empty Boring chat, reload Boring, assert its pending title remains.
6. Run the same standalone Pi command; assert no empty phantom entry exists.
7. Restart Boring before first response and repeat the title/materialization check; inspect that native `session_info` appears exactly once.
8. Run migration on a copied wrapper/native fixture; interrupt at each journal phase in separate runs; assert recovery leaves no JSONL wrapper in the Pi session directory and aliases still resolve.
9. Create an ask-user pending question on a legacy session fixture, migrate, then answer/cancel from the native session UI and assert one cleared pending state.
10. Delete native, pending-only, alias, and migrated sessions; assert Boring and standalone Pi visibility match delete semantics.

## Slices

### Slice 0: Pi SDK compatibility and shared-directory spike

**Delivers:** A small compatibility harness plus the accepted `docs/issues/709/slice-0-compatibility.md` artifact proving the actual resolved Pi package version, exact native ID injection/recreation API or exact supported fallback, exact title API/call sequence, pending title restart exactly-once behavior, and standalone CLI shared-directory contract. Reconciles the `0.75.5` package pin vs `0.80.3` root override by either aligning the dependency or explicitly blocking native-ID work.

**Blocked by:** None.

**Proof:** Real SDK tests plus a clean temp `pi --session-dir "$nativeSessionDir" --resume` manual check, both recorded in the Slice 0 artifact. No product behavior changes beyond tests/docs/package metadata if required by the spike.

**Exit rule:** Slices 1–5 are forbidden until the Slice 0 artifact is accepted with `supported-native-id` or `supported-fallback`. If the artifact records `blocked-no-support`, implementation stops and this plan returns to `needs-info`/blocked instead of starting Slice 1.

**Review budget:** Inside. This is a bounded compatibility spike and gate.

### Slice 1: Native-ID creation and private pending metadata (local direct only)

**Delivers:** New local direct chats use native Pi IDs; private metadata handles empty/pending title/restart; no new wrappers are created; hosted remains off.

**Blocked by:** Slice 0 supported native-ID path or supported fallback.

**Proof:** Unit/service tests plus clean-root manual Boring + `pi --session-dir "$nativeSessionDir" --resume` test.

**Review budget:** High. This changes identity at route/harness/UI seams.

### Slice 2: Native-only list/load/rename/delete and native discovery admission

**Delivers:** Boring lists/loads native transcripts directly, enforces native discovery admission/auth rules, handles native/pending delete semantics, and removes new-code reliance on `pi_session_file` for native mode.

**Blocked by:** Slice 1.

**Proof:** Browser/session switch/restart/delete tests; title/transcript/delete parity with standalone Pi; discovery conflict/auth tests.

**Review budget:** High. Cross-layer migration and local security boundary.

### Slice 3: Consumer alias migration inventory

**Delivers:** API-boundary canonicalization and per-store migration/alias tests for all durable/raw consumers: front active/open panes, DebugDrawer session-keyed state/system-prompt fetches, event streams, metering, core send locks/context, workspace bridge tokens/idempotency, credits/telemetry, ask-user, attention/inbox, and pending tool/follow-up state.

**Blocked by:** Slice 2.

**Proof:** Per-store tests proving old ID resolves to native ID, canonical writes use native ID, and aliases can expire without data loss.

**Review budget:** High. Broad compatibility and data integrity.

### Slice 4: Legacy wrapper migration with crash-safe journal/backup

**Delivers:** Existing wrapper-linked sessions migrate safely to private backup/index, wrapper IDs resolve to native IDs during retention, and no migrated wrapper remains visible to Pi. Includes journal/lock/recovery implementation and the wrapper-move deployment readiness/capability fence.

**Blocked by:** Slice 3 plus a green wrapper-move fence: all running writers current, metadata root/locks available, native-mode read path proven, alias read path proven, and compatible rollback confirmed. If the fence is red, Slice 4 may only enforce legacy read-only/no-move.

**Proof:** Fixture migration tests, idempotency/interruption/stale-lock tests, copied-data manual standalone Pi verification.

**Review budget:** High. User-data migration; requires rollback/retention review.

### Slice 5: Hosted metadata adapter and final cleanup

**Delivers:** Hosted composition injects a durable metadata adapter with host-owned workspace/user scope; hosted native-ID opt-in only after complete adapter proof. Remove legacy-wrapper creation/read paths after retention decision.

**Blocked by:** Slices 1–4 and hosted persistence/authorization architecture availability.

**Proof:** Hosted integration tests for scope/restart/runtime replacement/migration adapter behavior; local index rejected as hosted auth source.

**Review budget:** High. Authorization and persistence.

## Wide Refactor Strategy

**Expand → migrate batches → contract**

1. Expand with Slice 0 compatibility proof and read-both alias scaffolding.
2. Enable native-ID path for new local direct sessions only; no new wrappers.
3. Audit/migrate every raw session-ID consumer and prove alias behavior.
4. Migrate legacy wrapper/native pairs in idempotent batches with private backup and journal recovery.
5. Contract by removing legacy JSONL wrapper writes and then legacy reads after retention/telemetry acceptance.

## Out of Scope

- Upstream Pi format changes or a Pi CLI patch to hide Boring wrappers.
- Copying Boring UI metadata into native Pi JSONL.
- Manually fabricating native Pi JSONL transcripts in product code.
- Hosted/multi-user native-ID opt-in before a complete host-owned adapter.
- A generic DB/index framework beyond the small metadata adapter required here.
- Changing non-Pi harness public IDs.
- Automatic physical deletion of legacy backup data outside explicit delete/retention policy.

## Open Questions

1. Should an empty unsent chat survive Boring reload indefinitely, or expire after a bounded period? This plan preserves it for compatibility.
2. What retention period and user-visible recovery path should apply to moved legacy wrapper backups?
3. For explicit user delete, should native JSONL be hard-deleted as today or moved to a recoverable trash first?
4. Which host-owned store should hosted native metadata use when Slice 5 starts?
5. How long must aliases remain after all known front clients and plugin stores migrate?

## State

`ready-for-agent` for **Slice 0 only**. Slices 1–5 are forbidden until Slice 0 records and accepts `docs/issues/709/slice-0-compatibility.md` with a tested supported Pi SDK API/fallback, real SDK + CLI proof, and a resolved package pin/override decision. If Slice 0 cannot prove support, this plan must return to `needs-info` rather than implementing native-ID behavior.

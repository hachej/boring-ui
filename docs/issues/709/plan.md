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
  - optional native-file hint/cache
  - legacy visible-id -> native-id migration alias
  - legacy wrapper-no-native quarantine metadata
  - migration journal/status/tombstones
  - never a transcript; never visible to `pi /resume`
```

This plan is gated by **Slice 0** and its accepted compatibility artifact. Do not implement native-ID creation/migration until Slice 0 records and accepts the actual Pi SDK/package version used by `packages/agent`, the exact identity/title API or fallback, and real SDK + CLI proof that satisfies the acceptance below. Slices 1+ are **forbidden** until that artifact is accepted; unresolved Pi support at planning time is intentional and must not be papered over with assumed APIs.

## User Stories / Scenarios

1. **Create, send, then rename**
   - User creates a Boring chat. Before a native Pi transcript exists, the existing rename control is hidden.
   - User sends a prompt and receives the first assistant response. The native transcript has now materialized, so the existing rename control appears.
   - User renames the materialized session. Boring and standalone `pi /resume` show exactly one session with that title and transcript.

2. **Empty unsent chat is not durable**
   - User creates a Boring chat but sends nothing.
   - The chat is not renameable, is not restored as a durable session after reload/restart, and never appears as a phantom Pi session.

3. **Existing wrapper-linked session**
   - A user has a historical wrapper plus linked native JSONL.
   - Migration resolves old Boring IDs to the native ID; native title wins, except a wrapper-only title is copied once through Pi's SDK/API if native has no title.
   - The legacy wrapper is moved out of Pi's scanned directory without deleting user data.

4. **Standalone Pi session**
   - A native Pi JSONL created by standalone Pi appears once in Boring's local direct session list when it satisfies native discovery admission rules.
   - Boring does not create a Pi-shaped wrapper merely to adopt/read it.

5. **Existing wrapper-only pending session with no native target**
   - A historical wrapper has no trusted linked native file/header ID.
   - Migration records `legacy-wrapper-no-native` compatibility state, leaves it out of native alias migration/no-move, keeps it non-renameable, and waits for proven materialization or explicit deletion instead of inventing a native transcript.

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
- [ ] **Native ID API decision:** exact SDK symbol/signature/code path that creates/uses a caller-provided native Pi session ID at first send, or an explicitly rejected API with failure output.
- [ ] **Session ID observation decision:** exact SDK symbol/signature proving Boring can read the same native ID during first-send handling and after materialization.
- [ ] **Title API decision:** exact SDK/CLI symbol or supported call sequence that renames a materialized native transcript, or a rejected API with failure output. New empty unsent chats have no pending title behavior.
- [ ] **Fallback decision:** if primary APIs do not exist, the exact fallback mechanics and proof that they preserve native ID/session identity without product code manually fabricating a native transcript. Fallbacks must not introduce new-session pending-title persistence.
- [ ] **Real SDK proof:** test file/command/stdout using the real resolved Pi SDK imported by `packages/agent`; JSONL may be inspected after SDK writes but must not be manually fabricated as the proof act.
- [ ] **Real CLI proof:** command/stdout for `pi --session-dir "$nativeSessionDir" --resume` or `PI_CODING_AGENT_SESSION_DIR="$nativeSessionDir" pi --resume` against the same cwd/session directory used by the SDK proof.
- [ ] **Final gate decision:** exactly one of `supported-native-id`, `supported-fallback`, or `blocked-no-support`, with reviewer/owner acceptance recorded.

Candidate APIs to verify, not assume:

- `SessionManager.create(cwd, sessionDir, { id })` / `SessionManager.inMemory(cwd, { id })` or equivalent for caller-provided native ID creation/use at first send;
- native session creation/use with a caller-provided ID at first send, without product code fabricating a transcript;
- Pi-supported title write (`appendSessionInfo`, `AgentSession.setSessionName`, CLI `--name`, or another documented SDK surface) that works for materialized native transcripts;
- Pi CLI `--session-id <id>` and `--session-dir <dir>` behavior against the same directory.

Allowed Slice 0 outputs:

1. **`supported-native-id`:** align the package dependency to the proven exact version/API, attach real SDK + CLI proof, accept the artifact, and only then permit Slices 1+.
2. **`supported-fallback`:** document and test the exact fallback that still preserves native ID/session identity without manually fabricating a native transcript or introducing pending-title persistence for new empty chats, accept the artifact, and only then permit Slices 1+.
3. **`blocked-no-support`:** stop; mark Slices 1+ blocked and either upgrade Pi deliberately or change product requirements in a new plan revision.

Until the artifact exists and is accepted, Slices 1+ are not merely blocked; they are forbidden to start.

### 1. Native Pi ID is the local direct Pi public session ID

After Slice 0 proves support, local direct Pi-backed mode uses this identity for every materialized session:

```text
BoringSessionId === PiSessionManager.getSessionId() === native JSONL header.id
```

This replaces the current documented decision that a Boring wrapper UUID is canonical for Pi-backed local UI state. It does not change generic non-Pi harness IDs.

### 1a. Pre-send drafts are browser-memory only

Owner decision: an unsent draft exists exclusively in browser memory until the user presses Send. Boring must not create server draft authority or durable draft state.

For a new native-local chat before first send, the live tab may hold only:

```ts
interface BrowserOnlyUnsentChat {
  /** Random native-session-shaped ID selected for this tab only; not durable until first send succeeds/materializes. */
  temporaryNativeSessionId: string
  /** Random request key reused only for same-tab retry of the same first send. */
  requestId: string
}
```

Rules:

- The temporary native session ID and request ID live only in JS memory for the current tab/component lifetime.
- They must not be written to localStorage, sessionStorage, IndexedDB, URL/query params, active-session storage, private metadata, journals, backups, event streams, metering, ask-user, workspace bridge, plugin stores, logs intended as durable state, or Pi JSONL before Send.
- Opening, switching to, focusing, reloading, or restoring an empty new chat must not call the server to register a draft and must not allocate a Pi handle/channel/session.
- Browser reload, tab close, process restart, server restart, or runtime replacement discards the unsent draft. That outcome is intentional.

### 1b. First send creates or uses the native session directly

There is no `DraftRegistry`, signed or opaque draft token, `materialize-and-send` endpoint, durable first-send receipt/journal, pre-submit prompt-intent marker, or draft restart recovery state machine.

First prompt in native-local mode uses the normal prompt-send route shape under the client-held temporary native ID, for example:

```http
POST /api/v1/agent/pi-chat/:sessionId/prompt
Content-Type: application/json

{
  "requestId": "same-tab-first-send-request-id",
  "prompt": { /* existing prompt body */ }
}
```

where `:sessionId` is the tab's `temporaryNativeSessionId`. On receipt, the server:

1. derives `SessionCtx` from trusted local composition or hosted auth (never client scope fields);
2. validates the requested native session ID format and scope/admission rules;
3. if the native session already exists and is authorized, treats the request as a normal existing-session prompt with the existing idempotency/request handling;
4. if the native session does not exist, creates/uses a native Pi session with that exact ID through the Slice 0-proven Pi SDK/API/fallback and submits the prompt;
5. returns/streams the canonical native session ID once the native header/session is trusted.

Same-tab retry after a lost response reuses the same `temporaryNativeSessionId` and `requestId` while the tab is still live. A live server may use ordinary in-process/live-run idempotency to reconnect or avoid duplicate submission when it can prove the request is already active/accepted. Server auth and authorization checks still run on every retry.

No stronger guarantee is claimed. If the browser, tab, server, or Pi process restarts during first send, Boring intentionally treats the result as unknown rather than recovering from a durable first-send receipt. Safe UX is:

1. refresh/reload materialized chats from the native session list;
2. inspect whether the intended prompt/session materialized;
3. if not present or if the user deliberately wants to try again, send again explicitly with a new live request ID on the materialized session or a fresh in-memory new chat.

This plan makes no exactly-once claim for the first prompt across browser/server/Pi crash windows. It only retains normal existing-session idempotency after a session is materialized and the request is handled by the existing prompt infrastructure.

### 2. Native JSONL is the local direct session-list and title authority

- Boring lists/summarizes native Pi JSONLs directly.
- Native `session_info` is authoritative after materialization.
- Boring never writes a Pi-shaped wrapper JSONL into a Pi session directory in native mode.
- Boring does not parse wrapper titles as durable titles after migration except as a one-time migration input when native has no title.

### 3. Private metadata index is not a second session store

The index may hold only Boring-specific metadata. It must not duplicate messages, Pi model state, or a durable post-materialization title.

Proposed v1 records:

```ts
type PiSessionIdentityMode =
  | "native-local"
  | "legacy-wrapper"
  | "legacy-wrapper-no-native"
  | "legacy-alias-migrated"

type PiSessionLifecycleState =
  | "legacy-pending-no-native" // existing wrapper has no trusted native target; never for new chats
  | "materialized"
  | "migrating"
  | "deleted"
  | "conflict"
  | "repair-required"

interface PiSessionMetadataBaseV1 {
  version: 1
  identityMode: PiSessionIdentityMode
  lifecycleState: PiSessionLifecycleState
  /** Server-derived scope only; never trusted from a client header/body. */
  workspaceId: string
  storageScope: string
  userId?: string
  /** Temporary migration compatibility only. */
  legacyVisibleSessionIds?: string[]
  deletedAt?: string
  backupRef?: string
  migration?: {
    journalId?: string
    /** State machine B migration phase only; never first-send/draft state. */
    phase?: LegacyWrapperMigrationJournalPhase
    sourceWrapperPath?: string
    wrapperSha256?: string
  }
  createdAt: string
  updatedAt: string
}

interface NativePiSessionMetadataV1 extends PiSessionMetadataBaseV1 {
  nativeSessionId: string
  identityMode: "native-local" | "legacy-wrapper" | "legacy-alias-migrated"
  lifecycleState: "materialized" | "migrating" | "deleted" | "conflict"
  /** Hint only. Native header/session id remains authoritative. */
  nativeFileHint?: string
  /** Temporary migration compatibility only. Never set for new native sessions. */
  legacyCompatibility?: {
    pendingTitle?: string
  }
}

interface LegacyWrapperNoNativeMetadataV1 extends PiSessionMetadataBaseV1 {
  /** No native ID is known or trusted yet; consumers must not invent one. */
  nativeSessionId?: never
  identityMode: "legacy-wrapper-no-native"
  lifecycleState: "legacy-pending-no-native" | "deleted" | "conflict" | "repair-required"
  legacyVisibleSessionId: string
  legacyWrapperFileHint: string
  legacyCompatibility?: {
    pendingTitle?: string
  }
}

type PiSessionMetadataV1 = NativePiSessionMetadataV1 | LegacyWrapperNoNativeMetadataV1
```

A `legacy-wrapper-no-native` record is a quarantine state for pre-existing wrapper-only pending sessions. It is not a native alias, cannot be renamed through native title APIs, cannot be moved out of Pi's scanned directory as a successful native migration, and is only loadable through legacy compatibility code until it materializes through a proven native path or is explicitly deleted/tombstoned.

For new native sessions, the metadata index is created only after materialization. It is not a pending-title store, draft store, first-send receipt, or restart-recovery mechanism for unsent chats. Empty unsent chats are ephemeral browser state until Pi materializes a transcript. After materialization, records may remain for local scope, Boring enhancements, alias resolution, migration state, and host-specific metadata.

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

### 5. Metadata location is outside Pi scanning and private by construction

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

Filesystem requirements for the metadata root are part of the contract, not implementation detail:

- Resolve `nativeSessionDir`, metadata root, journals root, backup root, temp root, and event-stream root with `realpath` where they already exist; validate configured parents before creation.
- Metadata, journal, backup, temp, and event-stream roots must not overlap with the native Pi session directory in either direction. `metadataRoot` cannot be equal to, an ancestor of, or a descendant of `nativeSessionDir`; the same non-overlap check applies to backup/journal/temp roots.
- Create directories with restrictive modes (`0700` local default) and metadata/journal/backup files with restrictive modes (`0600` local default). Reject roots that are group/world-writable unless explicitly accepted by a trusted-local deployment check.
- Before using an existing root or file, verify ownership/expected UID in local direct mode. Hosted/shared-volume mode must use the host adapter's ownership model and must not treat local file metadata as authorization.
- All metadata/journal/backup/temp writes must be no-follow and collision-safe: open new temp files with exclusive create, reject symlinks/hardlink surprises via `lstat`/`fstat`, fsync file and parent directory, then atomically rename inside the same validated directory.
- Backup names must be derived from validated IDs plus collision-resistant suffixes or content hashes; never overwrite an existing backup with a different hash.

### 6. Empty unsent chats are ephemeral, not durable sessions

Pi intentionally defers transcript creation. Boring must not create private pending-title metadata, native Pi JSONL, journal, backup, event-stream file, Pi handle, channel, server draft record, or any other durable session record merely because the user opened, switched to, restored UI focus to, or reloaded an empty unsent chat.

The UI must not introduce a draft label, explanatory copy, or separate draft UI. It only hides the existing rename control until a native Pi transcript has materialized; after the first assistant response, the existing rename control appears.

Existing legacy wrappers that already contain pending titles are handled only for migration compatibility. That compatibility path is not new-session behavior.

#### Browser-memory pre-send protocol

- **No server session or draft authority before Send.** Opening "new chat" creates client component state only: a temporary native-session-shaped ID and a request ID generated in the live tab. The server is not called to register the empty draft.
- The temporary ID/request ID are not capabilities. They carry no authorization. The server derives `SessionCtx` from trusted local composition or hosted auth on first send and rejects unauthorized/conflicting requests before native/metadata reads or writes.
- The temporary ID/request ID must remain in browser memory only. Do not persist them to localStorage, sessionStorage, IndexedDB, active-session storage, URL state, plugin stores, workspace bridge state, event streams, metadata, journals, backups, metering, ask-user, logs intended as state, or Pi JSONL.
- First prompt uses the normal prompt route under the temporary native ID. The server creates/uses that native ID through the Slice 0-proven Pi path only when handling Send, then treats the session as materialized once the trusted native header/session is available.
- Same-tab retry of a lost first-send response reuses the same temporary ID and request ID while the tab is live. Live in-process prompt/run idempotency may reconnect or suppress duplicates only when it can prove the same request is active/accepted.
- Browser reload, tab close, browser restart, server restart, Pi restart, or runtime replacement loses all unsent draft state. The client must refresh/check materialized chats and let the user deliberately send again if needed. There is no hidden server recovery of an unsent draft.
- There is no route/outbox/stream remapping from draft to native. Client optimistic state before first send is local component state under the browser-only temporary ID; durable active/open-pane/outbox/stream state is written only after the native session is materialized.

#### Server-authoritative no-persistence guarantee

The server is the authority for ephemerality. Client UI hiding is insufficient. For an empty unsent chat, server code paths for open/switch/include-active/load/reload/restart must be hard-gated so they cannot:

- create or cache a Pi `SessionManager` handle;
- create a pi-chat channel, replay buffer, active run, or follow-up queue;
- allocate an event stream path or stream metadata;
- write native Pi JSONL, private metadata, migration journal, backup, tombstone, pending title, active-session durable storage, metering row, ask-user state, workspace bridge token, draft token, draft registry entry, or first-send receipt.

No `DraftRegistry` or durable first-send materialization receipt exists in the target design. If a first-send response is lost across a browser/server/Pi crash window, the outcome is intentionally unknown. Boring does not claim exactly-once first-prompt delivery across that window and must not auto-resubmit. Safe recovery is user-mediated: refresh/check materialized chats, then deliberately send again if needed.

#### Materialized/renameable capability contract

Materialized and renameable are distinct server-owned facts. `materialized` means a durable native header/session ID is trusted and loadable. `renameable` is stricter: it becomes true only after the first trusted assistant message has been committed to the native transcript, the native header is verified again, the session is not deleted/conflict/quarantined, the caller is authorized for the server-derived scope, and the proven Pi title API is available. Neither first-response event, stream-open, prompt-accepted, nor browser-only temporary ID flags can enable rename early. Renameability is not a `turnCount` heuristic. Every session summary/load response and every relevant stream/materialization event must expose:

```ts
capabilities: {
  materialized: boolean
  renameable: boolean
}
```

Rules:

- `materialized=true` only after a trusted native header/session ID exists and the server can load the native transcript or accepted materialization proof from the Slice 0 path.
- `renameable=true` only when `materialized=true`, a trusted first assistant message has committed to the native transcript, the native header/session ID has been verified after that commit, the session is not deleted/conflict/quarantined, the caller is authorized for the server-derived scope, and the proven Pi title API is available for that runtime mode.
- Early stream allocation, prompt submission, prompt acceptance, live request state, or client-side assistant placeholders may set `materialized=true` when the native header is verified, but must keep `renameable=false` until the trusted first assistant commit condition is satisfied.
- Existing legacy `legacy-wrapper-no-native` and empty browser-only drafts return/behave as `materialized=false`, `renameable=false`.
- All rename surfaces must consume this capability: `usePiSessions`, `PiChatPanel`, workspace chat panes/detached chat/session menus under `packages/workspace/src/front/**`, DebugDrawer rename/debug affordances if present, plugin-created session controls, and any route/action that accepts rename. Other controls stay unchanged unless their own server capability says otherwise.
- Rename routes re-check the same capability server-side and fail closed; hiding controls is not the auth boundary.

### 7. Trusted scope source and propagation differ by runtime mode

- **In scope for first migration:** local trusted direct Pi adapter using a file-backed native Pi session directory and private local metadata index.
- **Local direct trusted source:** scope is a fixed, composition-owned value produced by the direct local adapter/configuration: `runtimeCwd`, `nativeSessionDir`, `workspaceId`, `storageScope`, and optional local `userId`. It is not read from HTTP headers. `x-boring-storage-scope`, route params, and request bodies are selectors/hints only and must be ignored or rejected if they conflict with the composition-owned scope.
- **Hosted trusted source:** hosted/multi-user mode must derive scope from authenticated Core workspace membership through a host-provided resolver. The resolver must prove the caller is a member/owner of the requested Core workspace and must return the canonical `workspaceId`, `storageScope`, `userId`, and authorization grants before any metadata/native read or prompt/native operation. Hosted cannot use local file metadata as authorization.
- **Required propagation interface:** replace ad-hoc scope strings with a canonical `SessionCtx` propagated through routes, service ports, metadata adapters, migration, event streams, metering, ask-user/workspace bridge/plugin seams, and Pi harness calls:

```ts
interface SessionCtx {
  workspaceId: string
  storageScope: string
  userId?: string
  runtimeMode: "local-direct" | "hosted"
  source: "local-composition" | "core-workspace-membership"
}

interface SessionCtxProvider {
  derive(request: unknown, portCtx: unknown): Promise<SessionCtx>
}
```

- **Port change:** `toSessionCtx` and every port/route that currently accepts `x-boring-storage-scope`, raw `storageScope`, or raw workspace/user fields must be changed to accept/use `SessionCtx`; client-supplied scope values must be overwritten by the provider or rejected before any metadata/native reads.
- **Trusted-local metadata access only:** local file metadata may authorize adoption/listing only in the trusted single-user direct composition where the server controls `runtimeCwd`, `nativeSessionDir`, metadata root, workspace identity, and user identity.
- **Out of scope for first migration:** hosted/multi-user Pi. Hosted cannot opt into native discovery until it has the Core membership resolver plus separately complete, durable, host-owned metadata/session adapter.
- **Hosted requirement before opt-in:** inject a durable metadata/session adapter that enforces workspace/user auth at the host layer, records aliases/tombstones in host storage, and proves restart/runtime replacement behavior. Hosted native-ID opt-in is a separate slice after local direct migration is proven.
- **Non-Pi harnesses:** retain the generic `SessionStore` contract. This migration is isolated to Pi-backed adapters and must not leak Pi imports/IDs into generic workspace shared code.

## Flag / Abstraction

- **Needed?:** Yes, for reversible migration and mixed-version deployment.
- **Path:** `PiSessionIdentityMode = "legacy-wrapper" | "legacy-wrapper-no-native" | "legacy-alias-migrated" | "native-local"`, selected by adapter composition/configuration and persisted per session in metadata where possible.
- **Deployment mode:** every upgraded server must be able to read both legacy wrappers and native-local sessions before any wrapper is moved out of Pi's scanned directory.
- **Rollback:** rollback target is the upgraded compatible code with `native-local` creation disabled for new sessions if needed. Do **not** roll back to a wrapper-only binary after wrapper moves begin. Do **not** recreate legacy wrappers for native or migrated sessions.

The flag is migration scaffolding, not a permanent user-facing setting. Remove legacy-wrapper support only after local and hosted migration telemetry/proof, alias retention, rollback-window acceptance, and the hosted legacy-wrapper migration/deletion fence described in Slice 5.

### Wrapper-move deployment readiness/capability fence

Before **ANY** legacy wrapper file is moved out of Pi's scanned session directory, the deployment must pass and record this fence:

- [ ] **All writers current:** every process that can create, rename, delete, migrate, alias-resolve, or persist session IDs is running the compatible expanded build. This includes web/API workers, Pi chat workers, migration jobs, plugin/ask-user writers, metering/credits writers, workspace bridge writers, and queue/delegate workers.
- [ ] **No old wrapper-only writer remains:** health/deployment inventory proves no running binary can recreate a Pi-visible wrapper or write a stale wrapper ID as canonical after a move.
- [ ] **Metadata root and deployment lock mode available:** `BORING_AGENT_SESSION_METADATA_ROOT` resolves outside the native Pi session directory, is writable/fsync-capable, has successful no-follow atomic-write smoke proof, and the deployment has selected a valid lock mode: local direct proves single-host exclusive local locks, while hosted/shared uses the host durable transactional journal/lease/fencing adapter. Shared multi-host POSIX/file locking is rejected.
- [ ] **Native-mode read path proven in this deploy:** current code can list/load/rename/delete native-local sessions and resolve legacy compatibility metadata in the target environment before migration starts.
- [ ] **Alias read path proven in this deploy:** old wrapper IDs resolve to canonical native IDs at every API boundary in the target environment before migration starts.
- [ ] **Rollback target confirmed:** rollback is the same compatible expanded build with migration/native creation disabled, never a pre-migration wrapper-only binary.

If any fence item is missing or stale, migration must enter **legacy read-only/no-move** mode: wrappers remain in place, no wrapper backup/move runs, no alias-expiring write is allowed, and legacy sessions may only be read/resumed through the compatibility path until the fence is green. `legacy-wrapper-no-native` sessions are always treated as no-move unless/until a trusted native target materializes or the user explicitly deletes them.

## Architecture / Data Flow

### New local direct session

1. Boring opens an empty Pi-backed chat as browser-only component state with a temporary native session ID and request ID. No server draft is registered and no durable/native session ID exists yet.
2. Until Pi materializes a native transcript, the chat is not renameable and is not a durable session. Open/switch/include-active/load/reload paths must not create private pending-title metadata, migration journals, backups, event-stream files, Pi handles, pi-chat channels, draft registries, first-send receipts, or Pi JSONL for the unsent empty draft.
3. When the user sends the first prompt, the client calls the normal prompt route using the temporary native session ID and live request ID. The server derives trusted `SessionCtx`, validates authorization/admission, creates or uses a native Pi session with that ID through the Slice 0-proven Pi API/fallback, and submits the prompt.
4. Pi writes/materializes the first native JSONL through its SDK/runtime. Boring resolves it by native ID, verifies the durable native header, may create private metadata for scope/adoption of the now-materialized session, and lists the native transcript.
5. The first successful response/stream returns the canonical native ID plus `capabilities.materialized=true` once the native header is trusted. The client atomically replaces the browser-only temporary UI key with the native ID before any persisted active-session/open-pane/outbox/stream state is written. There is no draft-to-native route/outbox/stream remapping because no durable draft route/outbox/stream exists.
6. If the first-send response is lost while the same tab and server process are live, the client may retry with the same temporary native ID and request ID; live prompt/run idempotency may reconnect when it can prove the same request. If the browser/server/Pi restarts, the first-send outcome is intentionally unknown: the client refreshes/checks materialized chats and the user deliberately sends again if needed. The design makes no exactly-once claim across that crash window.
7. After the trusted first assistant response is committed and the server emits/returns `capabilities.renameable=true`, the existing rename control appears only from the capability contract. Rename validates capability again server-side and writes the title through the proven Pi title API for the materialized native session.

No `pi_session_file` record is created. A stale browser-only draft after reload/restart/tab close is discarded, not resumed.

### Resume/restart

1. API receives a native ID or legacy alias. Browser-only temporary IDs for unsent chats are not persisted and are never alias-resolved.
2. API boundary resolves aliases to canonical native ID before touching live caches, event streams, ask-user, metering, or stores.
3. If materialized, native transcript lookup uses Pi's session directory and header ID/file naming.
4. If an empty unsent chat never materialized, there is no durable session to resume after reload/restart. Any lost browser-only temporary ID/request ID is discarded without server recovery.
5. If a server/browser/Pi restart happens during first send before the client can confirm materialization, the outcome is unknown by design. The UI must refresh the native session list/transcripts, let the user inspect whether the intended chat exists, and require a deliberate new send if they want to try again. The server must not auto-resubmit based on a durable first-send receipt because no such receipt exists.
6. Existing legacy-wrapper pending titles are resolved only through the migration compatibility path; native title/transcript win after materialization.
7. `legacy-wrapper-no-native` records are loadable only through compatibility read paths and return `materialized=false`, `renameable=false`; they cannot be upgraded to native by resume/restart alone.

### Native session discovery admission/auth rules

Local direct Boring may discover standalone Pi sessions only when all rules pass:

1. File is a regular `.jsonl` under the configured `nativeSessionDir` after realpath/path-bound validation; no symlink escape.
2. Prefix parses as a Pi `type: "session"` header with a safe string `id` and supported/migratable Pi session version.
3. File does not contain the explicit legacy wrapper marker (`type: "pi_session_file"`) in its prefix.
4. Header ID is canonical. Filename is only a hint; duplicate header IDs are a stable conflict and neither duplicate is auto-adopted.
5. Header cwd must match the adapter `runtimeCwd` for normal local direct discovery. If a future local mode wants cross-cwd adoption from a shared `--session-dir`, it must be a separately flagged policy with proof.
6. Server derives canonical `workspaceId`/`storageScope`/`userId` from authenticated workspace context and adapter configuration before metadata/native reads. Client-supplied `storageScope` or route values are never authority.
7. If metadata exists for the native ID, the server-derived `workspaceId`/`storageScope`/`userId` must match it. Mismatch fails closed before opening the native file beyond the already-validated discovery prefix.
8. If no metadata exists, local direct trusted mode may list the native session only for the adapter's configured local workspace/storage scope; hosted mode must reject it until a host-owned metadata record exists.
9. Discovery never creates wrappers. It may create/update private metadata only after Boring explicitly opens/adopts the native session and only in local direct mode.

## Legacy Migration

### Preconditions

- The wrapper-move deployment readiness/capability fence must be green immediately before each migration batch and before each individual wrapper move. If it is not green, stop in legacy read-only/no-move mode.
- Never delete user sessions during migration.
- Migration must be idempotent and crash-safe.
- Preserve an original legacy wrapper in a non-Pi-scanned backup location until an explicit retention policy permits removal.
- All running deploys must understand aliases before wrapper moves begin.
- Before any migration reads, opens, renames, backs up, or writes a legacy wrapper or linked native file, it must validate the path with the migration-specific path validation checklist below. Discovery admission rules are not sufficient for migration safety.
- Existing wrapper-only pending sessions with no trusted native target enter `legacy-wrapper-no-native` compatibility state and are not moved as successful native migrations until a native target materializes through a proven path or the user explicitly deletes/tombstones them.

### Migration path validation checklist

Run this checklist before **every** migration read, open, rename, backup, copy, unlink, or metadata update that depends on a wrapper/native path:

1. Resolve the configured `nativeSessionDir`, metadata root, backup root, journal root, and candidate parent directories with `realpath` and validate root non-overlap/ownership/modes.
2. For the legacy wrapper path and linked native path, use `lstat` before open; reject symlinks, directories, devices, sockets, FIFOs, hardlink-count surprises where unsupported, and non-regular files.
3. Open files with no-follow semantics where the platform supports it; after open, `fstat` and compare device/inode/type/size expectations to close TOCTOU gaps.
4. Validate containment after canonicalization: wrapper source must be inside the configured Pi scanned session directory; linked native source must be inside the same validated `nativeSessionDir`; backups/journals/temps must be inside metadata-owned roots and outside Pi scanning.
5. Parse only a bounded prefix first. Wrapper must have the expected Boring wrapper marker/header and safe visible ID. Native file must have a Pi `type: "session"` header with a safe `id`; that header ID is the only native identity.
6. Validate that wrapper `pi_session_file` points to the same canonical native file/header ID and does not escape containment. Filename-derived IDs are hints only.
7. Re-run the relevant `lstat`/`fstat`/header ID checks immediately before backup move/copy and before writing metadata that aliases old ID to native ID.
8. If any validation fails, leave source files untouched, write only a conflict or `repair-required` journal record in the private metadata root, and do not manufacture a native transcript.

### Crash-safe journal, lock, and recovery

Use a metadata-root journal and lock for index writes, wrapper backup moves, and alias activation. Locking is split by deployment; do not pretend POSIX filesystem operations provide multi-host compare-and-swap.

Required mechanics:

1. **Local direct/single-host migration:** acquire a root migration lock plus per-native-ID and per-wrapper exclusive locks under metadata root before migrating. This mode is allowed only when the adapter proves a single host/process group owns the native session directory and metadata roots. If roots are on a shared/multi-host volume, if more than one host may run writers, or if the adapter cannot prove single-host exclusivity, migration must reject wrapper moves and enter legacy read-only/no-move mode.
2. Local lock files contain a cryptographically random owner token plus host/process metadata for diagnostics. PID, hostname, and mtime are never sufficient to steal a lock. Stale local recovery may only run after the current process proves no live owner in the same host/process group and atomically replaces the lock owner token; every subsequent journal/index/backup write verifies the current owner token before side effects.
3. **Hosted/shared migration:** must use a durable transactional DB journal/lease/fencing adapter supplied by the host. The adapter must provide transactional lease acquire/renew/release, monotonic fencing tokens, alias activation, journal phase commits, and metadata/tombstone writes in the host store. Hosted/shared migration must not use POSIX lock files, link/rename tricks, or local metadata files as a fake CAS/fencing mechanism.
4. Leases/owner tokens must be renewed or revalidated while a migration batch is active. If renewal/revalidation fails or the fencing/owner token changes, the worker must stop before touching user data and leave recovery to the current owner.
5. Write a journal record before side effects. In local direct it is a file:

```text
<metadata-root>/journals/<native-id-or-legacy-id>.<old-visible-id>.<owner-token-or-fence>.json
```

Hosted/shared stores the same journal fields transactionally in the host DB adapter instead of a local file. Journal fields include phase, local lock owner token or hosted fencing token, source wrapper path, target backup path, native path/header ID when present, wrapper hash/size/mtime, previous metadata hash, validation results, and timestamps.

6. Index writes are atomic and owner/fence checked: write temp file in the same validated directory with exclusive create/no-follow, fsync file, verify local owner token or hosted fence, rename/commit, fsync directory or commit transaction. Partial/temp files are ignored except by recovery.
7. Backup move is crash-safe and owner/fence checked:
   - local same-filesystem: `rename(source, backupTmp)` then `rename(backupTmp, backup)` with fsyncs after validating owner token immediately before each rename;
   - local cross-device: copy to `backupTmp`, fsync, verify size/hash, validate owner token, rename to `backup`, fsync, then unlink the original only after journal records `backup_committed` under the same owner;
   - hosted/shared: backup/move/trash is performed only through the host transactional adapter with a current lease/fencing token.
8. Alias must be committed before or with the backup phase so either old ID resolves or the old wrapper still exists. Crash after alias-before-move may temporarily leave Pi duplicate visibility; recovery must finish the move. Crash after move-before-complete must still resolve old ID through the alias.
9. Recovery on startup scans local journals or hosted DB journals and completes or marks `conflict`/`repair-required` only after acquiring the relevant local locks or hosted fenced leases. It must never guess ownership and must never manufacture a replacement native transcript.
10. Every migration phase is idempotent; retrying after interruption yields one native transcript, one backup, and one alias set.

### Per-wrapper procedure

1. Detect a legacy JSONL by `type: "pi_session_file"` plus a Boring header/context, after the migration path validation checklist passes for the wrapper path.
2. Derive Boring scope from trusted server/local adapter context and the validated wrapper context; never trust a client-provided `storageScope` during migration.
3. Validate the linked native file before reading it: canonical containment under `nativeSessionDir`, `lstat` regular file/no symlink, no-follow open, bounded header parse, safe native header ID, and wrapper pointer/header-ID consistency.
4. If there is no linked native file, the link escapes containment, the native file is missing/corrupt, or the header ID cannot be trusted, do **not** create a native metadata record and do **not** move the wrapper as migrated. Record or update `LegacyWrapperNoNativeMetadataV1` with `identityMode: "legacy-wrapper-no-native"`, `lifecycleState: "legacy-pending-no-native"`, the legacy visible ID, validated wrapper hint, server-derived scope, and compatibility-only pending title if present. The wrapper remains in legacy compatibility/no-move state until materialization through a proven path or explicit deletion.
5. For a valid native target, create/update private metadata keyed by native ID:
   - set `identityMode: "legacy-alias-migrated"` and `lifecycleState: "migrating"` while moving;
   - add wrapper ID to `legacyVisibleSessionIds`;
   - carry server-derived Boring scope;
   - carry an existing wrapper `pending.title` only as `legacyCompatibility.pendingTitle` when native is absent/unmaterialized; this is compatibility-only and never a new-session behavior;
   - if native exists and lacks `session_info` while wrapper has a real title, append that title once through the proven Pi SDK/API, not a raw JSONL write.
6. Move the validated wrapper to metadata-root legacy backup, e.g.:

```text
<metadata-root>/legacy-wrappers/<old-visible-id>.<wrapper-sha256>.jsonl
```

7. Mark metadata `lifecycleState: "materialized"`, then journal complete. Do not mark a no-native wrapper as materialized.
8. Rewrite local UI active-session storage and route/session aliases from old wrapper ID to native ID where possible; resolve aliases at every API boundary during the transition.
9. Verify Pi's cwd session directory contains only the native transcript afterward for migrated native targets; `legacy-wrapper-no-native` cases are reported separately and remain compatibility/no-move until an explicit materialize transition or delete.

### State machine B — legacy-wrapper migration journal

State machine B records wrapper/alias/backup progress only. It does not contain first-send receipt phases, prompt-submission recovery phases, durable draft state, or any auto-resubmit machinery.

```ts
type LegacyWrapperMigrationJournalPhase =
  | "legacy_wrapper_detected"
  | "legacy_no_native_quarantined"
  | "native_ready_for_alias"
  | "alias_prepared"
  | "alias_activated"
  | "wrapper_backup_prepared"
  | "wrapper_backup_committed"
  | "metadata_materialized"
  | "complete"
  | "legacy_read_only_no_move"
  | "blocked_by_fence"
  | "failed_before_alias"
  | "failed_after_alias"
  | "abandoned"
  | "deleted"
  | "conflict"
```

Allowed B transitions for a wrapper with a trusted linked native target:

```text
legacy_wrapper_detected
  -> native_ready_for_alias
  -> alias_prepared
  -> alias_activated
  -> wrapper_backup_prepared
  -> wrapper_backup_committed
  -> metadata_materialized
  -> complete
```

Allowed B transitions for a `legacy-wrapper-no-native` record after a user explicitly sends and a native session is actually materialized through the normal first-send protocol:

```text
legacy_no_native_quarantined
  -> native_ready_for_alias
  -> alias_prepared
  -> alias_activated
  -> wrapper_backup_prepared
  -> wrapper_backup_committed
  -> metadata_materialized
  -> complete
```

| Legacy migration phase | Required durable facts | Restart/lease recovery or terminal outcome |
| --- | --- | --- |
| `legacy_wrapper_detected` | Source wrapper path, wrapper safe visible ID, wrapper hash/size/mtime, server-derived `SessionCtx`, validation prefix, lease/fence token | Re-acquire migration lease, rerun path/header validation, and branch: valid native target advances to `native_ready_for_alias`; no trusted native target advances to `legacy_no_native_quarantined`; red deployment fence advances to `legacy_read_only_no_move`; validation failure advances to `conflict`. No native transcript is created here. |
| `legacy_no_native_quarantined` | Legacy visible ID, validated wrapper hint, `SessionCtx`, optional compatibility pending title, no native ID | Quiescent compatibility/no-move state. Restart leaves the wrapper unmoved and `materialized=false`, `renameable=false`. Only an explicit user send may create a native session through the normal browser-memory first-send protocol; B advances only after a trusted native header exists. Explicit delete advances to `deleted`; validation/auth failure advances to `conflict`. |
| `native_ready_for_alias` | Verified canonical native ID/header, wrapper facts, `SessionCtx` | Revalidate native header and wrapper under the migration lease. Prepare old-visible-ID -> native-ID alias only for matching scope. If validation fails before alias persistence, advance to `conflict` or `failed_before_alias`; wrapper remains in place/no-move. |
| `alias_prepared` | Alias write intent, previous metadata hash, canonical native ID, old visible ID, fence/owner token | Commit the alias atomically with owner/fence check. Restart retries the same alias write; it must not create a different native ID or submit/resubmit any prompt. If alias cannot be safely committed, advance to `failed_before_alias` and leave the wrapper in place. |
| `alias_activated` | Durable alias old visible ID -> native ID, metadata/index hash, fence/owner token | Alias resolution must work before any wrapper move. Restart verifies the alias and advances to `wrapper_backup_prepared`. If backup cannot proceed, advance to `failed_after_alias`; the alias remains durable and old IDs must still resolve. |
| `wrapper_backup_prepared` | Validated source wrapper, target backup path/tmp path, wrapper hash, backup collision checks, fence/owner token | Complete the same backup/copy/rename sequence idempotently. Restart verifies temp/final backup hashes and either advances to `wrapper_backup_committed` or retries the prepared move. If validation fails after alias activation, advance to `failed_after_alias` and preserve alias resolution. |
| `wrapper_backup_committed` | Final backup ref outside Pi scanning, verified hash/size, source move/unlink status, durable alias | Restart verifies backup and source absence/presence according to same-filesystem or cross-device rules, then advances to `metadata_materialized`. It must not recreate wrappers. If repair is impossible, advance to `failed_after_alias` with alias durable and backup/source artifacts preserved. |
| `metadata_materialized` | Metadata lifecycle update to `materialized`, alias set, backup ref, capability state | Restart revalidates metadata/native header/alias/backup and advances to `complete`. If metadata cannot be verified but alias exists, advance to `failed_after_alias` for repair without wrapper recreation. Rename remains false until the separate first-assistant/post-commit header rule passes. |
| `complete` | Final metadata hash, alias, backup ref, journal completion timestamp | Terminal success. Restart may compact/retain the journal but performs no first-send or wrapper side effects. |
| `legacy_read_only_no_move` | Red fence reason and wrapper facts | Quiescent no-move outcome while the deployment fence is red. Wrappers remain in place and readable through compatibility paths. A later green fence starts a new lease/journal attempt rather than stealing this phase. |
| `blocked_by_fence` | Fence failure reason before side effects | Terminal blocked outcome for that attempt. No alias, backup, or first-send side effect may run. |
| `failed_before_alias` | Failure reason before durable alias activation | Terminal automatic outcome. Wrapper remains in Pi scanning/compatibility or quarantine; no native alias is trusted. User retry requires a fresh explicit action; Boring must not auto-submit or auto-materialize. |
| `failed_after_alias` | Failure reason after durable alias activation | Repair-required terminal outcome for automatic foreground migration. Old visible ID must continue resolving to the canonical native ID; recovery batches may resume backup/metadata repair under a new lease but must not submit prompts or recreate wrappers. |
| `abandoned` | Explicit user abandon of unresolved migration attempt | Terminal UI dismissal. Does not delete native transcript, aliases, backups, or wrapper artifacts and never submits a prompt. |
| `deleted` | Explicit user delete/tombstone | Terminal delete semantics. Tombstone old visible ID/native ID according to delete rules and never submit or rematerialize automatically. |
| `conflict` | Stable validation/auth/scope/path/header conflict facts | Terminal conflict until explicit operator/user resolution. Preserve wrapper/source/backup artifacts; do not manufacture a native transcript. |

Rules:

- A quarantined wrapper with no trusted native target may become native only when the user explicitly sends from the live browser tab and the normal first-send protocol creates a real native session. The migration journal does not store draft tokens, request IDs, prompt hashes, first-send receipts, transcript messages, Pi model state, or prompt-recovery state.
- The transition must acquire the same local single-host locks or hosted transactional fenced lease as normal migration before preparing an alias, backing up a wrapper, or updating metadata.
- The native ID/header is written by the Slice 0-proven Pi path only. Product code must not fabricate a native transcript.
- Alias activation occurs only after linked-native validation has verified the native header, or for a no-native case after the explicit user send has already produced a verified native header. The session remains `renameable=false` until first assistant commit and post-commit native header verification pass.
- Wrapper backup/move occurs only after alias activation or in the same committed transaction/phase, so either the old visible ID resolves or the wrapper still exists. Recovery after alias-before-backup completes or repairs the backup; recovery after backup-before-complete preserves alias resolution and marks metadata materialized only after verification.
- Failures before alias activation leave the record in legacy compatibility/quarantine or `failed_before_alias` with the wrapper unmoved. Failures after alias activation keep the alias durable and complete/repair backup on recovery. No recovery path invents a replacement native transcript or auto-resubmits an uncertain prompt.

### Collision/conflict policy

- Native session title wins when present.
- Wrapper-only real title is a one-time migration candidate.
- Multiple wrappers pointing to one native ID merge aliases only when scopes are compatible.
- Scope conflicts become stable migration conflicts; do not guess.
- A missing/corrupt native target preserves wrapper source or backup and yields an explicit `legacy-wrapper-no-native` or repair-required/conflict migration state; do not manufacture a replacement transcript.

## Durable/raw session-ID consumer inventory

Implementation must audit and update every durable/raw consumer below. Each store/cache needs an alias migration test: old wrapper ID resolves to canonical native ID, canonical writes use native ID, and no component recreates a wrapper. Every consumer that can render or execute rename must use the server `capabilities.materialized/renameable` contract; every consumer that sees a browser-only unsent temporary ID/request ID must keep it in memory only and must not persist or route it as a durable session ID before Send.

### Server/session stores

- `packages/agent/src/server/harness/pi-coding-agent/sessions.ts`
  - `list`, `create`, `load`, materialized-session `rename`, retirement/compat-gating of `recordLivePendingTitle`, `loadEntries`, `delete`;
  - `resolveSessionFile`, `loadPiSessionFileSync`, `loadPiSessionFile`, `savePiSessionFile`, wrapper discovery/creation paths, prefix cache, append-in-flight locks.
- `packages/agent/src/server/harness/pi-coding-agent/createHarness.ts`
  - `sessionCacheKey`, `piSessions` live handle map, `getOrCreatePiSession`, `disposePiSession`, `hasPiSession`, retirement/compat-gating of `renameLivePendingPiSession`, delete override.
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
- HTTP routes in `packages/agent/src/server/http/routes/piChat.ts` and command routes/hooks that accept `:sessionId`, `activeSessionId`, or legacy `x-boring-storage-scope` hints.
  - Required auth regression: server derives canonical `SessionCtx` from the trusted local composition or hosted Core workspace membership resolver, treats client scope values as hints only, and fails closed before metadata/native reads when scope cannot be derived or conflicts.
  - Required empty-chat regression: open/switch/include-active/load/restart routes have no server draft token path and do not create Pi handles/channels/event streams/metadata for browser-only unsent chats.

### Frontend/session UI

- `packages/agent/src/front/chat/session/activeSessionStorage.ts`
  - `boring-agent:v2:<scope>:activeSessionId` localStorage.
- `packages/agent/src/front/chat/session/usePiSessions.ts`
  - browser-memory temporary native ID/request ID lifecycle, ephemeral empty-chat handling, active-session resolution only after materialization, switch/rename/delete URLs, include-active query, consuming `capabilities.materialized/renameable`, and hiding the existing rename control until materialization.
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
  - open chat pane IDs, pinned/open session IDs, detached chat, attention badges, drag/drop session IDs, project session open callbacks, and every rename/menu surface consuming the server `materialized/renameable` capability.

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

1. **Phase A — expand/read both:** ship alias resolver, private metadata adapter for materialized sessions/migration, native discovery read path, browser-memory empty-chat protocol, canonical `SessionCtx` propagation, first-send direct native creation/use semantics, explicit unknown-after-crash UX, and server `materialized/renameable` capabilities. New-session creation remains legacy unless Slice 0 is green. No wrapper moves yet.
2. **Phase B — native new sessions local direct:** enable `native-local` only for new local direct sessions using fixed composition-owned local scope and no HTTP-header scope authority. Legacy sessions continue to resolve by wrapper ID/native alias. Hosted remains off.
3. **Phase C — migrate local legacy wrappers:** only after the wrapper-move deployment readiness/capability fence is green: all running writers are current, metadata root/local single-host lock mode is available, native-mode read path is proven, alias read path is proven, and rollback targets are compatible. If the fence is not green or shared multi-host storage is detected, stay legacy read-only/no-move. Old wrapper-only binaries are no longer valid rollback targets. `legacy-wrapper-no-native` remains compatibility/no-move until a user send produces a trusted native target or explicit delete.
4. **Phase D — hosted adapter and hosted legacy fence:** before any shared legacy reader is deleted, hosted deployments must either (a) prove no hosted legacy wrappers exist, or (b) run a host-owned migration/fence that covers Core workspace membership authorization, transactional DB journal/lease/fencing, wrapper aliases, no-native legacy state, restart/runtime replacement, and rollback without local metadata authority or POSIX/file pretend-CAS.
5. **Phase E — contract:** after local plus hosted retention/telemetry/fences are accepted, remove wrapper creation first, then remove legacy readers in a separate final contraction. Legacy reader deletion is forbidden before Phase D is green.

Rollback at any phase uses the latest compatible code with feature flags disabled, not pre-migration wrapper-only code. Rollback must not recreate wrappers for native sessions or migrated aliases. If native creation must be disabled, existing native sessions remain readable/deletable through native ID and aliases; if legacy reader contraction has not passed Phase D/E, legacy readers remain enabled.

## Delete semantics

Delete is an explicit user action and is separate from migration backup retention.

- **Native materialized session:** resolve alias to canonical native ID, abort/dispose live handles, close/release event/metering/ask-user state, delete or host-trash the native Pi transcript according to the existing explicit-delete policy, delete metadata or mark `deleted` tombstone, and remove active/open UI references.
- **Unknown first-send outcome:** there is no durable unknown receipt to abandon or delete. The user refreshes/checks materialized chats; any materialized native session is handled with normal native delete/continue semantics, and any absent unsent browser state is simply gone.
- **Empty unsent chat:** discard ephemeral browser UI state only; no Pi handle/channel/event stream/native file/private metadata/journal/backup/pending-title/draft token/receipt exists and none is created.
- **Legacy compatibility pending/no-native wrapper:** if a `legacy-wrapper-no-native` record or old pending wrapper exists, tombstone the legacy-visible ID and preserve/move artifacts only according to explicit delete/retention policy; do not manufacture a native transcript and do not mark it materialized.
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
- Existing `PiSessionStore` native title/header parsing tests, with pending-title paths retained only for legacy compatibility fixtures.
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
- [ ] Prove or reject native ID creation/use with a caller-provided ID at first send through the real resolved Pi SDK, without product code fabricating native transcripts.
- [ ] Prove or reject materialized-session title rename through the real resolved Pi SDK.
- [ ] Prove standalone Pi CLI can resume/list the same native directory via `--session-dir` or `PI_CODING_AGENT_SESSION_DIR`.
- [ ] Record one explicit output: `supported-native-id`, `supported-fallback`, or `blocked-no-support`.
- [ ] Until the artifact is accepted with `supported-native-id` or `supported-fallback`, Slices 1+ remain forbidden and the plan state stays `needs-info`/blocked for implementation beyond Slice 0.

### Native local direct behavior

- [ ] New local direct materialized Pi session uses one native ID for Boring route/UI state and Pi header/transcript.
- [ ] Boring creates no `.jsonl` wrapper or `pi_session_file` marker in Pi's scanned session directory in native mode.
- [ ] Before native materialization, the existing rename control is hidden; no draft label, explanatory copy, or separate draft UI is added.
- [ ] Pre-send identity exists exclusively in browser memory as a temporary native session ID plus request ID; there is no server draft registration, no `DraftRegistry`, no draft/capability token, no `materialize-and-send` endpoint, and no durable first-send receipt/journal.
- [ ] Browser-only temporary IDs/request IDs are never persisted to localStorage, sessionStorage, IndexedDB, URL state, active-session storage, metadata, journals, backups, event streams, metering, ask-user, workspace bridge, plugin stores, or Pi JSONL before Send.
- [ ] First prompt uses the normal prompt route under the temporary native ID; the server derives trusted `SessionCtx`, validates auth/admission, creates/uses the native session through the Slice 0-proven Pi path, and applies normal existing prompt/run idempotency only once the session exists/materializes.
- [ ] Same-tab retry reuses the same temporary native ID and request ID only while the tab is live; browser/server/Pi restart makes the first-send outcome intentionally unknown, with UX to refresh/check materialized chats and deliberately send again if needed.
- [ ] The plan and implementation make no exactly-once claim for first prompt delivery across browser/server/Pi crash windows, and no recovery path auto-resubmits an uncertain first prompt.
- [ ] `capabilities.materialized=true` is set only from a trusted durable native header/session ID; `capabilities.renameable=true` is set only after the trusted first assistant message is committed and the native header is verified again. Early stream-open/prompt-accepted/live request flags never enable rename.
- [ ] After the first trusted assistant response commit, the existing rename control appears because `capabilities.renameable=true`, and renaming writes exactly one native `session_info`.
- [ ] Every rename surface and rename route consumes/re-checks the server `materialized/renameable` capability; `turnCount` and early materialization/live request state are not used as proof of renameability.
- [ ] Standalone `pi --session-dir "$nativeSessionDir" --resume` shows one session, with the Boring title and transcript.
- [ ] Empty unsent Boring chats are not durable, are not renameable, are not restored after reload/restart, and never appear as phantom Pi sessions.
- [ ] Empty-chat create/open/switch/include-active/reload/restart leaves native, metadata, journal, backup, and event-stream roots unchanged and creates no Pi handle/channel/server draft state.
- [ ] Private metadata index is used only for Boring enhancements of materialized sessions and legacy migration/aliases/tombstones, not for drafts or first-send recovery.
- [ ] Native discovery admits only authorized/local direct sessions per the admission rules and never creates wrappers.
- [ ] Hosted remains off until a separately complete host-owned adapter lands.

### Migration/compatibility behavior

- [ ] Existing wrapper-linked sessions migrate idempotently without migration-time user-data deletion; wrapper files are moved to private legacy backup outside Pi scanning.
- [ ] Existing wrapper pending titles are handled only as migration compatibility data and are never used to make new empty chats renameable or durable.
- [ ] Existing wrapper-only/no-native sessions enter `legacy-wrapper-no-native` compatibility/no-move state and are not migrated, renamed, or materialized without a trusted native target produced by explicit user send or explicit delete.
- [ ] No wrapper move can run unless the deployment readiness/capability fence is recorded green; if not green, legacy read-only/no-move behavior is enforced.
- [ ] Migration validates realpath/lstat, regular-file/no-symlink status, canonical containment, wrapper pointer, native header ID, and no-follow handles before every read/write/backup/move.
- [ ] Metadata root, journals, backups, temps, and event streams are outside Pi scanning, non-overlapping, restrictive-mode, ownership-checked, no-follow, and collision-safe.
- [ ] Migration journal/lock recovery covers interruption before alias, after alias before move, after move before complete, and stale locks using local single-host owner tokens or hosted DB lease/fencing. Local migration rejects shared multi-host volumes instead of relying on POSIX pretend-CAS.
- [ ] Active session persistence, open panes, DebugDrawer session-keyed state, event streams, queued work, metering, tool context, pending questions/ask-user, attention/inbox, workspace bridge tokens/idempotency, and credits/telemetry resolve aliases/native IDs correctly during migration.
- [ ] Metadata authorization uses `SessionCtx` from the trusted source for the deployment: local direct fixed composition-owned scope with no HTTP-header authority, or hosted authenticated Core workspace membership resolver. Unknown or conflicting scope fails closed before metadata/native reads.
- [ ] Mixed-version deployment supports per-session modes and rollback to compatible code without legacy wrapper recreation.
- [ ] Hosted legacy-wrapper migration/fence or proof of no hosted legacy data is accepted before any shared legacy reader deletion.
- [ ] `legacy-wrapper-no-native` migration uses only state-machine-B alias/backup phases after a trusted native header exists; it has no linked first-send receipt, no prompt recovery state, no `SUBMISSION_UNKNOWN`, and no auto-resubmit behavior.
- [ ] Delete semantics are implemented/tested for native, unknown first-send outcome by refresh/check, empty unsent, legacy compatibility/no-native pending, legacy alias, backup, and conflict states.
- [ ] Generic non-Pi harness consumers remain Pi-agnostic.

## Proof

### Automated

Slice 0 proof commands must be added first and their results recorded in `docs/issues/709/slice-0-compatibility.md`. Minimum shape:

```bash
pnpm --filter @hachej/boring-agent exec vitest run \
  src/server/harness/pi-coding-agent/__tests__/piSdkCompatibility.test.ts
pnpm --filter @hachej/boring-agent typecheck
cd "$runtimeCwd"
pi --session-dir "$nativeSessionDir" --resume
```

The Slice 0 compatibility test must import the same `@mariozechner/pi-coding-agent` package that `packages/agent` uses and exercise the real SDK. It may inspect JSONL after the SDK writes it, but it must not fabricate a native transcript as the act being tested. The CLI proof must run the real Pi CLI against the same cwd and native session directory; Boring's filtered list is not sufficient.

Regression suite after implementation, with exact required targeted files:

```bash
# Agent server/native identity and first-send behavior.
pnpm --filter @hachej/boring-agent exec vitest run \
  src/server/harness/pi-coding-agent/__tests__/createHarness.test.ts \
  src/server/harness/pi-coding-agent/__tests__/sessions.test.ts \
  src/server/harness/pi-coding-agent/__tests__/piSdkCompatibility.test.ts \
  src/server/harness/pi-coding-agent/__tests__/legacyNoNativeMaterialization.test.ts \
  src/server/pi-chat/__tests__/harnessPiChatService.test.ts \
  src/server/pi-chat/__tests__/piSessionIdentity.test.ts \
  src/server/http/routes/__tests__/piChatFirstSend.test.ts

# Frontend capability + browser-memory draft + alias regressions.
pnpm --filter @hachej/boring-agent exec vitest run \
  src/front/chat/session/__tests__/usePiSessions.nativeIdentity.test.tsx \
  src/front/chat/__tests__/PiChatPanel.materialize.test.tsx \
  src/front/__tests__/DebugDrawer.test.tsx

# Workspace capability + alias regressions.
pnpm --filter @hachej/boring-workspace exec vitest run \
  src/front/__tests__/nativeSessionCapabilities.test.tsx \
  src/front/__tests__/sessionAliasRegression.test.tsx

# Plugin capability + alias regressions.
pnpm --filter @hachej/boring-ask-user exec vitest run \
  src/server/__tests__/askUserSessionAlias.test.ts \
  src/front/__tests__/askUserSessionAlias.test.tsx

pnpm --filter @hachej/boring-agent typecheck
pnpm --filter @hachej/boring-workspace typecheck
pnpm --filter @hachej/boring-ask-user typecheck
bash scripts/check-invariants.sh packages/agent
bash scripts/check-invariants.sh packages/workspace
```

Add targeted tests for:

- resolved Pi SDK version/API gate and accepted Slice 0 compatibility artifact, including caller-provided native ID creation/use at first send;
- wrapper-move deployment readiness/capability fence, including legacy read-only/no-move when the fence is red;
- browser-memory-only temporary native ID/request ID behavior and no localStorage/sessionStorage/IndexedDB/URL/active-session persistence before Send;
- normal prompt-route first send: server-derived scope binding, auth/admission checks, create/use native session by requested ID, same-tab same-request retry while live, and no server draft token/registry/receipt/journal;
- explicit unknown crash semantics: after browser/server/Pi restart during first send, no exactly-once or auto-resubmit path exists; UX refreshes/checks materialized chats and requires deliberate send again if needed;
- same native ID before/after materialization when first send succeeds;
- native title exactly once after rename-after-materialization;
- server `capabilities.materialized/renameable` threaded to every rename surface and re-checked by rename routes, with renameable false until trusted first assistant commit plus post-commit native header verification;
- no wrapper JSONL, private pending-title metadata, journal, backup, event-stream file, Pi handle, pi-chat channel, server draft record, or first-send receipt created for a new empty unsent Boring chat;
- exact ephemerality proof: native, metadata, journal, backup, and event-stream root snapshots unchanged after empty create/open/switch, reload, and process restart;
- exact standalone directory contract helper/diagnostic;
- native discovery admission/auth/conflict rules with `SessionCtx`: local direct fixed composition-owned scope without HTTP-header authority, hosted Core workspace membership resolver when hosted opt-in exists, and trusted-local-only metadata authority;
- migration path validation for realpath/lstat, regular file/no symlink, no-follow open, header ID, and containment before reads/writes/backups;
- private metadata filesystem security for materialized sessions and migration only: non-overlap, ownership/modes, no-follow atomic writes, collision-safe backups/temps;
- empty unsent chat reload/restart non-durability and legacy pending-title/no-native compatibility handling;
- crash-safe migration journal/idempotency/recovery phases with local single-host owner-token locks and hosted DB lease/fencing adapter; shared multi-host POSIX/file-lock migration rejection;
- `legacy-wrapper-no-native` migration after explicit user send: state-machine-B phases only, alias/backup after verified native header, explicit restart/lease recovery or terminal outcome for every B phase, and no linked first-send receipt/no auto-resubmit machinery;
- alias resolution for every consumer in the inventory, including frontend capability rendering, workspace panes/menus, plugin-created controls, ask-user pending/answer/cancel, and DebugDrawer session-keyed state/system-prompt fetches;
- mixed-mode deployment/rollback with no wrapper recreation;
- hosted legacy-wrapper migration/fence before legacy reader deletion;
- delete semantics for native, unknown first-send outcome, empty unsent, legacy compatibility/no-native pending, alias, backup, conflict;
- hosted adapter injection remains required/off.

### Manual proof (required)

For a clean temporary Pi native session directory and the same cwd:

1. Start Boring local direct with a known `nativeSessionDir`, metadata root, journal root, backup root, and event-stream root outside Pi scanning. Record recursive file manifests plus hashes/mtimes for all five roots before empty-chat creation.
2. Create an empty Boring chat and assert the existing rename control is hidden with no draft label, explanatory copy, or separate draft UI; inspect server diagnostics/log counters to assert no Pi handle/channel/event stream/server draft state was allocated and only browser-memory temporary ID/request ID exists.
3. Re-record the five root manifests and assert they are byte-for-byte unchanged: native, metadata, journal, backup, and event-stream roots all match the pre-create snapshot.
4. Run:

```bash
cd "$runtimeCwd"
pi --session-dir "$nativeSessionDir" --resume
```

5. Assert no empty phantom entry exists.
6. Reload the browser and restart the Boring server before sending a prompt; assert the unsent browser-only draft is discarded, no durable session is restored, and the five root manifests remain unchanged after reload and after restart.
7. Send a prompt from a fresh browser-only chat through the normal prompt route using the temporary native ID and request ID; assert the server creates/uses that native ID only at Send, derives trusted scope, and creates no draft registry, draft token, first-send receipt, or draft metadata.
8. Drop the first HTTP response while the same tab/server are live; retry with the same temporary native ID/request ID and assert live idempotency reconnects or safely reports current state when it can prove the request. Separately restart the browser/server/Pi during first send and assert the UX treats the outcome as unknown: refresh/check materialized chats, no auto-resubmit, and deliberate user send again if needed.
9. Await the first materialization/stream response, assert the client switches atomically from browser-only temporary ID to native ID, assert no draft route/outbox/stream was persisted/remapped, assert `materialized=true` only after native header verification, assert rename remains hidden until trusted first assistant commit plus post-commit header verification, then rename the session and click outside to save.
10. Run the same standalone Pi command; assert one entry only, with the chosen title and transcript.
11. Run migration on copied wrapper/native fixtures and wrapper-no-native fixtures; interrupt at each journal phase in separate runs; assert recovery leaves no migrated JSONL wrapper in the Pi session directory, aliases still resolve, no-native wrappers remain compatibility/no-move until an explicit user send produces a trusted native target, and all local moves used validated paths plus single-host owner-token locks.
12. For a wrapper-no-native fixture, perform explicit user send and then alias/backup after the native header is verified; assert journal states use only state-machine-B phases, every B phase has explicit restart/lease recovery or terminal outcome, no linked first-send receipt exists, no path auto-resubmits, `materialized=true` only from native header, and `renameable=true` only after trusted first assistant commit.
13. Create an ask-user pending question on a legacy session fixture, migrate, then answer/cancel from the native session UI and assert one cleared pending state.
14. Delete native, unknown first-send materialized/absent cases, empty unsent, legacy compatibility/no-native pending, alias, and migrated sessions; assert Boring and standalone Pi visibility match delete semantics.
15. Before deleting any legacy reader in a test/staging deploy, record hosted fence proof: either no hosted legacy wrappers exist or host-owned migration/auth/restart/rollback has passed.

## Slices

### Slice 0: Pi SDK compatibility and shared-directory spike

**Delivers:** A small compatibility harness plus the accepted `docs/issues/709/slice-0-compatibility.md` artifact proving the actual resolved Pi package version, exact native ID creation/use API or exact supported fallback for first send, exact materialized-session title API/call sequence, and standalone CLI shared-directory contract. Reconciles the `0.75.5` package pin vs `0.80.3` root override by either aligning the dependency or explicitly blocking native-ID work.

**Blocked by:** None.

**Proof:** Real SDK tests plus a clean temp `pi --session-dir "$nativeSessionDir" --resume` manual check, both recorded in the Slice 0 artifact. No product behavior changes beyond tests/docs/package metadata if required by the spike.

**Exit rule:** Slices 1+ are forbidden until the Slice 0 artifact is accepted with `supported-native-id` or `supported-fallback`. If the artifact records `blocked-no-support`, implementation stops and this plan returns to `needs-info`/blocked instead of starting Slice 1.

**Review budget:** Inside. This is a bounded compatibility spike and gate.

### Slice 1: Browser-memory first send and private metadata foundation (local direct only)

**Delivers:** New local direct materialized chats use native Pi IDs; pre-send chats exist only in browser memory as temporary native ID plus request ID; first prompt uses the normal prompt route to create/use the native session through the Slice 0-proven Pi path; same-tab retry uses the same request ID while live; browser/server/Pi restart during first send is intentionally unknown with refresh/check/deliberate-send UX; no `DraftRegistry`, draft token, `materialize-and-send`, durable first-send receipt/journal, draft persistence, or exactly-once crash claim exists. Empty unsent chats remain ephemeral and non-renameable with no private pending-title metadata, journal, backup, event stream, Pi handle, channel, server draft state, localStorage/sessionStorage, or persisted draft authority before first send; no new wrappers are created; hosted remains off.

**Blocked by:** Slice 0 supported native-ID path or supported fallback.

**Proof:** Unit/service tests plus clean-root manual Boring + `pi --session-dir "$nativeSessionDir" --resume` test, including exact root-manifest ephemerality proof before/after empty create, reload, and restart; first-send direct native creation/use; same-tab retry while live; explicit unknown-after-crash UX with no auto-resubmit/no exactly-once claim; and no duplicate durable draft/receipt state.

**Review budget:** High. This changes identity at route/harness/UI seams.

### Slice 2: Native-only list/load/rename/delete, capabilities, and discovery admission

**Delivers:** Boring lists/loads native transcripts directly, enforces native discovery admission/auth rules with canonical `SessionCtx` and trusted-local-only metadata authority, handles native/empty-unsent/legacy-compatibility delete semantics, exposes `capabilities.materialized/renameable` through summaries/loads/streams, distinguishes durable native-header materialization from renameability, gates every rename surface and route so renameable becomes true only after trusted first assistant commit plus post-commit native header verification, and removes new-code reliance on `pi_session_file` for native mode.

**Blocked by:** Slice 1.

**Proof:** Browser/session switch/restart/delete tests; title/transcript/delete parity with standalone Pi; discovery conflict/auth tests; rename capability tests across agent UI, workspace surfaces, plugin controls, and routes proving early stream-open/live request state does not enable rename.

**Review budget:** High. Cross-layer migration and local security boundary.

### Slice 3: Consumer alias migration inventory

**Delivers:** API-boundary canonicalization and per-store migration/alias tests for all durable/raw consumers: front active/open panes, DebugDrawer session-keyed state/system-prompt fetches, workspace panes/menus/capabilities, plugin-created controls, event streams, metering, core send locks/context, workspace bridge tokens/idempotency, credits/telemetry, ask-user, attention/inbox, and pending tool/follow-up state.

**Blocked by:** Slice 2.

**Proof:** Per-store tests proving old ID resolves to native ID, canonical writes use native ID, and aliases can expire without data loss.

**Review budget:** High. Broad compatibility and data integrity.

### Slice 4: Legacy wrapper migration with validated paths and fenced journal/backup

**Delivers:** Existing wrapper-linked sessions migrate safely to private backup/index, wrapper IDs resolve to native IDs during retention, and no migrated wrapper remains visible to Pi. Includes migration-specific realpath/lstat/no-symlink/header-ID/containment validation before all reads/writes/backups, private metadata filesystem hardening, local single-host owner-token locks with shared multi-host rejection, hosted/shared DB lease/fencing adapter contract, journal/recovery implementation, `legacy-wrapper-no-native` compatibility/no-move state, no-native alias/backup only after explicit user send produces a verified native target, and the wrapper-move deployment readiness/capability fence.

**Blocked by:** Slice 3 plus a green wrapper-move fence: all running writers current, metadata root/lock mode available, native-mode read path proven, alias read path proven, and compatible rollback confirmed. If the fence is red or local deployment cannot prove single-host exclusivity, Slice 4 may only enforce legacy read-only/no-move.

**Proof:** Fixture migration tests, path-validation/security tests, idempotency/interruption/local-owner-lock/hosted-fence-recovery tests, shared multi-host rejection tests, no-native wrapper tests covering separate B journal phases after verified native header, explicit restart/lease handling for every B phase, and no first-send receipt/no-auto-resubmit semantics, copied-data manual standalone Pi verification.

**Review budget:** High. User-data migration; requires rollback/retention review.

### Slice 5: Hosted metadata adapter, hosted legacy migration, and deletion fence

**Delivers:** Hosted composition injects a durable metadata adapter with authenticated Core workspace membership scope resolver and host-owned workspace/user authorization; hosted native-ID opt-in only after complete adapter proof. Hosted/shared migration uses the durable transactional DB journal/lease/fencing adapter, never POSIX/file pretend-CAS. Hosted legacy wrappers are either proven absent or migrated/tombstoned through a host-owned fence that covers aliases, `legacy-wrapper-no-native`, authorization, restart/runtime replacement, and rollback. Slice 5 does **not** remove shared legacy readers by itself.

**Blocked by:** Slices 1–4 and hosted persistence/authorization architecture availability.

**Proof:** Hosted integration tests for scope/restart/runtime replacement/migration adapter behavior; local index rejected as hosted auth source; hosted legacy-wrapper migration/fence proof or hosted-no-legacy proof.

**Review budget:** High. Authorization and persistence.

### Slice 6: Final legacy contraction

**Delivers:** Remove legacy-wrapper creation first, then remove legacy read paths only after local retention/telemetry acceptance, alias-retention acceptance, rollback-window acceptance, and Slice 5 hosted fence acceptance. No contraction may remove support needed by `legacy-wrapper-no-native` tombstones or backups that are still inside retention.

**Blocked by:** Slices 1–5, accepted retention/rollback decision, and explicit owner approval for legacy reader deletion.

**Proof:** Contract tests proving native/migrated/hosted sessions remain readable/deletable, aliases fail according to accepted expiry policy, no code path recreates wrappers, and no hosted legacy reader is required.

**Review budget:** High. Deleting compatibility paths and migration safety net.

## Wide Refactor Strategy

**Expand → migrate batches → contract**

1. Expand with Slice 0 compatibility proof, read-both alias scaffolding, browser-memory first-send semantics, and server rename capabilities.
2. Enable native-ID path for new local direct sessions only; no new wrappers and exact empty-chat ephemerality proof.
3. Audit/migrate every raw session-ID consumer and prove alias behavior.
4. Migrate legacy wrapper/native pairs in idempotent batches with private backup, validated paths, fenced locks, journal recovery, and no-native quarantine.
5. Add hosted adapter/migration fence or prove hosted legacy absence.
6. Contract by removing legacy JSONL wrapper writes and then legacy reads only after local + hosted retention/telemetry/fence acceptance.

## Out of Scope

- Upstream Pi format changes or a Pi CLI patch to hide Boring wrappers.
- Copying Boring UI metadata into native Pi JSONL.
- Manually fabricating native Pi JSONL transcripts in product code.
- Hosted/multi-user native-ID opt-in before a complete host-owned adapter.
- A generic DB/index framework beyond the small metadata adapter required here.
- Changing non-Pi harness public IDs.
- Automatic physical deletion of legacy backup data outside explicit delete/retention policy.

## Open Questions

1. What retention period and user-visible recovery path should apply to moved legacy wrapper backups?
2. For explicit user delete, should native JSONL be hard-deleted as today or moved to a restorable trash first?
3. Which host-owned store should hosted native metadata use when Slice 5 starts?
4. How long must aliases remain after all known front clients and plugin stores migrate?
5. What explicit owner approval artifact is required before Slice 6 deletes shared legacy readers?

## State

`ready-for-agent` for **Slice 0 only**. Slices 1+ are forbidden until Slice 0 records and accepts `docs/issues/709/slice-0-compatibility.md` with a tested supported Pi SDK API/fallback, real SDK + CLI proof, and a resolved package pin/override decision. If Slice 0 cannot prove support, this plan must return to `needs-info` rather than implementing native-ID behavior.

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
- [ ] **Native ID API decision:** exact SDK symbol/signature/code path that injects/recreates a native Pi session ID before materialization, or an explicitly rejected API with failure output.
- [ ] **Session ID observation decision:** exact SDK symbol/signature proving Boring can read the same native ID before and after materialization.
- [ ] **Prompt intent/correlation marker decision:** exact Pi SDK-supported symbol/signature/code path that durably records a pre-submit prompt intent plus operation correlation marker in the native session before the first prompt is submitted, or a rejected API with failure output. This marker is required to distinguish reconnectable submissions from `SUBMISSION_UNKNOWN` after restart; product code must not raw-write a fabricated transcript marker.
- [ ] **Title API decision:** exact SDK/CLI symbol or supported call sequence that renames a materialized native transcript, or a rejected API with failure output. New empty unsent chats have no pending title behavior.
- [ ] **Fallback decision:** if primary APIs do not exist, the exact fallback mechanics and proof that they preserve native ID/session identity without product code manually fabricating a native transcript. Fallbacks must not introduce new-session pending-title persistence.
- [ ] **Real SDK proof:** test file/command/stdout using the real resolved Pi SDK imported by `packages/agent`; JSONL may be inspected after SDK writes but must not be manually fabricated as the proof act.
- [ ] **Real CLI proof:** command/stdout for `pi --session-dir "$nativeSessionDir" --resume` or `PI_CODING_AGENT_SESSION_DIR="$nativeSessionDir" pi --resume` against the same cwd/session directory used by the SDK proof.
- [ ] **Final gate decision:** exactly one of `supported-native-id`, `supported-fallback`, or `blocked-no-support`, with reviewer/owner acceptance recorded.

Candidate APIs to verify, not assume:

- `SessionManager.create(cwd, sessionDir, { id })` / `SessionManager.inMemory(cwd, { id })` or equivalent for native ID injection/recreation;
- `SessionManager.getSessionId()` before transcript materialization;
- Pi-supported pre-submit operation marker/prompt-intent write on the allocated native session, observable after restart through SDK/CLI-supported session reads;
- Pi-supported title write (`appendSessionInfo`, `AgentSession.setSessionName`, CLI `--name`, or another documented SDK surface) that works for materialized native transcripts;
- Pi CLI `--session-id <id>` and `--session-dir <dir>` behavior against the same directory.

Allowed Slice 0 outputs:

1. **`supported-native-id`:** align the package dependency to the proven exact version/API, attach real SDK + CLI proof, accept the artifact, and only then permit Slices 1+.
2. **`supported-fallback`:** document and test the exact fallback that still preserves native ID/session identity without manually fabricating a native transcript or introducing pending-title persistence for new empty chats, accept the artifact, and only then permit Slices 1+.
3. **`blocked-no-support`:** stop; mark Slices 1+ blocked and either upgrade Pi deliberately or change product requirements in a new plan revision.

Until the artifact exists and is accepted, Slices 1+ are not merely blocked; they are forbidden to start.

### 1. Native Pi ID is the local direct Pi public session ID

After Slice 0 proves support, local direct Pi-backed mode uses this identity only for materialized sessions:

```text
BoringSessionId === PiSessionManager.getSessionId() === native JSONL header.id
```

Before first prompt, there is no Boring/native server session ID. There is only an opaque random draft token issued by a mandatory process-local `DraftRegistry` and bound to server-derived scope. The draft token is not durable and is not a route/session ID. This replaces the current documented decision that a Boring wrapper UUID is canonical for Pi-backed local UI state. It does not change generic non-Pi harness IDs.

### 1a. Draft authority is a mandatory process-local DraftRegistry

Native-local mode must use a `DraftRegistry` for every server-acknowledged draft. The registry is process-local memory only: no file, DB, localStorage, metadata row, journal, event stream, Pi handle, or plugin/workspace store may persist draft authority. The token is an opaque cryptographically random value, returned only as a draft token, and bound to the canonical server-derived `SessionCtx` scope tuple for the request. The server must never accept client-provided workspace/storage/user headers or body fields as authority for that binding.

Server restart, process replacement, TTL expiry, scope mismatch, or missing registry entry invalidates the token fail-closed with `draft_not_found_or_expired`; the client discards the draft and presents a fresh empty composer/new chat. There is no recovery path that materializes an empty draft after registry loss.

### 1b. First send is a materialize-and-send transaction

Add exactly one first-send handoff endpoint for native-local drafts:

```http
POST /api/v1/agent/pi-chat/materialize-and-send
Content-Type: application/json
```

Request schema:

```ts
interface MaterializeAndSendRequest {
  /** Opaque token issued by DraftRegistry; never a session ID. */
  draftToken: string
  /** Client-generated stable key for this first-send attempt. */
  idempotencyKey: string
  /** Same prompt payload shape accepted by the existing prompt route. */
  prompt: PiChatPromptRequestBody
}
```

Success/reconnect response schema:

```ts
interface MaterializeAndSendResponse {
  kind: "materialized"
  sessionId: string // canonical native Pi/header ID
  idempotencyKey: string
  promptRunId: string
  streamUrl: string
  reconnectCursor?: number
  capabilities: {
    materialized: true
    renameable: boolean
  }
}
```

Uncertain-submission response schema:

```ts
interface MaterializeAndSendUnknownResponse {
  kind: "submission_unknown"
  code: "SUBMISSION_UNKNOWN"
  /** Canonical native Pi/header ID; `SUBMISSION_UNKNOWN` is emitted only after this header is verified. */
  sessionId: string
  idempotencyKey: string
  operationId: string
  nextAction: "use_existing_session_prompt_with_new_idempotency_key"
  capabilities: {
    materialized: true
    renameable: false
  }
}
```

State machine A — **materialize-and-send receipt** — has exactly one closed durable phase enum. `registered` and `consuming` are process-local `DraftRegistry` states and are intentionally not durable receipt phases.

```ts
type MaterializeAndSendReceiptPhase =
  | "operation_receipt_created"
  | "native_allocated"
  | "prompt_intent_persisted"
  | "native_header_verified"
  | "operation_receipt_bound"
  | "stream_allocated"
  | "prompt_submission_started"
  | "prompt_submission_observed"
  | "first_assistant_committed"
  | "completed"
  | "failed_before_submit"
  | "failed_after_submit"
  | "submission_unknown"
  | "abandoned"
  | "deleted"
```

Allowed durable transitions for state machine A:

```text
operation_receipt_created
  -> native_allocated
  -> prompt_intent_persisted
  -> native_header_verified
  -> operation_receipt_bound
  -> stream_allocated
  -> prompt_submission_started
  -> prompt_submission_observed
  -> first_assistant_committed
  -> completed

operation_receipt_created..stream_allocated -> failed_before_submit
prompt_submission_started -> submission_unknown
prompt_submission_observed..first_assistant_committed -> failed_after_submit
any non-deleted phase -> abandoned | deleted only by explicit user/delete semantics
```

`prompt_submission_observed` is the only accepted-submission proof phase. The enum has no `submitted` alias and no `recoverable` phase; retryability is derived from the phase and lease rules below.

| Durable receipt phase | Required durable facts | Restart/retry handling under the operation lease |
| --- | --- | --- |
| `operation_receipt_created` | `SessionCtx`, draft-token hash, `idempotencyKey`, prompt hash, operation ID, phase, timestamps | Pre-submit and safe to re-drive. Re-acquire the receipt lease, validate same scope/key/prompt, then resume native allocation or terminalize as `failed_before_submit` if the Slice 0 native-ID path cannot proceed. No prompt submission has occurred. |
| `native_allocated` | All prior facts plus canonical `nativeSessionId` returned by the Slice 0-proven path | Pre-submit and safe to re-drive only for header verification/marker persistence using the same native ID. Recovery must not allocate a different native ID. If the native header cannot be verified or recreated through the proven path, terminalize as `failed_before_submit` rather than submitting. |
| `prompt_intent_persisted` | All prior facts plus Pi-supported prompt intent, `operationId`, and correlation marker on the native session | Pre-submit and safe to re-drive. Recovery inspects the marker, reuses the same operation ID, and resumes header verification/binding. Re-persisting the marker is allowed only if the Slice 0 path proves it is idempotent for the same operation ID; otherwise recovery must inspect and continue or terminalize as `failed_before_submit`. |
| `native_header_verified` | Verified native header ID matching `nativeSessionId` | Pre-submit and safe to re-drive. Recovery may recreate live handles/channels for this native ID, but must first inspect the correlation marker/transcript/stream to ensure submission has not already started outside the receipt. If inspection is impossible, terminalize as `failed_before_submit`. |
| `operation_receipt_bound` | Receipt/index bound to the verified native ID/state | Pre-submit and safe to re-drive. Recovery may rebuild private metadata/event-stream bindings under the same native ID. It must not create a wrapper or change identity. |
| `stream_allocated` | Stream identity/cursor for the canonical native ID | Last pre-submit phase and safe to re-drive. Recovery may reopen/recreate the reconnect stream for the same native ID and may perform the first Pi prompt submission only if the receipt is still before `prompt_submission_started` and correlation/transcript/stream inspection proves no prior accepted submission for this operation. |
| `prompt_submission_started` | Durable fence that outbound Pi prompt submission was invoked or may have been invoked | **Never auto-resubmit.** On restart or same-key retry, acquire the lease and inspect the Pi correlation marker, native transcript, prompt-run registry, and stream state. Advance to `prompt_submission_observed` when acceptance is conclusive, or to stable `submission_unknown` when it is not. This phase must never remain indefinitely in progress. |
| `prompt_submission_observed` | Conclusive `promptRunId` or equivalent accepted-submission proof | Never auto-resubmit. Recovery reconnects to the run/stream or transcript by native ID. If later assistant completion fails, record `failed_after_submit`; do not retry the first prompt automatically. |
| `first_assistant_committed` | Trusted first assistant message committed plus post-commit native header verification pending/complete | Never auto-resubmit. Recovery verifies the committed transcript and then completes capability updates; rename remains false until the post-commit header verification succeeds. |
| `completed` | First assistant commit and capability update complete | Terminal success. Same-key materialize retry returns the canonical native session/stream/cursor/status without submitting. |
| `failed_before_submit` | Failure before `prompt_submission_started` plus reason | Terminal for that consumed draft operation. It may be shown as retryable only by creating a fresh draft/materialize operation; the consumed token/key is not reused as draft authority. |
| `failed_after_submit` | Observed prompt later failed conclusively | Terminal for automatic recovery. User may continue in the canonical native session through `POST /api/v1/agent/pi-chat/:sessionId/prompt` with a new idempotency key. |
| `submission_unknown` | Verified native session ID, operation ID, old idempotency key, and inconclusive acceptance after bounded inspection | Terminal for automatic recovery. Old key returns stable `SUBMISSION_UNKNOWN`; Boring never auto-resubmits this first prompt. User recovery is explicit and occurs only on the canonical native session. |
| `abandoned` | User deliberately dismissed the unresolved operation | Terminal UI dismissal. Does not delete the native transcript/session, does not free the consumed draft token, and does not cancel or resubmit anything. Late Pi output, if it appears, is treated as normal transcript state on reload. |
| `deleted` | User explicitly deleted the canonical native session | Terminal delete/tombstone. Old materialize retries resolve to deleted/not-found per delete semantics and never resubmit. |

Rules:

- Consumption is atomic per token inside `DraftRegistry`. Exactly one consumer may transition `registered -> consuming`. The in-memory transition captures `idempotencyKey`, prompt hash, server-derived scope, native ID once allocated, stream identity, prompt run ID if observed, and the durable materialization operation ID until TTL/stream completion.
- Once `materialize-and-send` begins consuming a token, the request is no longer an empty unsent draft. The server must create a durable, scoped materialization-operation receipt/journal before native allocation side effects and before any Pi prompt submission. This is allowed under the ephemerality contract because it is not persisting authority for an unsent draft; it is a recovery receipt for an in-flight materialization operation initiated by an explicit first-send action.
- The receipt stores only scoped recovery facts: server-derived `SessionCtx`, a non-reversible hash of the draft token, `idempotencyKey`, prompt hash, operation ID, native ID once allocated, stream identity if allocated, prompt run ID only if conclusively observed, operation phase from the enum above, lease/fencing token, timestamps, and error/unknown/delete/abandon state. It must not store the raw draft token, client-trusted scope, a pending title, transcript messages, or Pi model state.
- Durable receipt updates are lease/fence checked. On restart, workers recover only after acquiring the operation lease; if the lease cannot be acquired or renewed, the worker stops before side effects. Pre-submit phases (`operation_receipt_created` through `stream_allocated`) are idempotently resumed or terminalized under that lease. Phases at or after `prompt_submission_started` are observation-only for the first prompt and must never call the first-prompt submit path again.
- The receipt maps `(SessionCtx, draftTokenHash, idempotencyKey, promptHash)` to the native ID/state so retry after server restart can recover or reconnect even though `DraftRegistry` is gone. A same-key retry after restart must first consult this receipt by hashed token/idempotency/prompt/scope; if the receipt is reconnectable it returns the same native session/stream or cursor without submitting another prompt.
- Before submitting the first prompt to Pi, Boring must persist the prompt intent and an operation correlation marker through the Slice 0-proven Pi SDK/API/fallback on the allocated native session. This is the durable pre-submit marker used to correlate Pi-visible state, materialization receipt state, and prompt-run observation after restart. If Slice 0 cannot prove such a marker path, Slice 1 remains blocked.
- This plan does **not** promise impossible exactly-once prompt submission across a crash between outbound submission and durable observation. If restart/retry reaches `prompt_submission_started`, it must inspect the pre-submit marker, native transcript state, prompt-run state, and stream state and then advance to `prompt_submission_observed` or stable `SUBMISSION_UNKNOWN`; it must not remain in-progress forever and must never auto-resubmit that prompt.
- User-visible `SUBMISSION_UNKNOWN` recovery: the response returns `kind: "submission_unknown"`, `code: "SUBMISSION_UNKNOWN"`, and the canonical native `sessionId`; the UI must atomically open that canonical session, render it as materialized but unknown/unresolved, keep `renameable=false`, and show the unresolved first-send operation. The old `draftToken` is consumed and the old `idempotencyKey` remains bound to stable `SUBMISSION_UNKNOWN` on `materialize-and-send` retry. If the user deliberately tries again, the client generates a new idempotency key and sends a new prompt through the normal existing-session send endpoint `POST /api/v1/agent/pi-chat/:sessionId/prompt` using the canonical native session ID, **not** through `materialize-and-send` and not by reusing the consumed draft token. The user may also abandon the unresolved operation or delete the canonical session under the explicit semantics below.
- Retry after response loss with the same `draftToken`, same `idempotencyKey`, same prompt hash, and same server-derived scope returns the already materialized native session/stream/cursor when reconnectable, returns stable in-progress only while recovery is still in a pre-submit resumable phase under lease, or returns stable `SUBMISSION_UNKNOWN` when observation is inconclusive. It must not submit the prompt a second time.
- Concurrent same-key consumption returns the same result when materialization has reached a reconnectable or terminal state; while the first consumer is still before that state it returns a stable in-progress/retryable response, not a second prompt.
- Concurrent or later consumption with a different `idempotencyKey`, different prompt hash, or different server-derived scope returns a stable `draft_already_consumed`/`draft_scope_mismatch` error. If a native session was already allocated, the error may include the canonical `sessionId` for client reconciliation, but it must not enqueue another prompt.
- If the process restarts before the materialization-operation receipt is durably created, the token is gone and retry fails closed as `draft_not_found_or_expired`; the client opens a fresh empty chat. If restart happens after receipt creation, recovery is driven by the receipt plus durable native/Pi marker observation, never by persisted draft authority.

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
  | "legacy-no-native-materializing" // explicit first-send transition from quarantined wrapper to native
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
    /** State machine B phase, never a state-machine-A receipt phase. */
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
  lifecycleState: "legacy-pending-no-native" | "legacy-no-native-materializing" | "deleted" | "conflict" | "repair-required"
  legacyVisibleSessionId: string
  legacyWrapperFileHint: string
  legacyCompatibility?: {
    pendingTitle?: string
  }
}

type PiSessionMetadataV1 = NativePiSessionMetadataV1 | LegacyWrapperNoNativeMetadataV1
```

A `legacy-wrapper-no-native` record is a quarantine state for pre-existing wrapper-only pending sessions. It is not a native alias, cannot be renamed through native title APIs, cannot be moved out of Pi's scanned directory as a successful native migration, and is only loadable through legacy compatibility code until it materializes through a proven native path or is explicitly deleted/tombstoned.

For new native sessions, the metadata record is not a pending-title store. Empty unsent chats are ephemeral UI state until Pi materializes a transcript. The record may remain for local scope, alias resolution, migration state, and host-specific metadata.

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

Pi intentionally defers transcript creation. Boring must not create private pending-title metadata, native Pi JSONL, journal, backup, event-stream file, Pi handle, channel, or any other durable session record merely because the user opened, switched to, restored UI focus to, or reloaded an empty unsent chat.

The UI must not introduce a draft label, explanatory copy, or separate draft UI. It only hides the existing rename control until a native Pi transcript has materialized; after the first assistant response, the existing rename control appears.

Existing legacy wrappers that already contain pending titles are handled only for migration compatibility. That compatibility path is not new-session behavior.

#### Pre-send identity protocol

- **No server session ID before first prompt.** Opening "new chat" creates client memory UI state plus an opaque random token issued by the mandatory process-local `DraftRegistry`. The token is not a Boring session ID, is never accepted as a native/session route ID after materialization, and must never be stored in native JSONL, metadata, journals, backups, event streams, local durable active-session storage, metering, ask-user, workspace bridge, or plugin stores.
- Draft-token API shape: native-local mode may use the existing `POST /sessions` wiring or a dedicated lightweight draft-token route, but either way it only registers a token in `DraftRegistry` under the server-derived `SessionCtx` and returns `{ kind: "draft", draftToken, sessionId: null, capabilities: { materialized: false, renameable: false } }`. It must not return a native-looking ID, must not set `Location: /sessions/:id`, and must not update durable active-session storage. Routes that require `:sessionId` reject the draft token.
- `DraftRegistry` is mandatory for every server-acknowledged native-local draft and is process-local only. It is keyed by `(process instance, server-derived workspaceId, storageScope, userId, draftToken)` with a short TTL. It may hold only ephemeral composer/UI authorization and first-send idempotency facts. It must not allocate a Pi `SessionManager`, Pi channel, event stream, metadata row, journal row, native ID, plugin record, workspace token, or metering row before first send.
- First prompt uses `POST /api/v1/agent/pi-chat/materialize-and-send` with `{ draftToken, idempotencyKey, prompt }`. The server derives scope from trusted `SessionCtx`, atomically consumes the token in `DraftRegistry`, writes a durable scoped materialization-operation receipt/journal keyed by draft-token hash + idempotency key + prompt hash + scope, advances only through the closed receipt phases defined in Decision 1b, obtains the native ID through the Slice 0-proven Pi API/fallback, creates the Pi handle/channel/event stream **under the native ID only**, persists prompt intent plus the operation correlation marker through the Slice 0-proven Pi API before submission, then submits the prompt and returns/reconnects the canonical native session ID and stream when submission is observable.
- Response-loss retry is part of the endpoint contract. A retry with the same token, idempotency key, prompt hash, and server-derived scope returns the same native session/stream or reconnect cursor without duplicating the prompt when the operation is reconnectable, returns stable in-progress only for a leased pre-submit phase that is still being idempotently resumed/terminalized, or returns stable `SUBMISSION_UNKNOWN` when restart/recovery cannot conclusively observe whether Pi accepted the prompt after `prompt_submission_started`. `SUBMISSION_UNKNOWN` always includes the canonical native session ID and opens that session in unknown state; any deliberate new attempt uses the normal existing-session send endpoint `POST /api/v1/agent/pi-chat/:sessionId/prompt` with the canonical native session ID and a new idempotency key, not the consumed `materialize-and-send` draft token. Concurrent consumption with the same key returns the same stable in-progress/result/unknown response; concurrent consumption with a different key/prompt/scope returns a stable consumed/scope error and never submits a second prompt.
- There is no route/outbox/stream remapping from draft to native. Drafts do not have session routes, persisted outboxes, replay streams, metering reservations, or stream cursors. Client optimistic state queued before first send is local component state under the draft token; it is attached to the native session only after the atomic handoff returns the native ID.
- A stale draft token after reload, restart, TTL expiry, or server replacement fails closed as `draft_not_found_or_expired`. The client discards the empty draft and may show a fresh empty composer/new chat; it must not call load/rename/delete/resume routes with the stale draft and the server must not materialize an empty draft as recovery.

#### Server-authoritative no-persistence guarantee

The server is the authority for ephemerality. Client UI hiding is insufficient. For an empty unsent draft, server code paths for open/switch/include-active/load/reload/restart must be hard-gated so they cannot:

- create or cache a Pi `SessionManager` handle;
- create a pi-chat channel, replay buffer, active run, or follow-up queue;
- allocate an event stream path or stream metadata;
- write native Pi JSONL, private metadata, migration journal, backup, tombstone, pending title, active-session durable storage, metering row, ask-user state, or workspace bridge token.

`DraftRegistry` is the only draft authority. It is scoped to trusted server-derived `SessionCtx`, process-local, and expires on TTL/reload/restart/process replacement. It is never a durable authorization source and never allows listing/resuming/materializing an unsent draft after process loss. The durable materialization-operation receipt created after an explicit `materialize-and-send` begins is not draft authority; it is scoped recovery/idempotency state for an in-flight first-send operation.

#### Materialized/renameable capability contract

Materialized and renameable are distinct server-owned facts. `materialized` means a durable native header/session ID is trusted and loadable. `renameable` is stricter: it becomes true only after the first trusted assistant message has been committed to the native transcript, the native header is verified again, the session is not deleted/conflict/quarantined, the caller is authorized for the server-derived scope, and the proven Pi title API is available. Neither first-response receipt, stream-open, prompt-accepted, nor token-consumed flags can enable rename early. Renameability is not a `turnCount` heuristic. Every session summary/load response and every relevant stream/materialization event must expose:

```ts
capabilities: {
  materialized: boolean
  renameable: boolean
}
```

Rules:

- `materialized=true` only after a trusted native header/session ID exists and the server can load the native transcript or accepted materialization proof from the Slice 0 path.
- `renameable=true` only when `materialized=true`, a trusted first assistant message has committed to the native transcript, the native header/session ID has been verified after that commit, the session is not deleted/conflict/quarantined, the caller is authorized for the server-derived scope, and the proven Pi title API is available for that runtime mode.
- Early materialization receipts, stream allocation, prompt submission, or client-side assistant placeholders may set `materialized=true` when the native header is verified, but must keep `renameable=false` until the trusted first assistant commit condition is satisfied.
- Existing legacy `legacy-wrapper-no-native` and empty drafts return/behave as `materialized=false`, `renameable=false`.
- All rename surfaces must consume this capability: `usePiSessions`, `PiChatPanel`, workspace chat panes/detached chat/session menus under `packages/workspace/src/front/**`, DebugDrawer rename/debug affordances if present, plugin-created session controls, and any route/action that accepts rename. Other controls stay unchanged unless their own server capability says otherwise.
- Rename routes re-check the same capability server-side and fail closed; hiding controls is not the auth boundary.

### 7. Trusted scope source and propagation differ by runtime mode

- **In scope for first migration:** local trusted direct Pi adapter using a file-backed native Pi session directory and private local metadata index.
- **Local direct trusted source:** scope is a fixed, composition-owned value produced by the direct local adapter/configuration: `runtimeCwd`, `nativeSessionDir`, `workspaceId`, `storageScope`, and optional local `userId`. It is not read from HTTP headers. `x-boring-storage-scope`, route params, and request bodies are selectors/hints only and must be ignored or rejected if they conflict with the composition-owned scope.
- **Hosted trusted source:** hosted/multi-user mode must derive scope from authenticated Core workspace membership through a host-provided resolver. The resolver must prove the caller is a member/owner of the requested Core workspace and must return the canonical `workspaceId`, `storageScope`, `userId`, and authorization grants before any metadata/native read or draft/materialize operation. Hosted cannot use local file metadata as authorization.
- **Required propagation interface:** replace ad-hoc scope strings with a canonical `SessionCtx` propagated through routes, service ports, metadata adapters, draft registry, migration, event streams, metering, ask-user/workspace bridge/plugin seams, and Pi harness calls:

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

1. Boring opens an empty Pi-backed chat as client-only ephemeral UI state with an opaque server-issued draft token (`draft:<random>`) registered in the mandatory process-local `DraftRegistry` under server-derived `SessionCtx`; it returns no durable/native session ID.
2. Until Pi materializes a native transcript, the chat is not renameable and is not a durable session. Open/switch/include-active/load/reload paths must not create private pending-title metadata, migration journals, backups, event-stream files, Pi handles, pi-chat channels, or Pi JSONL for the unsent empty draft.
3. When the user sends the first prompt, the client calls `POST /api/v1/agent/pi-chat/materialize-and-send` with `{ draftToken, idempotencyKey, prompt }`. The server derives trusted `SessionCtx`, atomically consumes the token, writes the durable scoped materialization-operation receipt, advances through the closed durable phases in Decision 1b, selects native identity only through the Slice 0-proven Pi API/fallback, creates route/outbox/stream/channel state under the native ID only, persists prompt intent plus the operation correlation marker through the Slice 0-proven Pi path, and then submits the prompt.
4. Pi writes/materializes the first native JSONL through its SDK/runtime. Boring resolves it by native ID, verifies the durable native header, correlates it with the materialization receipt and pre-submit marker, may create private metadata for scope/adoption, and lists the native transcript. Pre-submit receipt phases are idempotently resumed or terminalized under lease after restart. Once `prompt_submission_started` is recorded, recovery is observation-only: it inspects correlation/transcript/run/stream state, advances to `prompt_submission_observed` when conclusive or stable `SUBMISSION_UNKNOWN` when inconclusive, and never auto-resubmits that prompt.
5. The first materialization/stream response returns the canonical native ID plus `capabilities.materialized=true`. A `SUBMISSION_UNKNOWN` response also returns that canonical native ID and the client opens the canonical session in an unknown/unresolved state. `capabilities.renameable` remains false until a trusted first assistant message is committed and the native header is verified after that commit. The client atomically replaces the draft UI key with the native ID before any persisted active-session/open-pane/outbox/stream state is written; there is no draft-to-native route/outbox/stream remapping because no durable draft route/outbox/stream exists.
6. After the trusted first assistant response is committed and the server emits/returns `capabilities.renameable=true`, the existing rename control appears only from the capability contract. Rename validates capability again server-side and writes the title through the proven Pi title API for the materialized native session.

No `pi_session_file` record is created. A stale draft after reload/restart/TTL is discarded, not resumed.

### Resume/restart

1. API receives a native ID or legacy alias. Draft tokens are rejected on resume/load/rename/delete/list routes and are never alias-resolved.
2. API boundary resolves aliases to canonical native ID before touching live caches, event streams, ask-user, metering, or stores.
3. If materialized, native transcript lookup uses Pi's session directory and header ID/file naming.
4. If an empty unsent chat never materialized, there is no durable session to resume after reload/restart. A stale draft token from local component memory fails closed and is discarded without server recovery.
5. If a materialization-operation receipt exists, restart recovery resolves it by server-derived scope, draft-token hash, idempotency key, prompt hash, native ID, and Pi correlation marker. Recovery re-drives only pre-submit phases under the operation lease. At `prompt_submission_started` or later it never auto-resubmits; it reconnects only when acceptance/stream/transcript state is conclusive, otherwise it terminalizes the old idempotency key as stable `SUBMISSION_UNKNOWN`, returns the canonical native session ID, opens that canonical session in unknown state, and waits for explicit user action. A deliberate retry/new prompt uses `POST /api/v1/agent/pi-chat/:sessionId/prompt` with the canonical native session ID and a new idempotency key, not the consumed `materialize-and-send` draft token.
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

State machine B is separate from state machine A. The legacy-wrapper migration journal records wrapper/alias/backup progress only; it never uses first-send receipt phases such as `operation_receipt_created`, `stream_allocated`, `prompt_submission_started`, or `prompt_submission_observed` as migration phases.

```ts
type LegacyWrapperMigrationJournalPhase =
  | "legacy_wrapper_detected"
  | "legacy_no_native_quarantined"
  | "materialize_requested"
  | "materialize_receipt_linked"
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

Allowed B transitions for a `legacy-wrapper-no-native` explicit user materialize action:

```text
legacy_no_native_quarantined
  -> materialize_requested
  -> materialize_receipt_linked
  -> native_ready_for_alias
  -> alias_prepared
  -> alias_activated
  -> wrapper_backup_prepared
  -> wrapper_backup_committed
  -> metadata_materialized
  -> complete
```

The `materialize_receipt_linked` phase stores a reference to one state-machine-A `MaterializeAndSendReceiptPhase` record and the current receipt phase/outcome as observed data. It does not inline or rename A's phases. Receipt recovery/submission is owned by state machine A under the receipt lease; wrapper alias/backup recovery is owned by state machine B under the migration lease/fence.

| Legacy migration phase | Required durable facts | Restart/lease recovery or terminal outcome |
| --- | --- | --- |
| `legacy_wrapper_detected` | Source wrapper path, wrapper safe visible ID, wrapper hash/size/mtime, server-derived `SessionCtx`, validation prefix, lease/fence token | Re-acquire migration lease, rerun path/header validation, and branch: valid native target advances to `native_ready_for_alias`; no trusted native target advances to `legacy_no_native_quarantined`; red deployment fence advances to `legacy_read_only_no_move`; validation failure advances to `conflict`. No native transcript is created here. |
| `legacy_no_native_quarantined` | Legacy visible ID, validated wrapper hint, `SessionCtx`, optional compatibility pending title, no native ID | Quiescent compatibility/no-move state. Restart leaves the wrapper unmoved and `materialized=false`, `renameable=false`. Only explicit user materialize advances to `materialize_requested`; explicit delete advances to `deleted`; validation/auth failure advances to `conflict`. |
| `materialize_requested` | User materialize intent, idempotency key, prompt hash, `SessionCtx`, wrapper facts, migration lease/fence token | Re-acquire migration lease, validate same scope/key/prompt/wrapper, and create or find exactly one state-machine-A receipt. If no receipt was durably linked and allocation cannot safely start, terminalize B as `failed_before_alias` with the wrapper unmoved. Never submit a prompt from B. |
| `materialize_receipt_linked` | Linked state-machine-A receipt ID, receipt lookup key, wrapper facts, last observed receipt phase/outcome, native ID only if receipt has verified it | Re-acquire both the migration lease and, only through the receipt service, the receipt lease. B observes A rather than applying A transitions. If A is pre-submit resumable, let A resume/terminalize under A's rules. If A reaches `failed_before_submit`, advance B to `failed_before_alias` with wrapper unmoved and no alias, even if A had allocated a native ID before failing. If A reaches `prompt_submission_observed`, `first_assistant_committed`, `completed`, `failed_after_submit`, or `submission_unknown` with a verified native ID, advance B to `native_ready_for_alias`. If A is `submission_unknown`, keep the old first-send idempotency key bound to stable `SUBMISSION_UNKNOWN`, expose only canonical-session recovery, and never auto-resubmit. If A is `abandoned` or `deleted`, advance B to `abandoned` or `deleted`. |
| `native_ready_for_alias` | Verified canonical native ID/header, wrapper facts, `SessionCtx`, linked receipt ID/outcome if any | Revalidate native header and wrapper under the migration lease. Prepare old-visible-ID -> native-ID alias only for matching scope. If validation fails before alias persistence, advance to `conflict` or `failed_before_alias`; wrapper remains in place/no-move. |
| `alias_prepared` | Alias write intent, previous metadata hash, canonical native ID, old visible ID, fence/owner token | Commit the alias atomically with owner/fence check. Restart retries the same alias write; it must not create a different native ID or touch the first-send receipt. If alias cannot be safely committed, advance to `failed_before_alias` and leave the wrapper in place. |
| `alias_activated` | Durable alias old visible ID -> native ID, metadata/index hash, fence/owner token | Alias resolution must work before any wrapper move. Restart verifies the alias and advances to `wrapper_backup_prepared`. If backup cannot proceed, advance to `failed_after_alias`; the alias remains durable and old IDs must still resolve. |
| `wrapper_backup_prepared` | Validated source wrapper, target backup path/tmp path, wrapper hash, backup collision checks, fence/owner token | Complete the same backup/copy/rename sequence idempotently. Restart verifies temp/final backup hashes and either advances to `wrapper_backup_committed` or retries the prepared move. If validation fails after alias activation, advance to `failed_after_alias` and preserve alias resolution. |
| `wrapper_backup_committed` | Final backup ref outside Pi scanning, verified hash/size, source move/unlink status, durable alias | Restart verifies backup and source absence/presence according to same-filesystem or cross-device rules, then advances to `metadata_materialized`. It must not recreate wrappers. If repair is impossible, advance to `failed_after_alias` with alias durable and backup/source artifacts preserved. |
| `metadata_materialized` | Metadata lifecycle update to `materialized`, alias set, backup ref, unresolved first-send outcome if A is `submission_unknown`/`failed_after_submit`, capability state | Restart revalidates metadata/native header/alias/backup and advances to `complete`. If metadata cannot be verified but alias exists, advance to `failed_after_alias` for repair without wrapper recreation. Rename remains false until the separate first-assistant/post-commit header rule passes. |
| `complete` | Final metadata hash, alias, backup ref, journal completion timestamp | Terminal success. Restart may compact/retain the journal but performs no first-send or wrapper side effects. |
| `legacy_read_only_no_move` | Red fence reason and wrapper facts | Quiescent no-move outcome while the deployment fence is red. Wrappers remain in place and readable through compatibility paths. A later green fence starts a new lease/journal attempt rather than stealing this phase. |
| `blocked_by_fence` | Fence failure reason before side effects | Terminal blocked outcome for that attempt. No alias, backup, or first-send side effect may run. |
| `failed_before_alias` | Failure reason before durable alias activation | Terminal automatic outcome. Wrapper remains in Pi scanning/compatibility or quarantine; no native alias is trusted unless explicitly recorded by a completed state-machine-A receipt. User retry starts a new explicit materialize/migration attempt with a new idempotency key where required. |
| `failed_after_alias` | Failure reason after durable alias activation | Repair-required terminal outcome for automatic foreground migration. Old visible ID must continue resolving to the canonical native ID; recovery batches may resume backup/metadata repair under a new lease but must not resubmit prompts or recreate wrappers. |
| `abandoned` | Explicit user abandon of unresolved materialization/migration attempt | Terminal UI dismissal. Does not delete native transcript, aliases, backups, or wrapper artifacts and never resubmits the first prompt. |
| `deleted` | Explicit user delete/tombstone | Terminal delete semantics. Tombstone old visible ID/native ID according to delete rules and never resubmit or rematerialize automatically. |
| `conflict` | Stable validation/auth/scope/path/header conflict facts | Terminal conflict until explicit operator/user resolution. Preserve wrapper/source/backup artifacts; do not manufacture a native transcript. |

Rules:

- A quarantined wrapper with no trusted native target may become native only through explicit user first-send/materialize action using the same trusted scope and idempotency rules as new drafts, but the wrapper migration journal remains state machine B and only links to state machine A.
- The transition must acquire the same local single-host locks or hosted transactional fenced lease as normal migration before linking a receipt, preparing an alias, backing up a wrapper, or updating metadata.
- The native ID/header is written by the Slice 0-proven Pi path only through state machine A. Product code must not fabricate a native transcript.
- Before submitting the prompt, state machine A persists prompt intent plus the operation correlation marker through the Slice 0-proven Pi path. If that marker path is unavailable, the explicit no-native materialize transition is blocked rather than attempting best-effort exact-once behavior.
- The B journal records `idempotencyKey`, prompt hash, server-derived `SessionCtx`, linked A receipt ID, native ID only after A verifies it, wrapper hash/size/mtime, alias state, backup state, first-send outcome only as observed from A, lease/fencing token, abandon/delete/conflict state, and first-assistant commit/capability state. It does not store raw draft tokens, transcript messages, Pi model state, or A phases as B phases.
- If B recovery observes a linked A receipt at `prompt_submission_started` or later, recovery is observation-only for that first prompt through A: A must inspect the correlation marker/native transcript/prompt-run/stream state, advance to `prompt_submission_observed` when conclusive or terminal `submission_unknown` when inconclusive, and never auto-resubmit. B may continue alias/backup only with the verified canonical native ID and must preserve the old key's stable `SUBMISSION_UNKNOWN` behavior when applicable.
- Alias activation occurs only after linked-native validation has verified the native header, or for a no-native materialize transition after A has reached `prompt_submission_observed`, `first_assistant_committed`, `completed`, `failed_after_submit`, or `submission_unknown` with a verified native header. The session remains `renameable=false` until `first_assistant_committed` and a post-commit native header verification pass.
- Wrapper backup/move occurs only after alias activation or in the same committed transaction/phase, so either the old visible ID resolves or the wrapper still exists. Recovery after alias-before-backup completes or repairs the backup; recovery after backup-before-complete preserves alias resolution and marks metadata materialized only after verification.
- Failures before alias activation leave the record in legacy compatibility/quarantine or `failed_before_alias` with the wrapper unmoved. Failures after alias activation keep the alias durable and complete/repair backup on recovery. No recovery path invents a replacement native transcript or auto-resubmits an uncertain prompt.

### Collision/conflict policy

- Native session title wins when present.
- Wrapper-only real title is a one-time migration candidate.
- Multiple wrappers pointing to one native ID merge aliases only when scopes are compatible.
- Scope conflicts become stable migration conflicts; do not guess.
- A missing/corrupt native target preserves wrapper source or backup and yields an explicit `legacy-wrapper-no-native` or repair-required/conflict migration state; do not manufacture a replacement transcript.

## Durable/raw session-ID consumer inventory

Implementation must audit and update every durable/raw consumer below. Each store/cache needs an alias migration test: old wrapper ID resolves to canonical native ID, canonical writes use native ID, and no component recreates a wrapper. Every consumer that can render or execute rename must use the server `capabilities.materialized/renameable` contract; every consumer that sees a draft token must keep it client/in-memory only and must not persist or route it as a session ID.

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
  - Required draft regression: open/switch/include-active/load/restart routes reject `draft:*` tokens and do not create Pi handles/channels/event streams/metadata.

### Frontend/session UI

- `packages/agent/src/front/chat/session/activeSessionStorage.ts`
  - `boring-agent:v2:<scope>:activeSessionId` localStorage.
- `packages/agent/src/front/chat/session/usePiSessions.ts`
  - opaque server-issued draft token lifecycle, ephemeral empty-chat handling, active-session resolution, switch/rename/delete URLs, include-active query, consuming `capabilities.materialized/renameable`, and hiding the existing rename control until materialization.
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

1. **Phase A — expand/read both:** ship alias resolver, private metadata adapter, native discovery read path, mandatory process-local `DraftRegistry`, durable materialization-operation receipt/journal scaffolding, `materialize-and-send` endpoint scaffolding, canonical `SessionCtx` propagation, `SUBMISSION_UNKNOWN` recovery semantics, and server `materialized/renameable` capabilities. New-session creation remains legacy unless Slice 0 is green. No wrapper moves yet.
2. **Phase B — native new sessions local direct:** enable `native-local` only for new local direct sessions using fixed composition-owned local scope and no HTTP-header scope authority. Legacy sessions continue to resolve by wrapper ID/native alias. Hosted remains off.
3. **Phase C — migrate local legacy wrappers:** only after the wrapper-move deployment readiness/capability fence is green: all running writers are current, metadata root/local single-host lock mode is available, native-mode read path is proven, alias read path is proven, and rollback targets are compatible. If the fence is not green or shared multi-host storage is detected, stay legacy read-only/no-move. Old wrapper-only binaries are no longer valid rollback targets. `legacy-wrapper-no-native` remains compatibility/no-move until explicit materialize transition or delete.
4. **Phase D — hosted adapter and hosted legacy fence:** before any shared legacy reader is deleted, hosted deployments must either (a) prove no hosted legacy wrappers exist, or (b) run a host-owned migration/fence that covers Core workspace membership authorization, transactional DB journal/lease/fencing, wrapper aliases, no-native legacy state, restart/runtime replacement, and rollback without local metadata authority or POSIX/file pretend-CAS.
5. **Phase E — contract:** after local plus hosted retention/telemetry/fences are accepted, remove wrapper creation first, then remove legacy readers in a separate final contraction. Legacy reader deletion is forbidden before Phase D is green.

Rollback at any phase uses the latest compatible code with feature flags disabled, not pre-migration wrapper-only code. Rollback must not recreate wrappers for native sessions or migrated aliases. If native creation must be disabled, existing native sessions remain readable/deletable through native ID and aliases; if legacy reader contraction has not passed Phase D/E, legacy readers remain enabled.

## Delete semantics

Delete is an explicit user action and is separate from migration backup retention.

- **Native materialized session:** resolve alias to canonical native ID, abort/dispose live handles, close/release event/metering/ask-user state, delete or host-trash the native Pi transcript according to the existing explicit-delete policy, delete metadata or mark `deleted` tombstone, mark any materialization receipt for that native ID `deleted`, and remove active/open UI references.
- **`SUBMISSION_UNKNOWN` abandon:** explicit abandon on the canonical native session marks only the unresolved materialization receipt `abandoned`, clears/hides the unknown recovery affordance, and leaves the native transcript/session, metadata, aliases, backups, and old idempotency-key binding intact. It does not submit, cancel, truncate, rename, or delete anything. If Pi later produces transcript content for that operation, reload/list shows the actual native transcript and normal capability rules apply.
- **`SUBMISSION_UNKNOWN` delete:** explicit delete resolves to the canonical native ID and then applies native materialized delete semantics. The old materialize idempotency key remains consumed and future same-key `materialize-and-send` retries return deleted/not-found (or the deployment's stable deleted tombstone response) and never resubmit.
- **Empty unsent chat:** discard ephemeral UI state only; no Pi handle/channel/event stream/native file/private metadata/journal/backup/pending-title exists and none is created.
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
- [ ] Prove or reject native ID injection/recreation before materialization through the real resolved Pi SDK.
- [ ] Prove or reject a Pi-supported pre-submit prompt intent + operation correlation marker path that survives restart and is observable before any first-prompt submission.
- [ ] Prove or reject materialized-session title rename through the real resolved Pi SDK.
- [ ] Prove standalone Pi CLI can resume/list the same native directory via `--session-dir` or `PI_CODING_AGENT_SESSION_DIR`.
- [ ] Record one explicit output: `supported-native-id`, `supported-fallback`, or `blocked-no-support`.
- [ ] Until the artifact is accepted with `supported-native-id` or `supported-fallback`, Slices 1+ remain forbidden and the plan state stays `needs-info`/blocked for implementation beyond Slice 0.

### Native local direct behavior

- [ ] New local direct materialized Pi session uses one native ID for Boring route/UI state and Pi header/transcript.
- [ ] Boring creates no `.jsonl` wrapper or `pi_session_file` marker in Pi's scanned session directory in native mode.
- [ ] Before native materialization, the existing rename control is hidden; no draft label, explanatory copy, or separate draft UI is added.
- [ ] Pre-send identity uses only an opaque server-issued draft token plus mandatory process-local `DraftRegistry` authority bound to server-derived `SessionCtx`; no server/native session ID is allocated before first prompt.
- [ ] First prompt uses `POST /api/v1/agent/pi-chat/materialize-and-send` with `{ draftToken, idempotencyKey, prompt }`; per-token consumption is atomic; no draft route/outbox/stream remapping exists; a durable scoped materialization-operation receipt maps draft-token hash + idempotency key + prompt hash + scope to native ID/state after materialization begins; every durable phase in the closed enum is lease/fence checked; pre-submit phases are idempotently resumed or terminalized under lease; prompt intent plus operation correlation marker is persisted through the Slice 0-proven Pi path before submission; response-loss retry reconnects/returns the same native session/stream without duplicate prompt when observable; concurrent consumption returns stable result/error; stale unsent drafts fail closed after reload/restart/TTL.
- [ ] Crash/restart between prompt submission and conclusive observation resolves `prompt_submission_started` by inspecting correlation/transcript/run/stream state, then advances to `prompt_submission_observed` or stable `SUBMISSION_UNKNOWN`; it never remains in-progress forever, binds the old idempotency key to that status, never auto-resubmits, returns the canonical native session ID, opens that canonical session in unknown state, and exposes safe user recovery only through explicit `POST /api/v1/agent/pi-chat/:sessionId/prompt` with the canonical native session ID and a new idempotency key, abandon, or delete.
- [ ] `capabilities.materialized=true` is set only from a trusted durable native header/session ID; `capabilities.renameable=true` is set only after the trusted first assistant message is committed and the native header is verified again. Early receipt/stream-open/prompt-accepted flags never enable rename.
- [ ] After the first trusted assistant response commit, the existing rename control appears because `capabilities.renameable=true`, and renaming writes exactly one native `session_info`.
- [ ] Every rename surface and rename route consumes/re-checks the server `materialized/renameable` capability; `turnCount` and early materialization receipts are not used as proof of renameability.
- [ ] Standalone `pi --session-dir "$nativeSessionDir" --resume` shows one session, with the Boring title and transcript.
- [ ] Empty unsent Boring chats are not durable, are not renameable, are not restored after reload/restart, and never appear as phantom Pi sessions.
- [ ] Empty-chat create/open/switch/include-active/reload/restart leaves native, metadata, journal, backup, and event-stream roots unchanged and creates no Pi handle/channel.
- [ ] Native discovery admits only authorized/local direct sessions per the admission rules and never creates wrappers.
- [ ] Hosted remains off until a separately complete host-owned adapter lands.

### Migration/compatibility behavior

- [ ] Existing wrapper-linked sessions migrate idempotently without migration-time user-data deletion; wrapper files are moved to private legacy backup outside Pi scanning.
- [ ] Existing wrapper pending titles are handled only as migration compatibility data and are never used to make new empty chats renameable or durable.
- [ ] Existing wrapper-only/no-native sessions enter `legacy-wrapper-no-native` compatibility/no-move state and are not migrated, renamed, or materialized without a trusted native target or explicit delete.
- [ ] No wrapper move can run unless the deployment readiness/capability fence is recorded green; if not green, legacy read-only/no-move behavior is enforced.
- [ ] Migration validates realpath/lstat, regular-file/no-symlink status, canonical containment, wrapper pointer, native header ID, and no-follow handles before every read/write/backup/move.
- [ ] Metadata root, journals, backups, temps, and event streams are outside Pi scanning, non-overlapping, restrictive-mode, ownership-checked, no-follow, and collision-safe.
- [ ] Migration journal/lock recovery covers interruption before alias, after alias before move, after move before complete, and stale locks using local single-host owner tokens or hosted DB lease/fencing. Local migration rejects shared multi-host volumes instead of relying on POSIX pretend-CAS.
- [ ] Active session persistence, open panes, DebugDrawer session-keyed state, event streams, queued work, metering, tool context, pending questions/ask-user, attention/inbox, workspace bridge tokens/idempotency, and credits/telemetry resolve aliases/native IDs correctly during migration.
- [ ] Metadata authorization uses `SessionCtx` from the trusted source for the deployment: local direct fixed composition-owned scope with no HTTP-header authority, or hosted authenticated Core workspace membership resolver. Unknown or conflicting scope fails closed before metadata/native reads.
- [ ] Mixed-version deployment supports per-session modes and rollback to compatible code without legacy wrapper recreation.
- [ ] Hosted legacy-wrapper migration/fence or proof of no hosted legacy data is accepted before any shared legacy reader deletion.
- [ ] Explicit `legacy-wrapper-no-native` materialize transition is implemented/tested as state machine B: migration journal phases stay separate from state-machine-A receipt phases, include `materialize_requested`, `materialize_receipt_linked`, `alias_prepared`, `alias_activated`, `wrapper_backup_prepared`, `wrapper_backup_committed`, `metadata_materialized`, and `complete`, define restart/lease recovery or terminal outcome for every B phase, preserve A's pre-submit prompt intent/correlation marker and no-auto-resubmit rules through the linked receipt, preserve stable `SUBMISSION_UNKNOWN`/canonical-session recovery when A is inconclusive, and keep renameability false before first assistant commit.
- [ ] Delete/abandon semantics are implemented/tested for native, `SUBMISSION_UNKNOWN` abandon/delete, ephemeral unsent, legacy compatibility/no-native pending, legacy alias, backup, and conflict states.
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
# Agent server/native identity and first-send materialization.
pnpm --filter @hachej/boring-agent exec vitest run \
  src/server/harness/pi-coding-agent/__tests__/createHarness.test.ts \
  src/server/harness/pi-coding-agent/__tests__/sessions.test.ts \
  src/server/harness/pi-coding-agent/__tests__/piSdkCompatibility.test.ts \
  src/server/harness/pi-coding-agent/__tests__/legacyNoNativeMaterialization.test.ts \
  src/server/pi-chat/__tests__/harnessPiChatService.test.ts \
  src/server/pi-chat/__tests__/piSessionIdentity.test.ts \
  src/server/pi-chat/__tests__/draftRegistry.test.ts \
  src/server/http/routes/__tests__/piChatMaterializeAndSend.test.ts

# Required first-send retry/concurrency/no-native cases by name.
pnpm --filter @hachej/boring-agent exec vitest run \
  src/server/http/routes/__tests__/piChatMaterializeAndSend.test.ts \
  src/server/pi-chat/__tests__/draftRegistry.test.ts \
  src/server/harness/pi-coding-agent/__tests__/legacyNoNativeMaterialization.test.ts \
  -t "materialize-and-send response loss retry|materialization receipt phase recovery|submission started terminalizes|concurrent draft consumption|submission unknown recovery|submission unknown existing-session retry|legacy-wrapper-no-native materialize transition"

# Frontend capability + alias regressions.
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

- resolved Pi SDK version/API gate and accepted Slice 0 compatibility artifact, including the pre-submit prompt intent + operation correlation marker path;
- wrapper-move deployment readiness/capability fence, including legacy read-only/no-move when the fence is red;
- mandatory process-local `DraftRegistry`, server-derived scope binding, restart/TTL fail-closed behavior, and no draft persistence;
- `POST /api/v1/agent/pi-chat/materialize-and-send` schema, state machine, per-token atomic consumption, durable scoped materialization-operation receipt creation before Pi prompt submission, closed receipt phase enum, lease/fence checked updates, receipt lookup after server restart by draft-token hash/idempotency key/prompt hash/scope, pre-submit phase re-drive/terminalize for `operation_receipt_created`, `native_allocated`, `prompt_intent_persisted`, `native_header_verified`, `operation_receipt_bound`, and `stream_allocated`, response-loss retry returning/reconnecting the same native session/stream without duplicate prompt when observable, `prompt_submission_started` recovery that inspects correlation/transcript/run/stream state and terminalizes to `prompt_submission_observed` or `SUBMISSION_UNKNOWN`, stable concurrent consumption result/error, and stable `SUBMISSION_UNKNOWN` with no auto-resubmit when submission cannot be conclusively observed;
- same native ID before/after materialization;
- native title exactly once after rename-after-materialization;
- server `capabilities.materialized/renameable` threaded to every rename surface and re-checked by rename routes, with renameable false until trusted first assistant commit plus post-commit native header verification;
- no wrapper JSONL, private pending-title metadata, journal, backup, event-stream file, Pi handle, or pi-chat channel created for a new empty unsent Boring chat;
- exact ephemerality proof: native, metadata, journal, backup, and event-stream root snapshots unchanged after empty create/open/switch, reload, and process restart;
- exact standalone directory contract helper/diagnostic;
- native discovery admission/auth/conflict rules with `SessionCtx`: local direct fixed composition-owned scope without HTTP-header authority, hosted Core workspace membership resolver when hosted opt-in exists, and trusted-local-only metadata authority;
- migration path validation for realpath/lstat, regular file/no symlink, no-follow open, header ID, and containment before reads/writes/backups;
- private metadata filesystem security: non-overlap, ownership/modes, no-follow atomic writes, collision-safe backups/temps;
- empty unsent chat reload/restart non-durability and legacy pending-title/no-native compatibility handling;
- crash-safe journal/idempotency/recovery phases with local single-host owner-token locks and hosted DB lease/fencing adapter; shared multi-host POSIX/file-lock migration rejection;
- explicit `legacy-wrapper-no-native` materialize transition journal states using state-machine-B phases (`materialize_requested`, `materialize_receipt_linked`, `alias_prepared`, `alias_activated`, `wrapper_backup_prepared`, `wrapper_backup_committed`, `metadata_materialized`, `complete`), a linked state-machine-A receipt for first-send work, explicit restart/lease recovery or terminal outcome for every B phase, stable `SUBMISSION_UNKNOWN` canonical-session recovery when A is inconclusive, and no auto-resubmit after crash/retry;
- alias resolution for every consumer in the inventory, including frontend capability rendering, workspace panes/menus, plugin-created controls, ask-user pending/answer/cancel, and DebugDrawer session-keyed state/system-prompt fetches;
- mixed-mode deployment/rollback with no wrapper recreation;
- hosted legacy-wrapper migration/fence before legacy reader deletion;
- delete/abandon semantics for native, `SUBMISSION_UNKNOWN` abandon/delete, empty unsent, legacy compatibility/no-native pending, alias, backup, conflict;
- hosted adapter injection remains required/off.

### Manual proof (required)

For a clean temporary Pi native session directory and the same cwd:

1. Start Boring local direct with a known `nativeSessionDir`, metadata root, journal root, backup root, and event-stream root outside Pi scanning. Record recursive file manifests plus hashes/mtimes for all five roots before empty-chat creation.
2. Create an empty Boring chat and assert the existing rename control is hidden with no draft label, explanatory copy, or separate draft UI; inspect server diagnostics/log counters to assert no Pi handle/channel/event stream was allocated and only an opaque draft token plus process-local `DraftRegistry` entry exists.
3. Re-record the five root manifests and assert they are byte-for-byte unchanged: native, metadata, journal, backup, and event-stream roots all match the pre-create snapshot.
4. Run:

```bash
cd "$runtimeCwd"
pi --session-dir "$nativeSessionDir" --resume
```

5. Assert no empty phantom entry exists.
6. Reload the browser and restart the Boring server before sending a prompt; assert the stale draft is discarded, no durable session is restored, and the five root manifests remain unchanged after reload and after restart.
7. Send a prompt from a fresh draft through `POST /api/v1/agent/pi-chat/materialize-and-send`; assert the durable materialization-operation receipt exists before Pi prompt submission and maps draft-token hash + idempotency key + prompt hash + scope to native ID/state. In separate runs, restart at each pre-submit receipt phase (`operation_receipt_created`, `native_allocated`, `prompt_intent_persisted`, `native_header_verified`, `operation_receipt_bound`, `stream_allocated`) and assert recovery acquires the lease, resumes or terminalizes that phase idempotently, reuses the same native/operation IDs once allocated, and does not submit more than once.
8. Drop the first HTTP response after the server records prompt submission; retry with the same `draftToken`/`idempotencyKey`/prompt; assert the response reconnects to the same native session/stream with no duplicate user prompt when submission is observable. Restart at the crash window after `prompt_submission_started` but before conclusive observation; retry with the same `draftToken`/`idempotencyKey`/prompt; assert recovery inspects correlation/transcript/run/stream state, terminalizes to `prompt_submission_observed` or stable `SUBMISSION_UNKNOWN`, never remains in-progress forever, never auto-resubmits, returns the canonical native session ID, opens the canonical session in unknown state with `renameable=false`, and old key keeps returning `SUBMISSION_UNKNOWN`. Then deliberately send a new prompt with a new idempotency key through `POST /api/v1/agent/pi-chat/:sessionId/prompt` using the canonical native session ID, not `materialize-and-send`; separately prove abandon clears only the unknown affordance and delete tombstones the canonical native session without resubmitting.
9. Race two first-send requests for the same draft: same `idempotencyKey` returns the same in-progress/result/unknown; different `idempotencyKey` or prompt returns stable consumed error and does not submit a second prompt.
10. Await the first materialization/stream response, assert the client switches atomically from draft token to native ID, assert no draft route/outbox/stream was persisted/remapped, assert `materialized=true` only after native header verification, assert rename remains hidden until trusted first assistant commit plus post-commit header verification, then rename the session and click outside to save.
11. Run the same standalone Pi command; assert one entry only, with the chosen title and transcript.
12. Run migration on copied wrapper/native fixtures and wrapper-no-native fixtures; interrupt at each journal phase in separate runs; assert recovery leaves no migrated JSONL wrapper in the Pi session directory, aliases still resolve, no-native wrappers remain compatibility/no-move until the explicit materialize transition, and all local moves used validated paths plus single-host owner-token locks.
13. For a wrapper-no-native fixture, perform the explicit materialize transition with response-loss retry and the crash-window retry; assert journal states use state-machine-B phases separate from the linked state-machine-A receipt, every B phase has explicit restart/lease recovery or terminal outcome, A persists pre-submit prompt intent/correlation marker and terminalizes `prompt_submission_started` to `prompt_submission_observed` or `SUBMISSION_UNKNOWN`, B performs alias activation and wrapper backup recovery without applying A transitions as B phases, stable `SUBMISSION_UNKNOWN` uses canonical-session recovery, and no path auto-resubmits; then prove canonical-session existing-endpoint retry with a new idempotency key, abandon/delete semantics, `materialized=true` only from native header, and `renameable=true` only after trusted first assistant commit.
14. Create an ask-user pending question on a legacy session fixture, migrate, then answer/cancel from the native session UI and assert one cleared pending state.
15. Delete native, `SUBMISSION_UNKNOWN`, empty unsent, legacy compatibility/no-native pending, alias, and migrated sessions; assert Boring and standalone Pi visibility match delete semantics.
16. Before deleting any legacy reader in a test/staging deploy, record hosted fence proof: either no hosted legacy wrappers exist or host-owned migration/auth/restart/rollback has passed.

## Slices

### Slice 0: Pi SDK compatibility and shared-directory spike

**Delivers:** A small compatibility harness plus the accepted `docs/issues/709/slice-0-compatibility.md` artifact proving the actual resolved Pi package version, exact native ID injection/recreation API or exact supported fallback, exact pre-submit prompt intent + operation correlation marker API/call sequence, exact materialized-session title API/call sequence, and standalone CLI shared-directory contract. Reconciles the `0.75.5` package pin vs `0.80.3` root override by either aligning the dependency or explicitly blocking native-ID work.

**Blocked by:** None.

**Proof:** Real SDK tests plus a clean temp `pi --session-dir "$nativeSessionDir" --resume` manual check, both recorded in the Slice 0 artifact. No product behavior changes beyond tests/docs/package metadata if required by the spike.

**Exit rule:** Slices 1+ are forbidden until the Slice 0 artifact is accepted with `supported-native-id` or `supported-fallback`. If the artifact records `blocked-no-support`, implementation stops and this plan returns to `needs-info`/blocked instead of starting Slice 1.

**Review budget:** Inside. This is a bounded compatibility spike and gate.

### Slice 1: Draft-to-native materialization and private metadata foundation (local direct only)

**Delivers:** New local direct materialized chats use native Pi IDs; pre-send chats use only opaque server-issued draft tokens plus mandatory process-local `DraftRegistry` authority bound to server-derived `SessionCtx`; `POST /api/v1/agent/pi-chat/materialize-and-send` performs atomic first-send materialization with `{ draftToken, idempotencyKey, prompt }`, durable scoped materialization-operation receipt/journal creation once materialization begins, closed receipt phases with lease/fence checked updates, pre-submit phase idempotent resume/terminalization, pre-submit prompt intent + operation correlation marker persistence through the Slice 0-proven Pi path, response-loss retry/reconnect when observable, `prompt_submission_started` observation-only recovery to `prompt_submission_observed` or stable `SUBMISSION_UNKNOWN`, exact `SUBMISSION_UNKNOWN` UI/user recovery through the canonical native session and `POST /api/v1/agent/pi-chat/:sessionId/prompt` for any deliberate retry, abandon/delete semantics, and stable concurrent consumption semantics; empty unsent chats remain ephemeral and non-renameable with no private pending-title metadata, journal, backup, event stream, Pi handle, channel, or persisted draft authority before first send; no new wrappers are created; hosted remains off.

**Blocked by:** Slice 0 supported native-ID path or supported fallback.

**Proof:** Unit/service tests plus clean-root manual Boring + `pi --session-dir "$nativeSessionDir" --resume` test, including exact root-manifest ephemerality proof before/after empty create, reload, and restart; first-send receipt durability and restart lookup; restart at every pre-submit receipt phase with lease resume/terminalize; response-loss retry; `prompt_submission_started` recovery that terminalizes to `prompt_submission_observed` or `SUBMISSION_UNKNOWN` with no indefinite in-progress state; `SUBMISSION_UNKNOWN` canonical-session UI, existing-session-send retry, abandon, and delete behavior; concurrent consumption same-key/different-key behavior; and no duplicate prompt when submission is observable.

**Review budget:** High. This changes identity at route/harness/UI seams.

### Slice 2: Native-only list/load/rename/delete, capabilities, and discovery admission

**Delivers:** Boring lists/loads native transcripts directly, enforces native discovery admission/auth rules with canonical `SessionCtx` and trusted-local-only metadata authority, handles native/empty-unsent/legacy-compatibility delete semantics, exposes `capabilities.materialized/renameable` through summaries/loads/streams, distinguishes durable native-header materialization from renameability, gates every rename surface and route so renameable becomes true only after trusted first assistant commit plus post-commit native header verification, and removes new-code reliance on `pi_session_file` for native mode.

**Blocked by:** Slice 1.

**Proof:** Browser/session switch/restart/delete tests; title/transcript/delete parity with standalone Pi; discovery conflict/auth tests; rename capability tests across agent UI, workspace surfaces, plugin controls, and routes proving early receipt/stream-open does not enable rename.

**Review budget:** High. Cross-layer migration and local security boundary.

### Slice 3: Consumer alias migration inventory

**Delivers:** API-boundary canonicalization and per-store migration/alias tests for all durable/raw consumers: front active/open panes, DebugDrawer session-keyed state/system-prompt fetches, workspace panes/menus/capabilities, plugin-created controls, event streams, metering, core send locks/context, workspace bridge tokens/idempotency, credits/telemetry, ask-user, attention/inbox, and pending tool/follow-up state.

**Blocked by:** Slice 2.

**Proof:** Per-store tests proving old ID resolves to native ID, canonical writes use native ID, and aliases can expire without data loss.

**Review budget:** High. Broad compatibility and data integrity.

### Slice 4: Legacy wrapper migration with validated paths and fenced journal/backup

**Delivers:** Existing wrapper-linked sessions migrate safely to private backup/index, wrapper IDs resolve to native IDs during retention, and no migrated wrapper remains visible to Pi. Includes migration-specific realpath/lstat/no-symlink/header-ID/containment validation before all reads/writes/backups, private metadata filesystem hardening, local single-host owner-token locks with shared multi-host rejection, hosted/shared DB lease/fencing adapter contract, journal/recovery implementation, `legacy-wrapper-no-native` compatibility/no-move state, explicit no-native materialize transition, and the wrapper-move deployment readiness/capability fence.

**Blocked by:** Slice 3 plus a green wrapper-move fence: all running writers current, metadata root/lock mode available, native-mode read path proven, alias read path proven, and compatible rollback confirmed. If the fence is red or local deployment cannot prove single-host exclusivity, Slice 4 may only enforce legacy read-only/no-move.

**Proof:** Fixture migration tests, path-validation/security tests, idempotency/interruption/local-owner-lock/hosted-fence-recovery tests, shared multi-host rejection tests, no-native wrapper explicit materialize-transition tests covering separate B journal phases linked to state-machine-A receipt recovery, explicit restart/lease handling for every B phase, and `prompt_submission_observed`-or-`SUBMISSION_UNKNOWN` no-auto-resubmit semantics, copied-data manual standalone Pi verification.

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

1. Expand with Slice 0 compatibility proof, read-both alias scaffolding, draft-token materialization, and server rename capabilities.
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

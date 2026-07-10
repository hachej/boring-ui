# gh-579 composer dictation and long-form transcription

## Decision

Support two recording paths under one transcription system:

1. **Composer dictation** stays optimized for short prompts. The composer records a small blob, posts it for transcription, then inserts/sends the returned text.
2. **Long-form document recording** is a background recording tied to a markdown document. It continuously uploads audio chunks, stores auditable audio sidecars, transcribes chunks as they arrive, and appends/updates a transcript document. The target document can be an existing markdown file or a new markdown file created as part of starting the recording. Long recordings are entrypoint-agnostic: chat/agent, document toolbar, future plugin surfaces, or other capture channels all use the same document-recording backend contract.

Do not make long doctor/consultation recordings a single synchronous transcription request. Anything that runs long enough to be fragile in the composer must become a resumable background document recording with a persistent global status bar.

## UX model

### Short composer mode

- Composer gets a mic/dictation control.
- While recording, composer shows local state: `Recording… 00:42 [Stop] [Cancel]`.
- Recording uses the same short rolling `MediaRecorder` file strategy as long mode from the beginning, even for short composer dictation. Default chunk duration: 30–60 seconds.
- Before promotion, independently decodable chunk files stay in browser memory as a short-mode buffer.
- If the user stops before the long-recording threshold, the browser uploads the buffered chunk files to the short transcription endpoint and inserts/sends the resulting transcript.
- Short dictation accepts the same small inter-chunk recorder restart gap as long mode; this tradeoff preserves clean promotion handoff. If this proves too lossy for dictation, switch short mode to a single recorder until server-side normalization exists.
- Default promotion/hard-stop threshold comes from backend `inlineHardStopDurationMs` (example: 90 seconds) or backend-reported max inline audio size, whichever comes first. `inlineMaxDurationMs` is the absolute backend ceiling and must be higher than the client hard stop.

### Auto-promote to long recording

If a composer recording crosses the threshold:

- The app creates a document recording automatically.
- The user is informed immediately:
  - `Long recording started. Audio and transcript are being saved to recordings/<timestamp>-recording.md.`
- Promotion closes the current rolling recorder at a chunk boundary: wait for the current recorder's final `dataavailable`, include it as the last buffered chunk, and immediately start the next rolling recorder on the same persistent stream before any network round-trip.
- The browser continues buffering locally while `create-document-and-start` runs. Once the document recording id/token returns, it assigns deterministic indexes/timestamps (`index=0...n`, `startMs/endMs` from original capture start) to all buffered chunks and uploads them; already-captured post-promotion chunks become the next indexes.
- Subsequent chunks are no longer composer-owned.
- The composer remains usable while the recording continues in the background.
- While any long recording is active, composer mic recording is capped to short mode: auto-promotion is suppressed and the UI must stop-and-transcribe-inline at the threshold or disable composer mic recording. It must not create a second long recording or orphan buffered chunks.
- If a race still causes `TRANSCRIPTION_RECORDING_ALREADY_ACTIVE` during promotion, the composer immediately closes the current rolling recorder, flushes buffered chunks to inline `/transcribe` if within capabilities, or shows an explicit `Could not save recording because another recording is active` error while preserving the buffered chunks for retry/download. It never silently drops them.

### Document recording mode

For intentional doctor/consultation transcription:

- Markdown editor/document screen exposes a **Record** button near the top of the document.
- Any trusted frontend entrypoint can create a new markdown file and start a recording directly, for example chat/agent UX, a future dedicated clinic surface, a plugin panel, or another capture channel. Example: `start a consultation recording for Jane Doe` creates `recordings/<timestamp>-jane-doe.md` then starts the document recording.
- Recording attaches to the current or newly created markdown file regardless of which entrypoint requested it.
- Transcript updates continuously as chunks finish.
- Audio chunks are saved next to the document for audit/re-transcription.

### Global recording bar

There is only one active long recording at a time. When active, a global bar appears across chat/workspace/plugins, below composer or above the mobile safe area:

```text
● Recording running  12:34
Saving to: consultation-2026-07-09.md
[Open transcript] [Pause] [Stop] [Cancel]
```

Required controls:

- **Open transcript**: opens the target markdown document from any app surface.
- **Stop**: stops MediaRecorder, uploads the final chunk, releases the active capture lock, and leaves the recording manifest `finalizing` while remaining chunks are transcribed, then marks the manifest `done`.
- **Cancel**: stops recording after confirmation. Audio already saved is kept by default for audit unless the user explicitly deletes it later.
- **Pause**: optional first release; if omitted, hide it rather than shipping a fake disabled control.

## File layout

If recording starts from an existing document:

```text
notes/consultation-2026-07-09.md
notes/consultation-2026-07-09.md.recording/
  rec_abc123/
    manifest.json
    consultation-2026-07-09-audio-000000-000060.webm
    consultation-2026-07-09-audio-000060-000120.webm
    chunk-000000-000060.md
    chunk-000060-000120.md
```

If a composer recording auto-promotes and there is no active document:

```text
recordings/2026-07-09-1530-recording.md
recordings/2026-07-09-1530-recording.md.recording/
  rec_def456/
    manifest.json
    2026-07-09-1530-recording-audio-000000-000060.webm
    chunk-000000-000060.md
```

Use browser-native `MediaRecorder` output (`webm`/`ogg` depending on support). Do not promise `.mp4` unless we add a conversion pipeline. Sidecar directory derivation appends `.recording` to the full filename without stripping extensions (`foo.md → foo.md.recording/`, `foo → foo.recording/`). Each recording owns a unique `recordingId` subdirectory under the document-adjacent `.recording/` folder; re-recording the same document appends a new managed transcript block and never overwrites older recording audio/manifests. If the sidecar path exists as a non-directory or otherwise conflicts with safe sidecar creation, fail with `TRANSCRIPTION_SIDECAR_PATH_CONFLICT` rather than overwriting.

## Chunk container strategy

Do not assume every `MediaRecorder.start(timesliceMs)` `dataavailable` blob is an independently decodable media file. For WebM/Opus, later blobs can depend on the initial container/header segment.

V1 strategy: **short rolling MediaRecorder files**. The client captures one persistent `MediaStream` with a single `getUserMedia` call, reuses that same stream/track for every rolling `MediaRecorder`, and stops the stream/track only on user stop/cancel/teardown, never at chunk boundaries. It records each chunk as an independent file by starting a recorder, stopping it at the chunk boundary, waiting for the final `dataavailable`, then immediately starting the next recorder. Each uploaded chunk must be independently decodable by the backend. The UI should treat the tiny recorder restart gap as acceptable for v1 doctor-note transcription; exact audio continuity/word-level sync is explicitly out of scope.

If later proof shows restart gaps are unacceptable, replace this with a server-side container-normalization strategy, but do not mix the two models in v1. The manifest, retry, resume, and re-transcription logic all assume independently decodable chunk files. Slice 9 proof must explicitly assess whether boundary loss is clinically acceptable for consultation recordings.

Because rolling recorder boundaries are driven from the browser main thread, background throttling can stretch a target 60s chunk. V1 must enforce a conservative maximum chunk duration/size budget and the STT adapter must tolerate chunks longer than `chunkDurationMs`; if real background-tab proof cannot bound chunk size safely, unattended long capture is disabled or requires a keep-awake/foreground UX until server-side normalization lands.

## Audio ingestion contract

The frontend must choose the first MIME type in the intersection of backend-advertised types and `MediaRecorder.isTypeSupported(...)`. If the intersection is empty, the client must not start recording and surfaces stable client error `TRANSCRIPTION_NO_SUPPORTED_MIME` with the advertised list. For example:

```text
audio/webm;codecs=opus
audio/webm
audio/ogg;codecs=opus
audio/mp4   (only if the backend declares support)
```

The backend transcription adapter owns conversion into the format required by the STT engine. For local `whisper.cpp`, v1 should either:

- convert uploaded chunks server-side to mono 16 kHz WAV before calling `/inference`; or
- reject unsupported MIME types with a stable error (`TRANSCRIPTION_AUDIO_FORMAT_UNSUPPORTED`) and a supported-format list.

Acceptance proof must cover at least Chromium's `audio/webm` path. Safari/iOS support can ship behind the same advertised-MIME contract once the backend can ingest `audio/mp4`/`audio/aac` or a compatible fallback.

## Manifest

Each long recording owns a manifest:

```json
{
  "recordingId": "rec_abc123",
  "documentPath": "notes/consultation-2026-07-09.md",
  "recordingStartedAt": "2026-07-09T14:00:00Z",
  "status": "recording",
  "ownerId": "owner_browser_session_123",
  "ownerTokenHash": "sha256:...",
  "lastHeartbeatAt": "2026-07-09T14:12:00Z",
  "managedBlockOwner": "backend",
  "leaseHolderId": null,
  "editorLeaseExpiresAt": null,
  "chunks": [
    {
      "index": 0,
      "startMs": 0,
      "endMs": 60000,
      "audioPath": "notes/consultation-2026-07-09.md.recording/rec_abc123/consultation-2026-07-09-audio-000000-000060.webm",
      "transcriptPath": "notes/consultation-2026-07-09.md.recording/rec_abc123/chunk-000000-000060.md",
      "status": "transcribed"
    }
  ]
}
```

The manifest is the per-recording recovery source of truth. Lock state (`ownerId`, `lastHeartbeatAt`, `status`) lives in `manifest.json` and is written through the same per-recording single writer/atomic rename path as chunk status updates. On restart, the backend skips chunks already transcribed and resumes pending chunks.

The one-active-recording lock is specifically a one-active-capture lock. It has a workspace-global pointer file, for example `.transcription/active.json`, written via the plugin's same-directory temp-file + `fs.rename` helper through a workspace-global single writer. It stores `{ recordingId, documentPath, ownerId, ownerTokenHash, lastHeartbeatAt, status }` for the current capture/start attempt only, and its status is limited to `starting | recording | interrupted`. `GET /document-recordings/active`, concurrent-start rejection, and stale lock release read this pointer rather than scanning every `.recording/` directory. Browser create starts as `starting` and reserves the active start attempt until the frontend sends the first heartbeat/chunk after mic permission. Agent preparation creates an unclaimed prepared recording/document but does not write `active.json` and does not reserve the one-active capture slot; the slot is reserved only when the browser successfully calls `claim-owner`. `starting` has a short grace timeout measured only from a fresh `startingSince` stamped at browser create/claim time and auto-cancels if capture never begins. `recordingStartedAt` is the capture-origin timestamp for chunks/transcript headings only and must never drive liveness or grace timers. First valid heartbeat or first valid chunk transitions `starting → recording`; only then does the longer `staleAfterMs` apply. Stop removes `active.json` immediately after owner validation and `lastIndex` recording, then records `finalizing` in the manifest/pending set only; interrupted stale-release transitions the pointer to read-only `interrupted`. `GET /active` may lazily transition an expired `starting` pointer by removing `active.json` and marking the manifest `cancelled`, or an expired `recording` pointer by marking it `interrupted` and releasing the capture lock; it never persists `cancelled` in `active.json` and never consumes/removes an already-`interrupted` pointer. An interrupted pointer remains until a new capture starts, explicit interruption acknowledgement/cleanup clears it, or the recording reaches a terminal manifest state. Cancel transitions the manifest to `cancelled` and removes the pointer. Concurrent-start rejection gates on `starting | recording`, but `starting` uses a much shorter timeout to avoid blocking the workspace when mic permission is never granted. Per-recording manifests can remain `finalizing` while transcription drains in the background, but they do not block starting a new capture.

Transcription/recovery tracking is separate from the active capture pointer. The plugin maintains `.transcription/pending.json`, a set of recording ids/document paths with non-terminal transcription/finalization state, plus an append-only `.transcription/recordings.log` index of committed recording manifest paths for cold-start recovery; append to the log after commit, and recovery skips log entries whose manifest is missing. Recordings are added when created and removed from pending only on fully terminal `done | failed | cancelled`. Before the transcription slice exists, stopped recordings remain `finalizing`/pending rather than `done`, so saved audio is not orphaned when chunk transcription lands. Restart recovery uses `pending.json`; if it is corrupt, recovery rebuilds from `recordings.log` and only falls back to a workspace-root bounded scan for `**/*.recording/*/manifest.json` if the log is also corrupt/missing. If recovery finds a pending manifest in `recording | stopping` with no matching live `active.json`, it treats capture as gone and transitions the manifest to `finalizing`, then resumes saved-chunk handling or exposes `TRANSCRIPTION_CHUNKS_MISSING` for holes.

Capture recovery is different from transcription recovery: browser audio capture cannot resume after tab close/refresh. The per-recording manifest lifecycle is:

- `ownerId`: browser recording-session id;
- `lastHeartbeatAt`: updated while MediaRecorder is alive;
- `status`: `starting | recording | interrupted | stopping | finalizing | done | failed | cancelled`.

The `active.json` capture pointer uses only `starting | recording | interrupted`; `stopping | finalizing | done | failed | cancelled` live only in the per-recording manifest and pending set. For staleness, `active.json.lastHeartbeatAt` is authoritative. Heartbeat and any liveness-renewing chunk PUT must update `active.json.lastHeartbeatAt` under the workspace-global writer when the pointer still references that recording; the manifest copy is advisory/recovery context.

If heartbeats stop past a timeout, backend marks the recording `interrupted`, releases the one-active-recording lock, and continues transcribing chunks already saved. Staleness is evaluated lazily on every recording-start attempt and active-recording status read; a periodic sweeper can be added later but is not required for v1 lock release. Interruption becomes terminal for that owner token only after `interruptedUploadGraceMs`; within that window the late-chunk reactivation/save rules in the ingestion contract apply. After the grace window, later heartbeat/chunk/stop/cancel calls from the stale owner return `TRANSCRIPTION_RECORDING_OWNER_MISMATCH` (or `TRANSCRIPTION_RECORDING_INTERRUPTED`) and must not append more audio. If a still-open client receives either response mid-capture, it must immediately stop MediaRecorder, preserve/report any unacknowledged retry-queue chunks, and show `Recording interrupted — recent audio may not have uploaded` rather than silently discarding buffered audio. Interrupted recordings then follow the same drain path as Stop: `interrupted → finalizing → done | failed` once saved chunks are processed, and are removed from `pending.json` on terminal state. The global bar should show `Recording interrupted. Saved audio is being finalized.` if the user reloads into an interrupted recording. Starting a new recording is allowed after interruption, but never silently appends to the old one.

## Transcript timestamp metadata

Every transcript segment should include passive timestamp metadata from the first implementation, even before building an audio/doc sync UI.

Use simple timestamp headings in markdown:

```md
# Consultation transcript

> Recording started: 2026-07-09 14:00

## 00:00–01:00

Patient reports...

## 01:00–02:00

Doctor asks...
```

These headings are useful on their own and preserve enough structure for later audio affordances:

- show an audio player under the document top bar when a recording manifest is linked;
- show which transcript segment is currently visible in the document;
- click a segment/timestamp to play the matching audio chunk;
- avoid exact word-level sync or moving play indicators in v1.

## API shape

Expose backend capabilities before recording starts:

```http
GET /api/v1/transcription/capabilities
```

Example response:

```json
{
  "inlineMaxDurationMs": 180000,
  "inlineHardStopDurationMs": 90000,
  "inlineMaxBytes": 16777216,
  "maxSingleChunkBytes": 8388608,
  "chunkDurationMs": 60000,
  "supportedMimeTypes": ["audio/webm;codecs=opus", "audio/webm"],
  "longRecording": { "enabled": true, "heartbeatIntervalMs": 10000, "staleAfterMs": 180000, "startingGraceMs": 90000, "preparedClaimGraceMs": 300000, "interruptedUploadGraceMs": 30000, "finalizeGraceMs": 300000 },
  "transcriptLease": { "ttlMs": 30000, "renewIntervalMs": 10000 }
}
```

Introduce the short transcription endpoint for composer snippets:

```http
POST /api/v1/transcription/transcribe
```

`inlineHardStopDurationMs` is the client stop/promotion trigger. `inlineMaxDurationMs` is the backend's absolute accepted duration ceiling and must exceed `inlineHardStopDurationMs` by at least the max chunk-duration budget/margin.

`/transcribe` accepts either one audio file or an ordered multipart set of short rolling chunk files. Multipart parts must include `index`, `startMs`, `endMs`, and `mimeType`; the backend transcribes each part independently in ascending `index` order, then concatenates the resulting text (never the audio bytes) into one transcript string for composer insertion/send. Capabilities must be set so one stretched-but-valid chunk can fit `maxSingleChunkBytes`; if short-only mode still receives `TRANSCRIPTION_REQUIRES_DOCUMENT_RECORDING` before promotion exists, the UI surfaces `Recording too long for dictation; please retry shorter or start document recording` and preserves the buffered chunks for download/retry rather than dropping them. Success returns `{ "text": "..." }`; overflow returns the stable error envelope with `TRANSCRIPTION_REQUIRES_DOCUMENT_RECORDING`.

Add long recording APIs:

```http
GET  /api/v1/transcription/document-recordings/active
POST /api/v1/transcription/document-recordings/attach
POST /api/v1/transcription/document-recordings/create-document-and-start
POST /api/v1/transcription/document-recordings/prepare-document
POST /api/v1/transcription/document-recordings/:recordingId/claim-owner
PUT  /api/v1/transcription/document-recordings/:recordingId/chunks/:index
POST /api/v1/transcription/document-recordings/:recordingId/heartbeat
GET  /api/v1/transcription/document-recordings/:recordingId
GET  /api/v1/transcription/document-recordings/:recordingId/transcript
POST /api/v1/transcription/document-recordings/:recordingId/transcript-lease/acquire
POST /api/v1/transcription/document-recordings/:recordingId/transcript-lease/renew
POST /api/v1/transcription/document-recordings/:recordingId/transcript-lease/release
POST /api/v1/transcription/document-recordings/:recordingId/stop
POST /api/v1/transcription/document-recordings/:recordingId/cancel
POST /api/v1/transcription/document-recordings/:recordingId/acknowledge-interruption
POST /api/v1/transcription/document-recordings/:recordingId/delete-audio
```

`GET /document-recordings/active` returns the current `starting | recording | interrupted` capture summary, or `null`, so a reloaded client can rehydrate the global recording bar without knowing a recording id. It accepts an optional `X-Boring-Transcription-Owner` raw-token header and returns `isOwner: boolean` by hashing that token and comparing it to `ownerTokenHash`; absent header means `isOwner: false`. If `false`, the bar is read-only and says `Recording may still be running in another tab, or may finalize after timeout` rather than offering Stop/Cancel controls. Owner-token rehydration for reload should use the host session store/browser session storage where available; if not available, cleanup uses a separate explicit non-owner cleanup/delete-audio flow after finalization, never mutation of active capture.

`GET /document-recordings/:recordingId` returns at least `{ recordingId, documentPath, status, recordingStartedAt, lastIndex, chunkStatusCounts, missingIndices?, entrypoint? }`. `entrypoint` is optional metadata such as `composer`, `document-toolbar`, `agent`, `plugin`, or another future channel; it is for display/audit only and must not fork backend behavior. While finalizing, `missingIndices` is the stable surface for `TRANSCRIPTION_CHUNKS_MISSING` until retries fill the holes or the recording fails.

Browser recording creation returns an unguessable owner/session token. Browser-only `attach` accepts an existing validated markdown `documentPath` and is the document-level Record button path. Browser-only `create-document-and-start` first validates/reserves a new markdown document path, then starts the same recording flow atomically and returns the raw token to the browser response; its request includes `recordingStartedAt` from the original capture start, especially for auto-promotion, and may include optional `entrypoint` metadata for audit/display. Browser start paths call the shared reserve-and-create primitive: reserve the one-active slot, create the per-recording manifest, add the pending entry, and create the document file if this call needs a new one in one workspace-global critical section, with `active.json` written as `starting` for the new `recordingId` only after the required document path exists. If any later step fails, unwind in reverse: remove pending entry, remove manifest/sidecar directory if created, delete the newly-created document only if this call created it, then roll back the pointer. Lazy staleness/status reads treat a pointer whose manifest is missing/unreadable as invalid only after `startingGraceMs` has elapsed; a fresh starting pointer inside grace is considered an in-flight create and must not be released. This avoids committing orphan manifests/documents when concurrent starts race and lose the active slot. Agent-facing `prepare-document` prepares the markdown file path plus an unclaimed recording record and returns only `{ recordingId, documentPath }`, with no raw token and no active slot reservation. Create/prepare paths never truncate existing files: if the target path already exists, they either mint a unique suffix or reject with `TRANSCRIPTION_TARGET_ALREADY_EXISTS`. Attaching to an existing markdown file is only done by the document-level Record action or `attach`, not by create/prepare. Persist only a non-secret `ownerId` plus `ownerTokenHash` in the manifest/pointer; never persist or return the raw token except in a browser create/claim response. Chunk upload, heartbeat, stop, and cancel must include the raw owner token in an `X-Boring-Transcription-Owner` header and fail with `TRANSCRIPTION_RECORDING_OWNER_MISMATCH` if the token hash does not match.

The plugin also exposes an agent tool, for example `start_document_recording`, that accepts a desired title/path, creates the markdown file when needed, and returns only the `recordingId` and document path. It must not return the raw owner token into chat/tool history; internally it uses the token-less `prepare-document` path. The frontend then claims the prepared recording through a one-time non-persisted browser call such as `POST /document-recordings/:recordingId/claim-owner`, which mints/returns the raw token directly to the browser session. `claim-owner` is one-shot: it succeeds only for an unclaimed prepared recording before `preparedClaimGraceMs` elapses and reserves the active slot through the same workspace-global gate as browser create. If `active.json` already holds a live `starting | recording` pointer for a different recording, claim fails with `TRANSCRIPTION_RECORDING_ALREADY_ACTIVE` unless that pointer is stale/expired and can be released first. On success, it writes `active.json` as `starting`, writes `ownerTokenHash` into both the per-recording manifest and `.transcription/active.json` through the workspace-global writer, stamps `startingSince` so `startingGraceMs` covers mic-permission-to-first-heartbeat/chunk rather than human read/claim time, binds ownership for the recording lifetime, and later calls return `TRANSCRIPTION_RECORDING_ALREADY_CLAIMED`. Browser audio capture still starts in the frontend after the user grants mic permission. If an unclaimed prepared recording exceeds `preparedClaimGraceMs`, the backend can garbage-collect/cancel the prepared record without touching the active capture lock; if a claimed/browser-created recording fails to start capture within `startingGraceMs`, the backend auto-cancels it and releases the pointer.

Heartbeat and long recording timers run from a dedicated Web Worker while recording is active, but the Worker sends the first backend heartbeat as soon as the main thread reports `MediaRecorder` `onstart`/recording state. That first ping may carry `lastDataavailableAt: null` plus `recorderStartedAt`; later pings include the latest `dataavailable` timestamp. This immediate onstart heartbeat is what transitions `starting → recording`, so it is not blocked on the first chunk boundary. The session-alive signal remains true across intentional rolling-recorder stop/start chunk boundaries. It becomes false only for user stop, cancel, permission error, recorder error, or session teardown. If main-thread pings stop or report session not alive, the Worker stops heartbeating so `staleAfterMs` can release the active capture lock. The backend-advertised `staleAfterMs` must be comfortably above background worker timer cadence; `startingGraceMs` must exceed the max chunk duration budget plus margin; v1 starts at 180 seconds stale and 90 seconds starting grace.

Heartbeat returns `{ recordingId, status, isOwner }` on success and uses the stable error envelope for owner/interruption mismatch. The client treats `TRANSCRIPTION_RECORDING_OWNER_MISMATCH` and `TRANSCRIPTION_RECORDING_INTERRUPTED` as terminal for capture after any configured grace handling.

Chunk upload is idempotent and ordered by explicit metadata:

- route key: `recordingId + index`;
- request format: raw binary body, with metadata in headers or query/body fields (`startMs`, `endMs`, `mimeType`, `byteLength`, and optional checksum);
- a valid owner may upload/retry chunks while manifest status is `starting`, `recording`, `stopping`, or `finalizing`; uploads are rejected for `interrupted` only after `interruptedUploadGraceMs` has elapsed (within the grace window, apply the late-chunk reactivation/save rules below), and always rejected for `cancelled`, `done`, or `failed`;
- the first valid chunk from a claimed owner also transitions `starting → recording`, same as the first heartbeat, so agent-prepared recordings do not depend on heartbeat/chunk arrival order;
- per-chunk status is `uploading | saved | transcribing | transcribed | failed`;
- retrying the same `index` overwrites/replaces only `uploading | failed` same-index chunks, never appends a duplicate;
- retrying a `saved | transcribing | transcribed` index is rejected with `TRANSCRIPTION_CHUNK_ALREADY_TRANSCRIBED` unless an explicit admin/reprocess endpoint is added later;
- chunks larger than `maxSingleChunkBytes` are rejected with stable code `TRANSCRIPTION_CHUNK_TOO_LARGE`; this is terminal for that chunk only, marks that index failed, and surfaces it via `TRANSCRIPTION_CHUNKS_MISSING` rather than retrying forever, but does not end an otherwise-live capture. The manifest remains `recording` and later indices continue to upload until Stop/Cancel/heartbeat timeout ends capture.
- success returns `{ index, status }` where `status` is the stored chunk status;
- for the client retry queue, both a normal chunk acknowledgement and `TRANSCRIPTION_CHUNK_ALREADY_TRANSCRIBED` are terminal success for that chunk; only transport failures and retryable 5xx responses remain queued; stable 4xx validation/owner/interruption/too-large errors are terminal according to their code;
- out-of-order arrival is allowed, but manifest ordering is always by `index`;
- any valid chunk PUT also renews `lastHeartbeatAt` as a liveness signal; this renewal and the per-recording manifest update run as separate, non-nested critical sections in global→per-recording order, never by acquiring the global writer while holding the per-recording writer;
- if an otherwise-valid owner uploads a chunk shortly after an automatic `interrupted` transition, within a backend-advertised grace window, the backend may reactivate the capture only if `active.json` is absent or still references the same `recordingId`; if another recording now owns the capture lock, the backend may save the late chunk into the old recording's finalizing manifest without reacquiring the lock, or reject it, but must never evict the newer recording;
- the client keeps an in-memory retry queue for chunks until the backend acknowledges them, and promotion/stop must not discard unacknowledged chunks.

Backend must reject concurrent long recordings:

```json
{
  "code": "TRANSCRIPTION_RECORDING_ALREADY_ACTIVE",
  "activeRecordingId": "rec_abc123",
  "documentPath": "notes/consultation-2026-07-09.md"
}
```

Frontend should focus/show the existing global recording bar instead of starting a second recording.

`acknowledge-interruption` is callable from the reloaded workspace session after capture is no longer live; it clears an interrupted read-only pointer after the user has seen the status and returns `{ "acknowledged": true }`. `delete-audio` requires an explicit confirmation field and the host-app authenticated workspace-session/admin cleanup authority, not the stale owner token. In v1, if the deployed workspace has no finer-grained identity than the trusted workspace session, that workspace trust boundary is the authorization and the confirmation field is the final UX gate. It is accepted only for terminal `done | failed | cancelled` recordings; it is rejected while a recording is `starting | recording | interrupted | stopping | finalizing` so audit audio is kept by default during capture/finalization.

Stop must include `finalChunkCount` or `lastIndex`. Stop first records `stopping` plus `lastIndex` in the per-recording manifest, then releases the active capture lock by removing `active.json`, then records `finalizing` in the manifest/pending set with `finalizingSince` stamped on entry. Stop performs global updates (`active.json` removal / `pending.json` update) and per-recording manifest updates (`lastIndex`, `stopping`, `finalizing`) as separate, non-nested critical sections in global→per-recording order, never while holding the per-recording writer and acquiring the global writer. In backend-only/pre-transcription slices, the per-recording manifest remains `finalizing` once contiguous chunk indices `0..lastIndex` are saved, because transcription has not yet run; `done` is reached only after the transcription slice can verify all saved chunks are transcribed. If stop/finalize detects holes, the manifest stays `finalizing` and returns/exposes `TRANSCRIPTION_CHUNKS_MISSING` with the missing indices until retries arrive. If the only missing indices are terminal-failed chunks such as `TRANSCRIPTION_CHUNK_TOO_LARGE`, finalization may reach terminal `done` with a persisted `permanentMissingIndices` list so partial transcripts are not treated as total recording failure. Lazy staleness on start attempts/status reads marks a `finalizing` recording with retryable missing indices older than `finalizeGraceMs` as `failed` and removes it from `pending.json`.

## Backend ownership and behavior

The first implementation slice must introduce `plugins/boring-transcription` as a first-party **internal/app plugin package** in the workspace backend. It must register trusted boot-time Fastify routes; it is not a runtime/generated plugin and must not rely on dynamic backend routes. Route handlers receive `Workspace`, and document-relative manifests/sidecars use the same workspace path-validation adapter as other trusted workspace file operations.

It owns:

- route registration for `/api/v1/transcription/*`;
- shared request/response types and stable error codes;
- the short transcription endpoint;
- long recording manifests/chunk storage under the validated document-adjacent `.recording/<recordingId>/` sidecar directory plus the workspace-global `.transcription/active.json` pointer;
- the STT adapter boundary (`whisper.cpp` first).

Backend behavior:

- Save every chunk before enqueueing transcription.
- Write chunk audio bytes to a temp file inside the recording directory, then atomically rename to the final chunk path while holding the per-recording writer. Only record a chunk as saved in `manifest.json` after the rename succeeds. Do not overwrite a chunk while it is `transcribing` or `transcribed`; same-index retries can replace only incomplete/failed uploads.
- `boring-transcription` v1 assumes the normal single trusted backend process. The per-recording and workspace-global writers are in-process async mutexes keyed by `recordingId` and workspace; the full read-modify-write happens inside the critical section. Slice 5 must add the currently missing per-document serialized writer as a core Workspace primitive owned by Workspace and consumed by both editors and `boring-transcription`; core Workspace/editor code must not import from the plugin. The writer is an in-process mutex keyed by document path, using existing mtime-based OCC as its revision/CAS check. Any operation needing multiple coordination primitives must acquire them in this order: workspace-global writer → per-recording writer → per-document writer. Never acquire the global writer while holding a per-recording writer, and never acquire a per-recording writer while already inside the per-document writer; lease reads/renewals complete before entering the per-document writer. Multi-process/multi-worker deployment requires an on-disk advisory lock or equivalent before it is supported.
- Implement a plugin-local same-directory temp-file + `fs.rename` helper for sidecar/manifest/pointer writes; do not rely on generic `Workspace.writeFile` for atomicity-sensitive recording files.
- Serialize all `manifest.json` mutations through one writer per recording and persist them with the plugin atomic-write helper, so concurrent/out-of-order chunk uploads cannot lose manifest entries.
- Serialize `.transcription/active.json` and `.transcription/pending.json` mutations through a workspace-global writer and the plugin atomic-write helper, so concurrent starts cannot race past the one-active-recording lock and recovery cannot lose pending recordings.
- Transcribe chunk-by-chunk with the configured backend (`whisper.cpp` first).
- Write chunk transcripts to recording sidecars (`chunk-000000-000060.md`). During active/finalizing recording, managed-block writes are controlled by a workspace-global transcript lease keyed by `documentPath`, stored as the single source of truth in a per-document lease record such as `.transcription/leases/<hash(documentPath)>.json` and written through the global writer. Manifest lease fields (`managedBlockOwner`, `leaseHolderId`, `editorLeaseExpiresAt`) are advisory copies only. All writes to the target markdown file, whether requested by backend projection or editor autosave, must go through the same Workspace document-write queue with revision/CAS checks for that document path. Any backend projector, active or finalizing, must acquire the single per-document transcript lease before its managed-block write and release it after, so multiple recordings targeting one document serialize. The backend may request a managed-block update only when it holds the document lease or the editor lease has expired; the write queue still rejects stale base revisions. When the document is open, the editor/UI must acquire the lease, receive an opaque `leaseHolderId`, and renew/release/write with that id using the `transcriptLease.ttlMs` and `renewIntervalMs` advertised by `/capabilities`, then pulls sidecar transcript state into the managed block through the normal editor save path. On CAS conflict or lease-lost rejection, the editor must re-read the document, fetch `GET /document-recordings/:recordingId/transcript`, re-run the shared projection module against the new base revision, and retry; it must never blind-overwrite stale managed-block bytes. `acquire` fails with a stable lease-held error if an unexpired different `leaseHolderId` exists; `renew`, `release`, and managed-block writes require the matching holder id. Closing the document releases the lease; tab crash lets it expire back to backend ownership. Two editor tabs compete for the same lease, and only the holder may write the managed block.
- If the target markdown file exists and already has user edits, the UI/editor appends/updates only a managed block delimited by stable sentinels:
  - `<!-- boring:transcript:begin recordingId=rec_abc123 -->`
  - `<!-- boring:transcript:end recordingId=rec_abc123 -->`
- Projection must find exactly one balanced begin/end pair for the target `recordingId`. If none exists, append a fresh block at EOF. If sentinels are unbalanced, nested ambiguously, or duplicated for the same `recordingId`, abort projection with `TRANSCRIPTION_MANAGED_BLOCK_CORRUPT` and leave the document bytes untouched. The sentinel/merge algorithm lives in a neutral shared module/package owned outside the plugin (for example Workspace shared code or a small `transcription-projection` library) that both core editor code and `boring-transcription` may depend on; core Workspace/editor code must not import from the plugin. The lease decides who may write, but not a separate implementation of how to merge.
- A document may contain multiple recording blocks over time, but v1 only mutates the block whose `recordingId` matches the active/finalizing recording. New recordings append a new managed block; they do not reuse or merge into older blocks.
- Serialize transcript merges through the current transcript-lease holder plus the Workspace document-write queue for that document. Chunks may transcribe out of order, but managed-block writes must sort by `index` so late chunks land in the correct position and never corrupt user prose outside the sentinels.
- Store timestamps with every chunk and render each transcript segment with a visible start/end timestamp heading inside the managed block.
- For v1, renaming/moving the target markdown document while its recording is `recording | finalizing` is unsupported. If `documentPath` is missing on the next projection/open/status operation, transition the recording to `failed` or `interrupted` with `TRANSCRIPTION_TARGET_DOCUMENT_MISSING` rather than writing to a stale path.
- Expose `GET /document-recordings/:recordingId/transcript` returning ordered segments `{ index, startMs, endMs, text, status }` plus a `version`/`etag`; v1 refreshes the managed block by polling this endpoint with the `version`/`etag` contract. SSE/status streams are deferred until explicitly added to the API.
- Never overwrite arbitrary paths; document-relative sidecars must use the same workspace path validation rules as the transcription plugin.
- Keep `/transcribe` for small snippets only after it is introduced; enforce a size/duration limit and return a stable promote-required error (`TRANSCRIPTION_REQUIRES_DOCUMENT_RECORDING`) when exceeded.

## Acceptance

- Composer dictation works for short snippets and does not create sidecar files unless promoted.
- Short-mode recording chunks from before promotion are not lost; if auto-promotion occurs, they are uploaded as the first document-recording chunks.
- A composer recording longer than the threshold auto-promotes to long recording, informs the user, and shows the global recording bar.
- A markdown document can start a long recording from a document-level Record button.
- Agent/chat UX can create a new markdown document and start a document recording directly.
- Only one long recording can run at a time across the app.
- Stop is always visible while a long recording is active.
- Audio chunks are saved beside the target document with start/end timestamp names.
- Transcript output includes visible start/end timestamp headings for each segment.
- Partial transcript survives refresh/restart and can resume from saved chunks.
- Recording capabilities endpoint advertises supported MIME types and short-mode size/duration limits.
- Heartbeats keep active recording ownership alive; chunk/stop/cancel mutations reject stale or wrong owner tokens, and raw owner tokens are never persisted in sidecar files.
- If browser capture is interrupted by refresh/crash, the backend marks the recording interrupted and releases the active capture lock in the long-recording backend slice while keeping a read-only pointer for reload status; final transcription of already-saved chunks is proven once the chunk transcription/resume slice lands.
- User can open the transcript from the global recording bar.
- Short transcription endpoint remains compatible for quick composer dictation once introduced.

## Slices

1. **Transcription backend foundation** — introduce `plugins/boring-transcription` as a first-party internal/app plugin package, route registration, shared types/errors, STT adapter boundary, plugin atomic-write helper, `GET /capabilities`, supported MIME discovery, the short `/transcribe` endpoint, and a browser proof spike that real rolling `audio/webm;codecs=opus` chunks from Chromium decode independently through the selected whisper.cpp adapter. Slice 2 and later long-recording slices are gated on this proof; if the proof fails and we choose server-side normalization, Slice 2 falls back to one single-file composer blob and multipart rolling `/transcribe` is deferred until normalization lands.
2. **Short composer dictation** — mic button, chunked in-memory short buffer only if the Slice 1 independent-chunk proof passes, otherwise single-file composer blob, capabilities-driven MIME/limit selection, no-supported-MIME disabled state, short transcription POST, transcript insert/send, size/duration guard. Before auto-promotion exists, short mode hard-stops at the inline threshold and transcribes buffered audio before exceeding `inlineMax`; if backend overflow still occurs, show an explicit too-long-for-dictation error and preserve buffered chunks.
3. **Long recording backend** — backend-only document-recording APIs, shared reserve-and-create primitive, backend `create-document-and-start`/`attach` start endpoints that mint `recordingId` plus raw owner token, token-less `prepare-document` plus browser `claim-owner`, manifest, workspace-global active pointer, pending set, idempotent chunk upload, heartbeat API contract, owner-token lock, lazy stale interruption handling, stop/cancel, and terminal cleanup/delete-audio API. Test with harness/curl uploads; no browser capture or Web Worker client yet. Until chunk transcription lands, contiguous stopped recordings may remain `finalizing`/pending by design.
4. **Minimal browser document recording + global bar** — add the browser client for the existing start path, Web Worker heartbeat client, app-wide status, stop/cancel/open transcript, acknowledge-interruption UX/API wiring, rehydrate from `GET /document-recordings/active`, then poll `GET /document-recordings/:recordingId` for status only. Transcript rendering lands in Slice 6. This slice proves owner-side Stop and lock release with real browser capture and must include a background-tab/lock/chunk-size proof or a conservative keep-awake/stale-timeout UX before unattended long capture is enabled.
5. **Per-document writer migration** — add the per-document serialized writer (the Workspace document-write queue) and migrate existing editor autosave for every editor surface capable of opening a markdown document onto that writer with mtime-based CAS.
6. **Chunk transcription + transcript projection** — transcribe chunks as they arrive, write sidecars, expose ordered transcript API, add documentPath-keyed global transcript-lease records/API plus advisory manifest fields/editor-backend lease arbitration, project into the managed transcript section/file through the proven single writer, recover pending work after restart. Flip the backend-projection feature flag only after every markdown-capable editor surface uses the Slice 5 per-document CAS writer and the lease API from this slice is implemented; until then, backend never projects into documents that might be open in a legacy-write editor.
7. **Auto-promotion handoff** — retrofit the composer mic path to query `GET /active`, suppress promotion and hard-stop-inline while another long recording is active, handle `TRANSCRIPTION_RECORDING_ALREADY_ACTIVE` by focusing the global bar and preserving buffered chunks, upload buffered short-mode chunks as initial long-recording chunks, then continue background uploads. Do not enable auto-promotion before the global bar has a working Stop control and transcript projection exists. If the Slice 1 independent-chunk proof failed and short mode fell back to a single-file blob, defer auto-promotion until server-side container normalization lands because a single in-progress blob cannot be handed off as indexed long-recording chunks.
8. **Recording entrypoint polish** — full markdown editor/document action using `attach`, agent/chat `prepare-document` tool plus browser `claim-owner`, and a channel-agnostic entrypoint contract so future plugin/clinic/non-chat capture surfaces can attach recording to current or newly created markdown files without backend forks.
9. **Polish/proof** — screenshots/recording proof for short composer and 30+ minute simulated recording.

## Open questions

- Exact auto-promotion threshold: start below the backend inline maximum, e.g. 90 seconds with `inlineMaxDurationMs=120000`, tune after UX proof. For auto-promoted recordings, `recordingStartedAt` is the original composer capture start, not the promotion time, so chunk timestamps and transcript headings stay consistent.
- Whether pause/resume is in v1 or deferred.
- Background-tab/screen-lock recording survival needs real-browser proof before relying on long unattended capture; if Web Worker heartbeat plus `staleAfterMs=180s` is insufficient, v1 should increase stale timeout or require a screen-wake/keep-awake UX.
- Medical post-processing (SOAP note, speaker labels, summaries) should be separate from raw transcription capture.

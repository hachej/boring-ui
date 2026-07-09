# gh-579 composer dictation and long-form transcription

## Decision

Support two recording paths under one transcription system:

1. **Composer dictation** stays optimized for short prompts. The composer records a small blob, posts it for transcription, then inserts/sends the returned text.
2. **Long-form document recording** is a background recording tied to a markdown document. It continuously uploads audio chunks, stores auditable audio sidecars, transcribes chunks as they arrive, and appends/updates a transcript document.

Do not make long doctor/consultation recordings a single synchronous transcription request. Anything that runs long enough to be fragile in the composer must become a resumable background document recording with a persistent global status bar.

## UX model

### Short composer mode

- Composer gets a mic/dictation control.
- While recording, composer shows local state: `Recording… 00:42 [Stop] [Cancel]`.
- Recording uses `MediaRecorder.start(timesliceMs)` from the beginning, even for short composer dictation. Default chunk duration: 30–60 seconds.
- Before promotion, chunks stay in browser memory as a short-mode buffer.
- If the user stops before the long-recording threshold, the browser combines/uploads the buffered chunks to the short transcription endpoint and inserts/sends the resulting transcript.
- Default promotion threshold: **2 minutes** or backend-reported max inline audio size, whichever comes first.

### Auto-promote to long recording

If a composer recording crosses the threshold:

- The app creates a document recording automatically.
- The user is informed immediately:
  - `Long recording started. Audio and transcript are being saved to recordings/<timestamp>-recording.md.`
- The browser first uploads every buffered pre-promotion chunk to the document recording with deterministic indexes/timestamps (`index=0...n`, `startMs/endMs` from recording start), then continues streaming new chunks.
- Subsequent chunks are no longer composer-owned.
- The composer remains usable while the recording continues in the background.

### Document recording mode

For intentional doctor/consultation transcription:

- Markdown editor/document screen exposes a **Record** button near the top of the document.
- Recording attaches to the current markdown file.
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

- **Open transcript**: opens the target markdown document.
- **Stop**: stops MediaRecorder, uploads the final chunk, marks the job `stopping`, transcribes remaining chunks, then marks `done`.
- **Cancel**: stops recording after confirmation. Audio already saved is kept by default for audit unless the user explicitly deletes it later.
- **Pause**: optional first release; if omitted, hide it rather than shipping a fake disabled control.

## File layout

If recording starts from an existing document:

```text
notes/consultation-2026-07-09.md
notes/consultation-2026-07-09.recording/
  manifest.json
  consultation-2026-07-09-audio-000000-000060.webm
  consultation-2026-07-09-audio-000060-000120.webm
  chunk-000000-000060.md
  chunk-000060-000120.md
```

If a composer recording auto-promotes and there is no active document:

```text
recordings/2026-07-09-1530-recording.md
recordings/2026-07-09-1530-recording.recording/
  manifest.json
  2026-07-09-1530-recording-audio-000000-000060.webm
  chunk-000000-000060.md
```

Use browser-native `MediaRecorder` output (`webm`/`ogg` depending on support). Do not promise `.mp4` unless we add a conversion pipeline.

## Chunk container strategy

Do not assume every `MediaRecorder.start(timesliceMs)` `dataavailable` blob is an independently decodable media file. For WebM/Opus, later blobs can depend on the initial container/header segment.

V1 strategy: **short rolling MediaRecorder files**. The client records each chunk as an independent file by starting a recorder, stopping it at the chunk boundary, waiting for the final `dataavailable`, then immediately starting the next recorder. Each uploaded chunk must be independently decodable by the backend. The UI should treat the tiny restart gap as acceptable for v1 doctor-note transcription; exact audio continuity/word-level sync is explicitly out of scope.

If later proof shows restart gaps are unacceptable, replace this with a server-side container-normalization strategy, but do not mix the two models in v1. The manifest, retry, resume, and re-transcription logic all assume independently decodable chunk files.

## Audio ingestion contract

The frontend must choose the first MIME type in the intersection of backend-advertised types and `MediaRecorder.isTypeSupported(...)`, for example:

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
  "chunks": [
    {
      "index": 0,
      "startMs": 0,
      "endMs": 60000,
      "audioPath": "notes/consultation-2026-07-09.recording/consultation-2026-07-09-audio-000000-000060.webm",
      "transcriptPath": "notes/consultation-2026-07-09.recording/chunk-000000-000060.md",
      "status": "transcribed"
    }
  ]
}
```

The manifest is the recovery source of truth. On restart, the backend skips chunks already transcribed and resumes pending chunks.

Capture recovery is different from transcription recovery: browser audio capture cannot resume after tab close/refresh. The active recording lock therefore includes:

- `ownerId`: browser recording-session id;
- `lastHeartbeatAt`: updated while MediaRecorder is alive;
- `status`: `recording | interrupted | stopping | finalizing | done | failed | cancelled`.

If heartbeats stop past a timeout, backend marks the recording `interrupted`, releases the one-active-recording lock, and continues transcribing chunks already saved. Interruption is terminal for that owner token: later heartbeat/chunk/stop/cancel calls from the stale owner return `TRANSCRIPTION_RECORDING_OWNER_MISMATCH` (or `TRANSCRIPTION_RECORDING_INTERRUPTED`) and must not append more audio. The global bar should show `Recording interrupted. Saved audio is being finalized.` if the user reloads into an interrupted recording. Starting a new recording is allowed after interruption, but never silently appends to the old one.

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
  "inlineMaxDurationMs": 120000,
  "inlineMaxBytes": 8388608,
  "chunkDurationMs": 60000,
  "supportedMimeTypes": ["audio/webm;codecs=opus", "audio/webm"],
  "longRecording": { "enabled": true, "heartbeatIntervalMs": 10000, "staleAfterMs": 45000 }
}
```

Introduce the short transcription endpoint for composer snippets:

```http
POST /api/v1/transcription/transcribe
```

Add long recording APIs:

```http
POST /api/v1/transcription/document-recordings
PUT  /api/v1/transcription/document-recordings/:recordingId/chunks/:index
POST /api/v1/transcription/document-recordings/:recordingId/heartbeat
GET  /api/v1/transcription/document-recordings/:recordingId
POST /api/v1/transcription/document-recordings/:recordingId/stop
POST /api/v1/transcription/document-recordings/:recordingId/cancel
```

`document-recordings` creation returns an owner/session token. Chunk upload, heartbeat, stop, and cancel must include that owner token and fail with `TRANSCRIPTION_RECORDING_OWNER_MISMATCH` if another tab/session tries to mutate the active recording.

Chunk upload is idempotent and ordered by explicit metadata:

- route key: `recordingId + index`;
- required metadata: `index`, `startMs`, `endMs`, `mimeType`, `byteLength`, and optional checksum;
- retrying the same `index` overwrites/replaces the incomplete same-index chunk, never appends a duplicate;
- retrying an already-transcribed `index` is rejected with `TRANSCRIPTION_CHUNK_ALREADY_TRANSCRIBED` unless an explicit admin/reprocess endpoint is added later;
- out-of-order arrival is allowed, but manifest ordering is always by `index`;
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

## Backend ownership and behavior

The first implementation slice must introduce an **internal/app plugin package or core workspace service** in the workspace backend. It must register trusted boot-time Fastify routes; it is not a runtime/generated plugin and must not rely on dynamic backend routes. This keeps route ownership, `Workspace` handoff, and path validation in the same trusted boundary as other built-in workspace services.

It owns:

- route registration for `/api/v1/transcription/*`;
- shared request/response types and stable error codes;
- the short transcription endpoint;
- long recording manifests/chunk storage;
- the STT adapter boundary (`whisper.cpp` first).

Backend behavior:

- Save every chunk before enqueueing transcription.
- Transcribe chunk-by-chunk with the configured backend (`whisper.cpp` first).
- Write chunk transcripts to recording sidecars (`chunk-000000-000060.md`) and update a generated managed transcript document/section. Do not directly mutate arbitrary user-authored prose outside the managed transcript section.
- If the target markdown file exists and already has user edits, append/update only a managed block delimited by stable sentinels:
  - `<!-- boring:transcript:begin recordingId=rec_abc123 -->`
  - `<!-- boring:transcript:end recordingId=rec_abc123 -->`
- A document may contain multiple recording blocks over time, but v1 only mutates the block whose `recordingId` matches the active/finalizing recording. New recordings append a new managed block; they do not reuse or merge into older blocks.
- Serialize transcript merges through one writer per recording/document. Chunks may transcribe out of order, but managed-block writes must sort by `index` so late chunks land in the correct position and never corrupt user prose outside the sentinels.
- Store timestamps with every chunk and render each transcript segment with a visible start/end timestamp heading inside the managed block.
- Never overwrite arbitrary paths; document-relative sidecars must use the same workspace path validation rules as the transcription plugin.
- Keep `/transcribe` for small snippets only after it is introduced; enforce a size/duration limit and return a stable promote-required error (`TRANSCRIPTION_REQUIRES_DOCUMENT_RECORDING`) when exceeded.

## Acceptance

- Composer dictation works for short snippets and does not create sidecar files unless promoted.
- Short-mode recording chunks from before promotion are not lost; if auto-promotion occurs, they are uploaded as the first document-recording chunks.
- A composer recording longer than the threshold auto-promotes to long recording, informs the user, and shows the global recording bar.
- A markdown document can start a long recording from a document-level Record button.
- Only one long recording can run at a time across the app.
- Stop is always visible while a long recording is active.
- Audio chunks are saved beside the target document with start/end timestamp names.
- Transcript output includes visible start/end timestamp headings for each segment.
- Partial transcript survives refresh/restart and can resume from saved chunks.
- Recording capabilities endpoint advertises supported MIME types and short-mode size/duration limits.
- Heartbeats keep active recording ownership alive; chunk/stop/cancel mutations reject stale or wrong owner tokens.
- If browser capture is interrupted by refresh/crash, the backend marks the recording interrupted and releases the active-recording lock in the long-recording backend slice; final transcription of already-saved chunks is proven once the chunk transcription/resume slice lands.
- User can open the transcript from the global recording bar.
- Short transcription endpoint remains compatible for quick composer dictation once introduced.

## Slices

1. **Transcription backend foundation** — introduce the internal/app plugin package or core workspace service, route registration, shared types/errors, STT adapter boundary, `GET /capabilities`, supported MIME discovery, and the short `/transcribe` endpoint.
2. **Short composer dictation** — mic button, chunked in-memory short buffer, capabilities-driven MIME/limit selection, short transcription POST, transcript insert/send, size/duration guard.
3. **Long recording backend** — document-recording APIs, manifest, idempotent chunk upload, heartbeat API, owner-token lock, stale interruption handling, stop/cancel.
4. **Auto-promotion handoff** — upload buffered short-mode chunks as initial long-recording chunks, then continue background uploads.
5. **Global recording bar** — app-wide status, stop/cancel/open transcript, state polling or SSE.
6. **Document Record button** — markdown editor/document action, attach recording to current markdown file.
7. **Chunk transcription + resume** — transcribe chunks as they arrive, write sidecars plus managed transcript section/file, recover pending work after restart.
8. **Polish/proof** — screenshots/recording proof for short composer and 30+ minute simulated recording.

## Open questions

- Exact auto-promotion threshold: start with 2 minutes, tune after UX proof.
- Whether pause/resume is in v1 or deferred.
- Medical post-processing (SOAP note, speaker labels, summaries) should be separate from raw transcription capture.

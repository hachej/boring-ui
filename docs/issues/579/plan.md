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
- If the user stops before the long-recording threshold, the browser sends one audio blob to the transcription backend and inserts/sends the resulting transcript.
- Default threshold: **2 minutes** or backend-reported max inline audio size, whichever comes first.

### Auto-promote to long recording

If a composer recording crosses the threshold:

- The app creates a document recording automatically.
- The user is informed immediately:
  - `Long recording started. Audio and transcript are being saved to recordings/<timestamp>-recording.md.`
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

Keep the existing short transcription endpoint for composer snippets:

```http
POST /api/v1/transcription/transcribe
```

Add long recording APIs:

```http
POST /api/v1/transcription/document-recordings
POST /api/v1/transcription/document-recordings/:recordingId/chunks
GET  /api/v1/transcription/document-recordings/:recordingId
POST /api/v1/transcription/document-recordings/:recordingId/stop
POST /api/v1/transcription/document-recordings/:recordingId/cancel
```

Backend must reject concurrent long recordings:

```json
{
  "code": "TRANSCRIPTION_RECORDING_ALREADY_ACTIVE",
  "activeRecordingId": "rec_abc123",
  "documentPath": "notes/consultation-2026-07-09.md"
}
```

Frontend should focus/show the existing global recording bar instead of starting a second recording.

## Backend behavior

- Save every chunk before enqueueing transcription.
- Transcribe chunk-by-chunk with the configured backend (`whisper.cpp` first).
- Append/update partial transcript in the target markdown document or a sidecar partial file, then reconcile final text when chunks complete.
- Store timestamps with every chunk and render each transcript segment with a visible start/end timestamp heading.
- Never overwrite arbitrary paths; document-relative sidecars must use the same workspace path validation rules as the transcription plugin.
- Keep sync `/transcribe` for small snippets only; enforce a size/duration limit and return a promote-required error when exceeded.

## Acceptance

- Composer dictation works for short snippets and does not create sidecar files unless promoted.
- A composer recording longer than the threshold auto-promotes to long recording, informs the user, and shows the global recording bar.
- A markdown document can start a long recording from a document-level Record button.
- Only one long recording can run at a time across the app.
- Stop is always visible while a long recording is active.
- Audio chunks are saved beside the target document with start/end timestamp names.
- Transcript output includes visible start/end timestamp headings for each segment.
- Partial transcript survives refresh/restart and can resume from saved chunks.
- User can open the transcript from the global recording bar.
- Existing short transcription endpoint remains compatible for quick composer dictation.

## Slices

1. **Plan/API contracts** — document this plan, define shared types/errors, keep plugin implementation unchanged.
2. **Short composer dictation** — mic button, short recording POST, transcript insert/send, size/duration guard.
3. **Long recording backend** — document-recording APIs, manifest, chunk upload, one-active-recording lock, stop/cancel.
4. **Global recording bar** — app-wide status, stop/cancel/open transcript, state polling or SSE.
5. **Document Record button** — markdown editor/document action, attach recording to current markdown file.
6. **Chunk transcription + resume** — transcribe chunks as they arrive, append partials, recover pending work after restart.
7. **Polish/proof** — screenshots/recording proof for short composer and 30+ minute simulated recording.

## Open questions

- Exact auto-promotion threshold: start with 2 minutes, tune after UX proof.
- Whether partial transcript writes directly into the user document or into `<doc>.transcript.partial.md` until finalization.
- Whether pause/resume is in v1 or deferred.
- Medical post-processing (SOAP note, speaker labels, summaries) should be separate from raw transcription capture.

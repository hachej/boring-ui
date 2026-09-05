# Live transcription (experimental V0)

Default-off, local-development-only integration for `boring-ui [folder]`.
Enable it with `BORING_LIVE_TRANSCRIPTS_ENABLED=1` and run the pinned loopback
WhisperLiveKit CPU `tiny` service documented in
`docs/issues/912/spikes/whisperlivekit/README.md`.

V0 provides a microphone button in the composer for short in-memory dictation;
stopping inserts the returned French text into the editable draft. The same
short-dictation control becomes a stop button with an elapsed-time counter while
capturing. Live mode streams microphone PCM to the
loopback service and writes a Markdown transcript. By default it does not
retain audio. Trusted local hosts may opt into private AAC/M4A recording by
passing an absolute `audioRecordingDirectory` (and optionally
`audioRecordingFfmpegPath`) to `createLiveTranscriptServerPlugin`; PCM is piped
directly through FFmpeg and never accumulated in memory. Anonymous `Speaker N`
labels and French text may be inaccurate. Kyutai word events are grouped into
readable pause-bounded transcript paragraphs. While capture is active, the live
process is the only supported transcript writer: byte/mtime conflict checks are
best effort and are not atomic. Every 60 seconds, a changed projected revision
creates one visible review turn in the originating Pi chat when it is idle;
`/review transcript` requests the current revision immediately or coalesces it
until idle. Review prompts treat transcript text as untrusted data and never as
instructions. To override the built-in review focus, a workspace may create
an optional `.agents/live-transcription/review.md`; it is read again at each dispatch,
bounded to 32 KiB, and cannot replace the fixed untrusted-transcript safety
envelope. Missing, empty, oversized, or invalid UTF-8 files use the built-in
review instructions. Production/shared deployment is unsupported.

## Kyutai streaming backend

The default backend remains WhisperLiveKit. To use a local Kyutai
`moshi-server`, select its adapter and forward a remote server to loopback when
necessary (the plugin deliberately never connects to a non-loopback upstream):

```bash
export BORING_LIVE_TRANSCRIPTS_ENABLED=1
export BORING_LIVE_TRANSCRIPTS_PROVIDER=kyutai
export BORING_KYUTAI_URL=ws://127.0.0.1:18880/api/asr-streaming
export BORING_KYUTAI_API_KEY=public_token # omit when the local server needs no key
# Optional: enrich only /live transcripts with best-effort speaker labels.
export BORING_LIVE_TRANSCRIPTS_DIARIZER_URL=ws://127.0.0.1:18881/v1/diarize
# Optional: start/stop on-demand compute through the root-owned lease daemon.
export BORING_LIVE_TRANSCRIPTS_LIFECYCLE_URL=http://127.0.0.1:18882/v1
export BORING_LIVE_TRANSCRIPTS_LIFECYCLE_BEARER_TOKEN=<lifecycle token>
```

The adapter captures native 24 kHz PCM16 for Kyutai, converts it to float32
MessagePack `Audio` messages, and sends a `Marker` plus bounded silence on stop.
Without an optional diarizer, Kyutai `/live` Markdown is intentionally
speaker-neutral: timestamped paragraphs are rendered without invented
`Speaker 1` labels. When the optional loopback diarizer is configured, `/live`
also sends a 16 kHz copy to the raw Streaming Sortformer sidecar and assigns
Kyutai words by overlap with its anonymous speaker intervals. Kyutai remains the
text authority; uncovered words render as `Speaker unknown`, and sidecar
setup/runtime failures do not interrupt capture. See
`services/sortformer/README.md` for the PoC service contract. See
`services/lifecycle/README.md` for secure on-demand GPU operation.
With Kyutai selected, the composer microphone streams each `Word` event directly
into the editable draft without creating a transcript or recording file.
`/live start` keeps the separate Markdown transcript and agent-review sink, and
creates a matching `.m4a` only when local recording is explicitly configured.

Input handling measured on real French two-speaker audio (SimSAMU): Kyutai
returns no words at all for quiet input (peaks around -27 dBFS), so the server
raises quiet frames towards a -6 dBFS peak before either service hears them
(`levelNormalizer.ts`; loud audio passes through untouched). The browser keeps
eight 100 ms frames in flight before requiring an ACK and the server queues up
to 32 frames behind a slow upstream, so a doctor 800 ms away from the host
still streams; previously one frame per round trip failed beyond 100 ms RTT.
The sidecar decodes 0.5 s chunks and confirms a speaker switch over two frames
(labels arrive a median 0.49 s after the turn, previously 0.92 s) and sends
delta snapshots; `DIARIZATION_LAG_SECONDS` in `kyutaiDiarized.ts` carries the
measured boundary offset for that cadence.

## Refined transcript and file transcription

An optional loopback GPU batch service can refine a completed recording
offline (measured 5% WER vs. 9% for the live pass, at roughly one minute of
processing per 45 minutes of audio). Configure it with:

```ts
refineUrl: "http://127.0.0.1:18884/v1",       // exact loopback /v1 authority, like lifecycleUrl
refineBearerToken: "<refine service token>",  // required, at least 32 characters
refineFetch: undefined,                       // test hook only
```

When `refineUrl` is set, `createLiveTranscriptServerPlugin` builds a
`TranscriptRefiner` (`src/server/refine.ts`) that streams a recording to
`POST {refineUrl}/refine` (multipart `file`, optional `language`, bearer
auth), maps the returned words into diarized paragraphs with the same
first-seen speaker numbering as the live pipeline, and renders Markdown with
`renderTranscriptMarkdown`. If `lifecycleUrl`/`lifecycleBearerToken` are also
configured, the refiner leases GPU compute from that same service
(`acquire`/`heartbeat`/`release`) around each refine call, independently of
the live/composer capture lease.

Two ways to trigger it:

- **Automatic, after `/live stop`.** When a live session completes with a
  stored recording, `LiveTranscriptManager.terminate()` starts (without
  awaiting) an offline refine pass in the background: it overwrites the
  session's transcript file with the refined Markdown and, once done, sends
  one visible chat message through the originating review target —
  `Transcript refined with the offline pass: <transcriptPath>` — if that
  target is idle. Refine errors are swallowed into an `onRefineError` plugin
  hook and never surface from `/live stop`. The in-flight promise is exposed
  on the session for tests as `session.refinePromise`.
- **On demand, for an existing recording.** `POST
  /api/v1/live-transcripts/transcribe-file` takes `{ path, title?,
  overwrite? }`, where `path` must name a recording under
  `live-transcripts/` — `live-transcripts/<name>.<ext>`, a single path
  segment after the folder, extension one of `m4a`, `mp3`, `wav`, `webm`,
  `ogg`, `mp4`, `aac`, `flac`. Any other path (outside `live-transcripts/`,
  containing extra segments or `..`, absolute) is rejected with 400. The
  audio is read from the plugin's own `audioRecordingDirectory` (the real
  host directory backing the workspace's `live-transcripts/` folder) rather
  than through the sandbox-facing `workspace.root`, since the latter is a
  sandbox-canonical label that doesn't resolve to a real path in the host
  Node process; symlink escapes out of that directory are rejected, and the
  request answers `503 live_transcript_disabled` if no
  `audioRecordingDirectory` is configured. It writes the refined transcript
  to `<path without extension>.transcript.md` in the workspace (refusing to
  overwrite an existing file unless `overwrite: true`, which returns
  `live_transcript_revision_conflict`/409) and responds `{ transcriptPath,
  words, speakers, durationSeconds }`. It also answers `503
  live_transcript_disabled` when no refiner is configured and `409
  live_transcript_already_active` if another file transcription job is
  already running. The front end exposes this as `/transcribe
  <live-transcripts recording> [title]`, which opens the resulting
  transcript file afterward.

The refine service's HTTP errors map onto existing `LiveTranscriptError`
codes: `429` → `live_transcript_already_active` (409), `413` →
`live_transcript_limit_exceeded` (413), anything else →
`live_transcript_upstream_failed` (502). Recordings over 200 MB are refused
locally before contacting the service.

## Robustness gates

The package-local systematic gate composes the real Fastify routes, a real
browser WebSocket client, and a scripted loopback WhisperLiveKit WebSocket. It
covers exact Host/Origin rejection, nonce redemption, PCM ACK/forwarding,
Markdown projection, session-bound automatic review, idempotent stop, active
shutdown, and fresh-process restart. Provider, manager, projector, review, and
drain race/boundary suites run in the same gate:

```bash
pnpm --filter @hachej/boring-transcription test:system
pnpm --filter @hachej/boring-transcription typecheck
```

The deterministic gate does not claim that a deployed host has `ffmpeg`, model
assets, credentials, or acceptable transcription quality. Before relying on a
local deployment, also run the pinned contract proof and CPU stream probe from
`docs/issues/912/spikes/whisperlivekit/README.md`, exercise
`POST /v1/audio/transcriptions` with synthetic WebM/Opus, and run
`docs/issues/912/spikes/whisperlivekit/gh912-live-transcript-deployment-probe.py` to verify one 60-second
automatic review appears, receives an assistant response in the exact
originating chat, and still ends with a complete Markdown transcript.

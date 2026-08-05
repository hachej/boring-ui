# Live transcription (experimental V0)

Default-off, local-development-only integration for `boring-ui [folder]`.
Enable it with `BORING_LIVE_TRANSCRIPTS_ENABLED=1` and run the pinned loopback
WhisperLiveKit CPU `tiny` service documented in
`docs/issues/912/spikes/whisperlivekit/README.md`.

V0 provides a microphone button in the composer for short in-memory dictation;
stopping inserts the returned French text into the editable draft. The same
short-dictation control collapses to a recording icon while capturing and can
stop the recording. Live mode streams microphone PCM to the
loopback service and writes only a Markdown transcript. It intentionally does
not retain audio. Anonymous `Speaker N`
labels and French text may be inaccurate. While capture is active, the live
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
```

The adapter converts browser 16 kHz PCM16 frames to Kyutai's 24 kHz float32
MessagePack `Audio` messages and sends a `Marker` plus bounded silence on stop.
With Kyutai selected, the composer microphone streams each `Word` event directly
into the editable draft without creating a transcript file. `/live start` keeps
the separate Markdown transcript and agent-review sink.

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

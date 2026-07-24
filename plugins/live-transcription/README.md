# Live transcription (experimental V0)

Default-off, local-development-only integration for `boring-ui [folder]`.
Enable it with `BORING_LIVE_TRANSCRIPTS_ENABLED=1` and run the pinned loopback
WhisperLiveKit CPU `tiny` service documented in
`docs/issues/912/spikes/whisperlivekit/README.md`.

V0 streams microphone PCM to the loopback service and writes only a Markdown
transcript. It intentionally does not record audio. Anonymous `Speaker N`
labels and French text may be inaccurate. While capture is active, the live
process is the only supported transcript writer: byte/mtime conflict checks are
best effort and are not atomic. Every 60 seconds, a changed projected revision
creates one visible review turn in the originating Pi chat when it is idle;
`/review transcript` requests the current revision immediately or coalesces it
until idle. Review prompts treat transcript text as untrusted data and never as
instructions. Production/shared deployment is unsupported.

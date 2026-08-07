# Raw Streaming Sortformer sidecar (PoC)

This optional loopback service supplies anonymous `Speaker N` intervals to the
Kyutai `/live` transcript. Kyutai remains the only text authority. The sidecar
runs no ASR and retains no audio after a WebSocket session ends.

It reuses WhisperLiveKit's pinned raw Sortformer backend because that deployment
already contains the compatible NeMo, PyTorch, CUDA, and
`nvidia/diar_streaming_sortformer_4spk-v2` model. It does **not** start or consume
WhisperLiveKit's ASR WebSocket.

```bash
/opt/WhisperLiveKit/.venv/bin/python sidecar.py \
  --host 127.0.0.1 --port 18881 \
  --model-path /opt/models/sortformer/diar_streaming_sortformer_4spk-v2.nemo
```

Configure Boring Clinic through its existing optional diarizer variables:

```text
BORING_LIVE_TRANSCRIPTS_DIARIZER_URL=ws://127.0.0.1:18881/v1/diarize
BORING_LIVE_TRANSCRIPTS_DIARIZER_BEARER_TOKEN=<same value as BORING_SORTFORMER_TOKEN>
```

These source-only operator assets are deployed separately from the published npm
package. The endpoint enforces the exact path, mandatory bearer authentication,
rejects browser-origin connections, and allows one active GPU session.

The endpoint is deliberately fail-open: connection, inference, or drain failure
removes speaker enrichment without interrupting Kyutai transcription. Remove the
diarizer URL and restart the app for immediate rollback.

## Protocol

1. Client sends a `boring.sortformer.v1` JSON `start` message declaring 16 kHz,
   mono, little-endian PCM16 and 100 ms frames.
2. Server replies with JSON `ready`.
3. Every client audio message is one 3,200-byte binary frame.
4. Server emits bounded full JSON `snapshot` messages containing monotonic
   revisions and `{speaker,startSeconds,endSeconds}` segments.
5. Client sends `{ "type": "stop", "id": N }`; server replies `stopped`.

Speaker slots are anonymous, arrival-ordered, session-local, and capped at four
by the model. The follow-up LLM may infer conversational roles; the sidecar does
not claim biometric identity. MacWhisper uses the same anonymous-label product
pattern but performs local speaker recognition after transcription completes;
this PoC emits revisable labels during `/live` capture.

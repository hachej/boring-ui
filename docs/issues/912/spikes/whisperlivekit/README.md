# GH-912 WhisperLiveKit French diarization spike

Status: **source contract and CPU/tiny development smoke passed; production CUDA proof remains blocked**.

CPU evidence: [`CPU-RESULTS.md`](./CPU-RESULTS.md). The CPU smoke produced live French text and two anonymous speaker labels, but tiny-model quality and multi-second diarization lag are not production acceptance.

Bead: `wt-391-forward-gh912-live-transcript-8r4g.10`

## Owner-approved scope

Evaluate WhisperLiveKit as a replacement for the failed Kyutai provider gate, using:

- Faster-Whisper `large-v3-turbo` with SimulStreaming for French transcription;
- NVIDIA Streaming Sortformer 4spk v2.1 for online diarization;
- anonymous, session-local `Speaker 1`…`Speaker 4` labels only;
- no biometric enrollment or recognition of named people;
- stream-only PCM and no persistent audio.

This is a provider spike, not product implementation. It does not start V1–V5 and does not alter the independent G2 private-generation or G3 atomic-CAS blockers. The canonical plan still describes Kyutai and non-diarized output and must be revised through the planning workflow only if this candidate passes runtime proof and the owner accepts the changed product contract.

## Pinned candidate

Exact identities and file hashes are in [`attestation.json`](./attestation.json).

| Component | Pin |
|---|---|
| WhisperLiveKit | `362d709a376b0717a3970fe6d59f184902d08639` (`0.2.24`) |
| Faster-Whisper model | `mobiuslabsgmbh/faster-whisper-large-v3-turbo@0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf` |
| ASR `model.bin` | SHA-256 `e76620f83d5f5b69efd3d87e3dc180c1bd21df9fbebacfd4335e5e1efcc018da` |
| Sortformer | `nvidia/diar_streaming_sortformer_4spk-v2.1@fafaab5faa1617a0ca52d38dd3dc4bd636800d3d` |
| Sortformer `.nemo` | SHA-256 `8abd32832159c6ac1148c926b7276f35ba34582c444e559dce1f1253fea42ef8` |

WhisperLiveKit code is Apache-2.0, the selected ASR model declares MIT, and Sortformer v2.1 uses the NVIDIA Open Model License Agreement. Distribution obligations require owner/legal confirmation before enablement.

## Source-contract findings

### Streaming and speaker attribution

The pinned server exposes `/asr`, receives binary audio frames, and emits JSON carrying speaker IDs and diarization alignment state. `AudioProcessor` fans PCM into in-memory transcription and diarization queues. Sortformer labels are arrival-ordered and limited to four speakers.

The proposed private service contract is:

- Boring backend proxy → `ws://private-wlk/asr?language=fr&mode=diff`
- input → mono signed PCM16 little-endian at 16 kHz (`--pcm-input`)
- output → transcript diff/snapshot JSON with anonymous speaker labels
- authentication → server-side `Authorization: Bearer` only
- browser → never connects directly to WhisperLiveKit

WhisperLiveKit also accepts a query token. That path violates GH-912. Before product use, patch it out or prove the private listener rejects query credentials. The Boring proxy remains responsible for browser authentication, CSRF on HTTP mutations, canonical Origin enforcement on upgrades, lease authority, bounded input, and redaction.

### Published French evidence

The pinned upstream repository includes a small H100 benchmark over 390 seconds of public French read speech. Its `fw SS turbo` result reports:

- WER: **5.2%**
- RTF: **0.1328**

This supports trying the candidate but is not acceptance evidence: it is upstream-authored, contains only four samples, is audiobook/read speech, has no overlap, and reports no French diarization error rate.

### Non-retention source audit

The ordinary live path is memory-oriented. In the pinned Sortformer adapter:

- `self.debug` defaults to `False`;
- whole-session audio is appended to `audio_buffer` only inside `if self.debug`;
- `diarization_audio.wav` is written only inside `if self.debug`;
- live PCM otherwise flows through in-memory queues and terminal sentinels.

This is materially better than the pinned Kyutai handler, but it is not yet an operator attestation. Product use should permanently remove the debug audio-write branch rather than rely only on its default. The image must run read-only with controlled metadata-only logs, no writable audio sink, no request/body/output logging, and core dumps/swap disabled. A post-smoke scan must cover the container writable layer, mounts, controlled logs, and named app locations.

## Reproducible source proof

Clone the exact upstream commit outside this repository, then run:

```bash
git clone https://github.com/QuentinFuxa/WhisperLiveKit.git
cd WhisperLiveKit
git checkout 362d709a376b0717a3970fe6d59f184902d08639
cd /path/to/boring-ui
node scripts/gh912-wlk-contract-proof.mjs /path/to/WhisperLiveKit
```

The script verifies the commit, security-relevant source hashes, binary WebSocket path, in-memory queue path, terminal sentinel, speaker-tagged API fixture, debug-write guards, package version, and published French benchmark values. It intentionally reports runtime properties as unproven.

## Target-GPU spike still required

No NVIDIA runtime exists in the current execution environment: `nvidia-smi` is not installed. Do not build a CUDA image here and mistake a source audit for a live proof.

On an approved NVIDIA host:

1. Check out the pinned source and replace query-token acceptance plus the debug WAV branch with fail-closed code.
2. Pre-download the two exact model revisions, verify the listed SHA-256 values, and make the model cache read-only.
3. Build WhisperLiveKit's `gpu-sortformer` target; record the resulting immutable OCI digest. Do not use `latest`.
4. Run on loopback/private networking with a read-only root, `tmpfs` `/tmp`, no writable audio mount, no request/body/output logs, no core dumps/swap, and a server-side bearer token.
5. Start the pinned service equivalent to:

   ```bash
   wlk \
     --backend faster-whisper \
     --backend-policy simulstreaming \
     --model large-v3-turbo \
     --language fr \
     --diarization \
     --diarization-backend sortformer \
     --sortformer-model-path /models/diar_streaming_sortformer_4spk-v2.1.nemo \
     --pcm-input \
     --host 127.0.0.1 \
     --port 8000
   ```

6. Stream a consented, ephemeral French meeting test set with 2–4 speakers, rapid turns, silence, noise, and overlap. Record WER, DER, speaker stability, transcript alignment, first/stable text latency, RTF, GPU/VRAM, driver/CUDA, and one-hour stability.
7. Close the browser-facing proxy socket and prove terminal cancellation/no reconnect. Separately restart only the upstream once and prove no buffered audio replay.
8. After shutdown, scan controlled logs, writable layers, mounts, `/tmp`, crash locations, and app-owned paths for PCM, WAV/container signatures, model inputs, and transcript bodies. Record zero findings or fail the gate.

## Decision

WhisperLiveKit is a credible out-of-the-box candidate and passes this bounded source-contract screen. A patched CPU/tiny profile also ran end-to-end with French streaming and two anonymous speaker labels. It does **not** yet pass the replacement provider gate because CPU/tiny quality is insufficient and this host cannot run the required production CUDA/French multi-speaker/non-retention smoke.

The feature remains off. G2 and G3 remain independently failed.

# GH-912 WhisperLiveKit local CPU V0

Status: **approved source/model/runtime contract for local single-user development V0**.

This directory pins the provider used by the reviewed [`../../plan.md`](../../plan.md): WhisperLiveKit with Faster-Whisper `tiny`, French SimulStreaming, and anonymous Diart speaker labels. It does not attest production accuracy, production authorization, atomic file integrity, or host-wide non-retention.

Runtime observations and limitations are in [`CPU-RESULTS.md`](./CPU-RESULTS.md). Exact identities are in [`attestation.json`](./attestation.json).

## Pinned contract

| Component | Pin |
|---|---|
| WhisperLiveKit | `362d709a376b0717a3970fe6d59f184902d08639` (`0.2.24`, Apache-2.0) |
| CPU compatibility patch | [`cpu-diart-compat.patch`](./cpu-diart-compat.patch), SHA-256 `a40f720273eddc5702bfa9a95e204d07dba2b11cd9f17b5abff609bcdf722985` |
| Faster-Whisper model | `Systran/faster-whisper-tiny@d90ca5fe260221311c53c58e660288d3deb8d356` |
| tiny `model.bin` | SHA-256 `dcb76c6586fc06cbdac6dd21f14cfd129cc4cdd9dce19bf4ffa62e59cbe6e6d1` |
| Diart assets | `juanmc2005/diart@392d53a1b0cd67701ecc20b683bb10614df2f7fc` |
| embedding ONNX | SHA-256 `a18f844ac553c6bebc1108e0f9d042d12acbc0f45513be46e12612ee235adafc` |
| segmentation ONNX | SHA-256 `b09476b580a5ed3c2b53d1abc44c3ec29f4e87fdf0eb6e8ec1274cb610ece612` |
| Python package manifest | [`cpu-v0-requirements.lock`](./cpu-v0-requirements.lock), SHA-256 `0373dc91cde73485ddc473d0eda2ff725b1ae355ffee4243a785c95637cf76ad` |
| Native dependency used | Ubuntu `libportaudio2=19.6.0-1.2build3` |

The two compatibility changes are intentionally narrow:

1. pass the keyword names expected by `DiartDiarization`;
2. normalize Diart `SPEAKER_00` strings through WhisperLiveKit's existing `extract_number` helper before downstream numeric alignment.

No provider abstraction or maintained WhisperLiveKit fork is introduced.

## Reproduce the environment

Use caches and checkouts outside this repository:

```bash
export WLK=/path/to/WhisperLiveKit
export DIART=/path/to/diart
export VENV=/path/to/gh912-wlk-cpu-venv

git clone https://github.com/QuentinFuxa/WhisperLiveKit.git "$WLK"
git -C "$WLK" checkout 362d709a376b0717a3970fe6d59f184902d08639

git clone https://github.com/juanmc2005/diart.git "$DIART"
git -C "$DIART" checkout 392d53a1b0cd67701ecc20b683bb10614df2f7fc

sudo apt-get install libportaudio2
uv venv --python 3.13.3 "$VENV"
grep -vE '^(#|whisperlivekit @)' \
  /path/to/boring-ui/docs/issues/912/spikes/whisperlivekit/cpu-v0-requirements.lock \
  > /tmp/gh912-cpu-requirements.txt
uv pip install --python "$VENV/bin/python" \
  --extra-index-url https://download.pytorch.org/whl/cpu \
  -r /tmp/gh912-cpu-requirements.txt
"$VENV/bin/hf" download Systran/faster-whisper-tiny \
  --revision d90ca5fe260221311c53c58e660288d3deb8d356
```

The package manifest records the exact successful environment. It does not contain wheel hashes; source/model/ONNX hashes are enforced separately by the contract proof.

While `$WLK` is still the clean pinned checkout, run the proof. Resolve the immutable snapshot path printed/created by `hf download`:

```bash
node scripts/gh912-wlk-contract-proof.mjs \
  "$WLK" \
  ~/.cache/huggingface/hub/models--Systran--faster-whisper-tiny/snapshots/d90ca5fe260221311c53c58e660288d3deb8d356 \
  "$DIART"
```

The proof fails on source, patch, package-manifest, tiny-model, or ONNX drift and inspects the active Diart path rather than the unused Sortformer debug branch. Only after it passes, patch and install the checkout used by the service:

```bash
git -C "$WLK" apply /path/to/boring-ui/docs/issues/912/spikes/whisperlivekit/cpu-diart-compat.patch
uv pip install --python "$VENV/bin/python" --no-deps -e "$WLK"
```

## Run the loopback service

```bash
"$VENV/bin/wlk" \
  --host 127.0.0.1 \
  --port 18772 \
  --backend faster-whisper \
  --backend-policy simulstreaming \
  --model tiny \
  --language fr \
  --pcm-input \
  --diarization \
  --diarization-backend diart \
  --segmentation-model "$DIART/assets/models/segmentation_uint8.onnx" \
  --embedding-model "$DIART/assets/models/embedding_uint8.onnx"
```

V0 uses only `/asr?language=fr&mode=full`: binary signed PCM16 little-endian, mono, 16 kHz in; full JSON transcript snapshots, numeric speaker IDs, and `remaining_time_diarization` out. The service must remain loopback. Boring's server-side adapter may use an `Authorization` bearer; browser/query credentials are not used. WhisperLiveKit debug audio writing is not enabled.

Health:

```bash
curl --fail --silent http://127.0.0.1:18772/health
# {"status":"ok","backend":"faster-whisper","ready":true}
```

CPU smoke with a locally supplied consented fixture:

```bash
"$VENV/bin/python" scripts/gh912-wlk-cpu-stream-probe.py \
  /path/to/consented-french-fixture.wav \
  --url 'ws://127.0.0.1:18772/asr?language=fr&mode=full'
```

Do not commit or intentionally retain the fixture. After the run, inspect the controlled service working directory and logs for `.pcm`, `.raw`, `.wav`, container signatures, or transcript bodies. The completed spike observed none created by the service, but this is not proof about arbitrary process memory or host inspection.

## Measured result

On the available 16-vCPU Haswell host, 31.9265 seconds of real-time PCM produced first text and speaker attribution at approximately 2.023 seconds, two anonymous speaker labels, approximately 0.88 GiB RSS, and up to 6.3 seconds of reported diarization backlog. `small` did not run in real time. Tiny-model French text and speaker labels may be inaccurate.

## Historical note

The first spike evaluated a GPU `large-v3-turbo` + Sortformer production candidate. That profile and the original Kyutai/hidden-review/atomic-CAS plan are retained in Git history and feasibility evidence, but they are not the GH-912 local V0 contract. Production GPU quality and deployment attestation remain future work.

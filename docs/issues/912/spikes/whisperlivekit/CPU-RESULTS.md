# CPU spike results

Date: 2026-07-24

## Conclusion

**Yes, WhisperLiveKit can run streaming French transcription plus anonymous speaker diarization on CPU with a tiny model.** On this 16-vCPU Haswell host, the tiny configuration kept accepting 16 kHz PCM in real time, emitted first text/speaker attribution after about 2 seconds, and produced two distinct speaker labels for a synthetic two-speaker French fixture.

It is not yet a production-quality replacement for the GPU target:

- tiny-model French quality was uneven;
- Diart speaker attribution trailed the capture clock by as much as 6.3 seconds;
- Faster-Whisper `small` did not keep up on this CPU (ASR lag reached about 35 seconds after 32 seconds of audio);
- the pinned WhisperLiveKit Diart path required two compatibility fixes and exact dependency pins;
- the test used synthetic speech and pitch-shifting, not a real consented French meeting corpus.

The practical result is therefore: **CPU/tiny is suitable for local development and an early fallback experiment, not evidence that the required high-quality French production service can be CPU-only.**

## Environment

- CPU: 16 virtual Haswell cores, one thread per core
- RAM: 61 GiB total, approximately 3–6 GiB available during the run
- GPU: none
- Python: 3.13.3
- WhisperLiveKit: `362d709a376b0717a3970fe6d59f184902d08639` / `0.2.24`
- `torch`: `2.8.0+cpu`
- `faster-whisper`: `1.2.1`
- `diart`: `0.9.2`
- `onnxruntime`: `1.27.0`

The upstream Docker CPU build was attempted first, but Docker's build network could not resolve `deb.debian.org`. The executable spike then used an isolated host venv at `/home/ubuntu/.cache/gh912-wlk-cpu-venv`.

## Compatibility findings

The pinned CPU+Diart path did not run unchanged:

1. `core.py` passed `segmentation_model`/`embedding_model`, while `DiartDiarization` expects `segmentation_model_name`/`embedding_model_name`.
2. Diart returns string labels such as `SPEAKER_00`, while `tokens_alignment.py` expects an integer and adds `1`; labels must pass through the existing `extract_number` helper.
3. An unconstrained installation selected `matplotlib 3.11.1`, incompatible with `pyannote-core 5.0.0`; the upstream lock resolves `matplotlib 3.10.9` for this profile.
4. An unconstrained installation selected `huggingface-hub 1.24.0`, incompatible with `pyannote-audio 3.4.0`; the upstream lock resolves `huggingface-hub 0.36.2`.
5. Diart imports `sounddevice`, so host `libportaudio2` is required even when microphone capture occurs outside the service.
6. Default Pyannote models require a Hugging Face token. The spike instead used Diart's checked-in quantized ONNX assets from `juanmc2005/diart@392d53a1b0cd67701ecc20b683bb10614df2f7fc`:
   - embedding: SHA-256 `a18f844ac553c6bebc1108e0f9d042d12acbc0f45513be46e12612ee235adafc`
   - segmentation: SHA-256 `b09476b580a5ed3c2b53d1abc44c3ec29f4e87fdf0eb6e8ec1274cb610ece612`

The exact two-line upstream compatibility patch is committed as [`cpu-diart-compat.patch`](./cpu-diart-compat.patch). It is spike evidence, not approved product code.

## Runtime command

Equivalent successful server invocation:

```bash
wlk \
  --host 127.0.0.1 \
  --port 18772 \
  --backend faster-whisper \
  --backend-policy simulstreaming \
  --model tiny \
  --language fr \
  --pcm-input \
  --diarization \
  --diarization-backend diart \
  --segmentation-model /pinned/segmentation_uint8.onnx \
  --embedding-model /pinned/embedding_uint8.onnx
```

Health result:

```json
{"status":"ok","backend":"faster-whisper","ready":true}
```

The client streamed signed 16-bit mono 16 kHz PCM over `/asr?language=fr&mode=full` at wall-clock cadence. The committed probe can reproduce the transport measurement with a locally supplied, consented fixture:

```bash
/path/to/cpu-venv/bin/python scripts/gh912-wlk-cpu-stream-probe.py \
  /path/to/french-meeting.wav \
  --url 'ws://127.0.0.1:18772/asr?language=fr&mode=full'
```

## Tiny-model result

Synthetic fixture:

- 31.9265 seconds
- four alternating French turns
- one generated voice was pitch-shifted to create a distinguishable second synthetic speaker
- 1,021,648 PCM bytes sent

Observed:

| Metric | Result |
|---|---:|
| First text | 2.023 s |
| First speaker attribution | 2.023 s |
| Distinct speaker labels | 2 (`Speaker 1`, `Speaker 2`) |
| Maximum reported diarization backlog | 6.3 s |
| WebSocket result messages | 628 |
| Server RSS after run | approximately 0.88 GiB |

Representative final output:

```text
Speaker 1: Bonjour, je suis Alice. Nous allons discuter du calendrier du projet.
Speaker 2: Bonjour, Alice. Et c'est Birbaugh. Un peu plus de courants séries et séries du bata.
Speaker 1: T'es bien Bernard. Nous devons aussi vérifier la qualité de la transcription française.
Speaker 2: Becco, j'ai pris pour rien pour te rendu à voir la prochaine ré
```

Speaker separation worked on the synthetic fixture, but the deliberately pitch-shifted speaker had poor ASR quality. This result must not be presented as a French WER or DER benchmark.

## Small-model result

The same fixture was streamed through Faster-Whisper `small` plus Diart:

| Metric | Result |
|---|---:|
| First text/speaker attribution | 7.330 s |
| Peak observed server RSS | approximately 2.25 GiB |
| Distinct speaker labels before close | 2 |
| ASR lag reported in server logs | grew to approximately 35 s |
| Complete transcript by 15 s after input ended | no |

The small model produced higher-quality early text but was not real-time on this host. Only the first two turns were available before the bounded client wait ended.

## Bounded non-retention observation

The runtime directory contained only the explicitly generated test fixtures, captured command logs, and JSON measurements. No `diarization_audio.wav`, `.pcm`, or `.raw` file was created by the service, and the controlled logs did not contain the spoken French transcript strings.

This is bounded evidence only. The spike did not run in a read-only container and did not inspect arbitrary process memory, host swap (none configured), network capture, or every system location. Product enablement still requires the stricter image and operator attestation described in the main spike README.

## Decision

Keep both paths available for later planning:

- **CPU development profile:** Faster-Whisper `tiny` + quantized Diart ONNX, accepting reduced French quality and multi-second speaker lag.
- **Production candidate:** the previously selected higher-quality GPU profile, pending target-GPU French meeting proof.

Do not replace the production requirement with CPU/tiny merely because the protocol ran successfully.

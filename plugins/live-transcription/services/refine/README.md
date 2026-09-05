# Batch refine transcription service (PoC)

Loopback-only HTTP service that turns a recorded consultation audio file into
a full transcript with per-word speaker labels: `POST` a file, get back
Whisper words merged with Streaming Sortformer speaker intervals using the
exact same lag-and-overlap rule the live `/consult` pipeline uses
(`kyutaiDiarized.ts`'s `DIARIZATION_LAG_SECONDS = 0.2`).

It reuses the `sortformer/sidecar.py` sidecar's `Sidecar` class and its
`StableSortformerDiarizationOnline` online-inference logic by importing that
module from `--sidecar-path` (default `/opt/boring-sortformer-poc`) — it does
not copy or fork that code. Diarization is produced by feeding the whole
decoded file through a fresh `sidecar.online_type(shared_model=...)` instance
in 1600-sample (100 ms) frames, exactly like `Sidecar._run_session` does for a
live WebSocket session, including the trailing silence-padding flush.

```bash
/opt/WhisperLiveKit/.venv/bin/python refine_server.py \
  --host 127.0.0.1 --port 18884 \
  --sidecar-path /opt/boring-sortformer-poc \
  --model-path /opt/models/sortformer/diar_streaming_sortformer_4spk-v2.nemo
```

Requires `BORING_REFINE_TOKEN` (or `--token`) and a CUDA-capable box with
`faster-whisper`, `ffmpeg`, and everything `sidecar.py` needs (WhisperLiveKit's
venv). The `large-v3-turbo` Whisper model is loaded once at start-up
(`compute_type="int8_float16"`, chosen because plain `float16` does not fit
alongside the other GPU services on this box); a Sortformer warm-up chunk runs
too, so start-up takes roughly 30 seconds.

## API

`POST /v1/refine`, `multipart/form-data`:

- `file` (required): any audio ffmpeg can decode (m4a, mp3, wav, webm, ogg,
  mp4). Limits: 200 MB, 4 hours of audio.
- `language` (optional, default `fr`): passed straight to Whisper.
- `maxSpeakers` (optional, default `3`, clamped to `2..4`): sets the
  sidecar's `MAX_SPEAKERS` for this job only.

Response `200`:

```json
{
  "durationSeconds": 612.4,
  "language": "fr",
  "model": "large-v3-turbo",
  "wallSeconds": 21.7,
  "words": [{"text": "bonjour", "startSeconds": 0.12, "endSeconds": 0.44, "speaker": 0}],
  "segments": [{"speaker": 0, "startSeconds": 0.0, "endSeconds": 3.2}]
}
```

Errors: `401` unauthorized, `403` browser `Origin` header present, `413` file
or audio too large, `415` undecodable file, `429` a job is already running,
`500` `{"error": "..."}`.

`GET /v1/health` (bearer required too) → `{"ok": true, "busy": false}`.

Only one job runs at a time (a `threading.Semaphore`); a second request while
one is in flight gets `429` immediately rather than queuing. The service
binds to `127.0.0.1` only, requires `Authorization: Bearer <token>`, and
rejects any request carrying a browser `Origin` header — the same posture as
`../sortformer/sidecar.py` and `../lifecycle/daemon.py`.

## Deployment

Install `refine_server.py` root-owned (mode `0755`) under `/opt/boring-refine/`.
Put the token in `/etc/boring-refine.env` (mode `0600`):

```sh
BORING_REFINE_TOKEN=<same value as BORING_SORTFORMER_TOKEN>
```

Install `boring-refine.service` to `/etc/systemd/system/`, then:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now boring-refine.service
```

## Tests

```sh
python3 -m unittest test_refine_server.py
python3 -m py_compile refine_server.py
```

The tests exercise only pure-python parts (the diarization/speaker `merge`
rule and the minimal multipart parser) — nothing that needs CUDA, a GPU,
faster-whisper, or the sidecar module.

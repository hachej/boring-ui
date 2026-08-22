# GH-912 pi-transcribe adoption analysis

Status: **analysis + direction** (owner-designated). `@earendil-works/pi-transcribe`
([github.com/earendil-works/pi-transcribe](https://github.com/earendil-works/pi-transcribe))
is the official Pi transcription extension and becomes the Pi-native path for
dictation and one-shot file transcription. The `plugins/live-transcription`
plugin remains the streaming `/live` transcript path. This document records the
capability comparison and the live-streaming feasibility analysis behind that
split.

## What pi-transcribe provides

Verified against its source (`src/` at the time of adoption):

| Capability | Mechanism |
| --- | --- |
| Mic dictation into the Pi editor | Terminal shortcut (default `Ctrl+Alt+Z`) → `@picovoice/pvrecorder-node` capture on the **host** → batch decode by `transcribe-cpp` (whisper.cpp bindings) → text inserted at cursor (`src/runtime.ts`, `src/audio.ts`) |
| Agent tool: `transcribe_file` | FFmpeg-decodes local audio/video to PCM, then local whisper decode; job queue shares one loaded model, dictation preempts queued files, ≤2 concurrent file jobs, 128 MiB decoded-audio cap (`src/file-transcription.ts`, `src/transcription-service.ts`, `src/file-audio.ts`) |
| Settings / model management | `/transcribe` menu, curated HF GGUF catalog with pinned revisions and hash-checked downloads (`src/catalog.ts`, `src/models.ts`) |
| Streaming events / diarization | **None.** Decoding is full-context batch per submitted utterance; no partial hypotheses, no speaker labels |

## Capability matrix vs `plugins/live-transcription`

| Dimension | pi-transcribe | live-transcription V0 |
| --- | --- | --- |
| Dictation surface | Pi terminal TUI (host mic) | Web composer mic (browser capture → plugin server WS) |
| One-shot audio/video file transcription | Yes — agent-invoked `transcribe_file`, fully local | No (short-dictation HTTP route only, in-memory size cap) |
| True streaming transcript | No (batch only) | Yes — WhisperLiveKit or Kyutai loopback WS, word/pause-bounded Markdown projection |
| Diarization | No | Optional anonymous speaker labels via Kyutai + Sortformer sidecar |
| Model management | Self-contained: pinned GGUF catalog download via `/transcribe` | External pinned Python services (WhisperLiveKit/Kyutai venvs, see `../whisperlivekit/README.md`) |
| Python dependency | None (Node + ffmpeg for files only) | Required for both streaming backends |
| Review integration | n/a (text lands directly in chat/editor) | 60 s idle review turns via review broker |

## Decision

1. **pi-transcribe is adopted as the Pi-native transcription integration**
   (installed as a Pi package: `git:github.com/earendil-works/pi-transcribe`).
   It owns dictation in terminal contexts and all agent-facing
   audio/video file transcription.
2. **`plugins/live-transcription` stays scoped to what pi-transcribe cannot do:**
   browser-composer capture and streaming `/live` transcripts with optional
   diarization. Its short-dictation route remains for the web composer only;
   it is not extended into a general file-transcription service.

## Live-streaming feasibility on pi-transcribe internals

Could `/live` be re-based on `transcribe-cpp` to drop the Python services?

- **Chunked pseudo-stream:** keep a growing PCM ring buffer and re-decode the
  tail every N seconds with VAD trimming. Feasible at tiny/base model sizes,
  but latency ≥ chunk length, CPU cost grows with re-decoded context, and
  repeated full-context decodes produce unstable partial text (no incremental
  hypothesis state).
- **No diarization:** whisper.cpp emits text only. Speaker labels would be lost
  or require a second sidecar anyway — the exact complexity the Kyutai +
  Sortformer path already solves.
- **Quality:** WhisperLiveKit's SimulStreaming and Kyutai's streaming ASR are
  purpose-built for partial emission; batch whisper re-decoding is strictly
  worse at equal model size.

**Conclusion:** not adopted. A `transcribe-cpp` chunked backend remains a
documented fallback for environments where no Python service can run, at the
cost of quality and diarization. Until then, `/live` keeps the pinned
WhisperLiveKit / Kyutai loopback contract in `../whisperlivekit/README.md`.

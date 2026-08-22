# GH-912 Composer dictation button reusing pi-transcribe

Status: **design** (owner direction: replace the TUI shortcut with a button,
keep the underlying mechanism). Parent epic: beads `wt-391-forward-abr`.

## Mechanism mapping

pi-transcribe's shortcut is only a trigger. The machinery underneath is
independent of the TUI and maps one-to-one onto a composer button:

| pi-transcribe (TUI) | boring-ui (button) |
| --- | --- |
| `Ctrl+Alt+Z` terminal binding (`src/shortcuts.ts`, requires focused Pi editor) | Composer mic button `onClick` in web front |
| start/stop `PvRecorder` capture on the server host, 16 kHz mono Int16 frames (`src/audio.ts`) | Same — trigger arrives over the live-transcription plugin route instead of a key event |
| `TranscriptionService.reserveDictation(settings)` — one active reservation, shared loaded model, dictation preempts queued file jobs (`src/runtime.ts`, `src/transcription-service.ts`) | Reused verbatim as the engine contract for our own host-dictation module |
| Live level meter widget above the editor | Recording state + elapsed time in the composer (existing short-dictation UI patterns) |
| `Esc` cancels before submit | Cancel control; stop submits |
| Insert text at terminal editor cursor | Insert into editable draft via the existing front controller path (`src/front/controller.ts`) |
| Settings/model from `~/.pi/agent/pi-transcribe.json` + HF cache (catalog-only ids) | Read-only reuse of the same file and cache |

## Path A (this epic): host mic, local folder mode

The browser never captures. Button → `POST /dictation/start|stop|cancel`
(Host/Origin-validated like existing plugin routes, env-gated) → server-side
module records its own mic with `@picovoice/pvrecorder-node`, decodes with
`transcribe-cpp` against the model resolved from pi-transcribe settings +
HF cache → text returned → front inserts into draft.

- Works because `boring-ui [folder]` runs the pi/plugin server on the same
  physical machine as the browser and its microphone.
- Does **not** work when the server runs remotely or containerized without an
  audio device: routes must fail with a distinct, actionable error.
- Concurrency: exactly one active reservation per server (mirrors
  `reserveDictation` semantics); a second start rejects.
- PCM buffer hard cap (align with `SHORT_DICTATION_MAX_BYTES` philosophy);
  cancel discards.

## Path B (follow-up): browser PCM decoded locally

Keep today's browser worklet capture but replace the WhisperLiveKit
`POST /v1/audio/transcriptions` short-dictation upstream with a local
`transcribe-cpp` decode in the plugin server (same model cache). This removes
the last mandatory Python service for non-live dictation and makes dictation
work on remote deployments. Out of scope for this epic; recorded so the
host-dictation module's decode half can be shared.

## Failure modes to handle

1. No configured model (missing/invalid `~/.agent/pi-transcribe.json`) → error
   telling the user to run `/transcribe` once in any Pi session.
2. No usable input device / permission denied → distinct error, no retry loop.
3. Remote deployment (no host mic reachable by the user) → feature should be
   presented as unavailable, not silently broken.
4. Recorder/device disappears mid-capture → stop returns partial-buffer
   transcription attempt or a clean failure; no leaked recorder handle.
5. Server restart while recording → route state machine resets; front shows
   idle.

## Gating

Env flag on the plugin (default off), consistent with
`BORING_LIVE_TRANSCRIPTS_ENABLED` isolation rules: local-development-only
until proven, no production claims.

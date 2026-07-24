---
github: https://github.com/hachej/boring-ui/issues/912
issue: 912
state: ready-for-agent
updated: 2026-07-24
flag: flag:BORING_LIVE_TRANSCRIPTS_ENABLED
track: owner
---

# gh-912 local live transcript V0

## Problem

A developer needs a minimal local meeting transcript inside Boring UI: start from the current chat, stream microphone speech into one Markdown file, label anonymous speakers, keep chatting, and periodically wake the same Pi session to review the changing transcript.

The original plan required a production-ready Kyutai service, hidden same-session reviews, atomic Workspace compare-and-swap, and production multi-user HTTP/WebSocket authority. Feasibility work showed those requirements block the first useful version:

- pinned Kyutai retains/writes audio-derived tokens and lacks the required protocol/deployment attestation;
- pinned Pi does not offer private same-session generation with useful-output-only publication;
- the current Workspace expected-mtime check and write are not atomic;
- the production HTTP/WebSocket authority proof did not complete.

The owner has explicitly chosen a narrower V0: local single-user development only, visible scheduled review turns, UI read-only plus best-effort revision checks, and CPU WhisperLiveKit `tiny` with anonymous Diart speaker labels. This V0 is an experiment, not a production privacy, accuracy, concurrency, or integrity claim.

## Solution

Add one default-off, statically composed local-development live-transcription integration. It contributes four browser-local commands:

```text
/live start [optional title]
/live stop
/live status
/review transcript
```

Commands are intercepted before Pi. `/live start` accepts the remaining text as an optional title; quotes are not required. With no title, use `Live transcript`. There is no consent modal in V0. Start calls a local control route first; the server atomically reserves the one process-local lease, validates the originating local Pi session through a host-owned resolver, allocates a collision-resistant path with a cryptographically random suffix, creates the document through the resolved `Workspace`, and returns opaque `{ liveSessionId, transcriptPath, socketNonce }`. Only then does the browser request microphone permission and attach audio. A setup deadline releases the lease and marks the created document interrupted when permission or attachment never completes.

One singleton controller is mounted above all chat panes in **CLI folder mode only** (`boring-ui [folder]`). It owns the browser microphone and active live session so split panes cannot create duplicate capture. Only one active live session is allowed in the single app process. The confirmed originating chat remains immutable even if the visible pane changes. Workspace/full-app and non-loopback compositions reject flag-on startup.

The local control plane is intentionally small:

```text
POST /api/v1/live-transcripts             # reserve, validate session, create document
POST /api/v1/live-transcripts/status      # local active status
POST /api/v1/live-transcripts/:id/stop    # graceful bounded drain and completion
POST /api/v1/live-transcripts/:id/review  # manual broker request
POST /api/v1/live-transcripts/:id/interrupt # pre-attachment terminal reason
WS   /api/v1/live-transcripts/:id/audio   # first binary message redeems socket nonce
```

An `AudioWorklet` downmixes and resamples browser audio to signed PCM16 little-endian, mono, 16 kHz. It sends binary frames to the same-origin local WebSocket route. The browser never connects to WhisperLiveKit directly and never supplies a root, transcript path, upstream URL, or authoritative session identity. The local trusted composition extends and forwards `resolveWithWorkspace()` through both the static dispatcher resolver and workspace trusted proxy. Start uses `agent.sessions.load(sessionCtx, sessionId)` plus a narrow `ensurePiSessionBound(sessionId, runContext)` to validate/create the lazily instantiated Pi session before reserving review state. The resolver returns `{ workspace, fullSessionCacheKey, reviewBroker }`; brokers are keyed by the full cache key, never a raw session ID. The server owns path allocation, session validation, and the process-wide lease.

Even for localhost, all POST/upgrade routes validate the exact configured `Host` and canonical `Origin`; WebSockets do not rely on CORS. `startFolderMode()` passes explicit `{ listenerHost, canonicalHost, canonicalOrigin }` from the CLI, distinguishing the loopback listener address from the browser's canonical `localhost:<port>` authority. The Boring listener and WhisperLiveKit URL must resolve to loopback. Audio attachment uses a 256-bit single-use nonce delivered in the start response and redeemed in the first strict binary message, never a URL/query parameter. These are localhost cross-site protections, not production user authentication. The interrupt body accepts only `permission_denied | attachment_failed`; setup timeout has its own stable terminal outcome.

The server proxies audio to one loopback WhisperLiveKit process pinned to commit `362d709a376b0717a3970fe6d59f184902d08639` (`0.2.24`) with:

- Faster-Whisper `tiny`, French, SimulStreaming;
- Diart online diarization;
- pinned quantized ONNX segmentation and embedding assets;
- the minimal committed CPU/Diart compatibility normalization from the approved spike;
- PCM input enabled;
- debug audio writing disabled;
- query-token authentication unused; server-side bearer header if configured;
- the proven `mode=full` snapshot wire profile only (diff mode is deferred).

The compatibility normalization converts Diart labels such as `SPEAKER_00` into stable session-local numeric labels for WhisperLiveKit's existing alignment path. The UI and Markdown render them as `Speaker 1`, `Speaker 2`, and so on. This is anonymous diarization, not biometric identity recognition. V0 uses the dominant speaker for each emitted line and does not attempt a special overlapping-speech representation.

WhisperLiveKit transcript updates are assembled into timestamped Markdown paragraphs:

```md
# Weekly sync

- Started: 2026-07-24T12:00:00Z
- State: active

[00:00:03] **Speaker 1:** Bonjour, on peut commencer.

[00:00:08] **Speaker 2:** Oui, regardons le calendrier.
```

Projection replaces the whole document at most once per second and on stop/interruption. A high-score `live-transcripts/*.md` surface wrapper renders the existing `MarkdownEditorPane` in view mode only while that exact path is active; other Markdown files remain editable and the wrapper returns to edit mode after terminal state. One per-session server queue serializes all throttled, stop, and interruption projection work. Terminal transition cancels an unsent throttle, awaits any in-flight projection, and terminal-projects exactly once. Each projection uses `readBinaryFile + stat`, compares `Uint8Array` with the projector's expected UTF-8 bytes plus mtime, then calls `writeFileWithStat`. A detected mismatch interrupts with `live_transcript_revision_conflict` and preserves the observed external bytes. A monotonic server-owned `projectionRevision` advances only after a changed successful write; it, not mtime, drives reviews. The owner accepts that the check and write are not atomic in V0, so an external writer can still race between them. V0 documentation must state that the live process is the only supported writer during capture.

Audio remains stream-only. Boring-owned buffering is enforced: one worklet frame awaits an ACK before the next transfer, browser and upstream sockets have explicit `bufferedAmount` high-water marks, the proxy accepts one exact maximum PCM payload shape, upstream JSON has a size limit, and each live session has a configurable V0 duration/transcript-size cap. Overflow or limit excess interrupts instead of accumulating. WhisperLiveKit's internal queues are described as upstream in-memory state, not falsely claimed as Boring-bounded. Audio is not intentionally written to a file, transcript, request/body log, database, object storage, durable queue, crash attachment, or playback surface. The service runs loopback with debug capture off. This is bounded app/service behavior, not a claim about arbitrary process memory, host inspection, or network capture.

Browser/socket loss, malformed output, or proxy error is terminal with no reconnect, retry, replay, resume, pause, or crash recovery. Graceful `/live stop` is distinct: stop browser capture first, send no more PCM, allow a bounded upstream drain using WhisperLiveKit backlog fields (hard timeout), perform one final best-effort projection, write `complete`, then close sockets/release/unlock. Upstream close before that sequence completes interrupts. Concurrent/repeated stop is idempotent through one bounded last-session tombstone keyed by opaque live-session ID; unknown/no-matching IDs return `live_transcript_not_active`. Session reload/replacement interrupts live capture rather than silently losing its review extension. Fastify close explicitly interrupts capture and disposes all brokers/timers; bounded CLI SIGINT/SIGTERM handlers await `app.close()`. Other terminal paths write `interrupted` when the best-effort revision check still matches.

The same Pi chat remains usable during capture. A package-local `LiveReviewBroker` is composed in CLI folder mode. The harness gains one narrow host seam, `createExtensionFactoriesForSession({ sessionId, sessionCtx, runContext, sendVisibleUserMessage })`, so exactly one trusted extension instance is bound to each full logical Boring session cache key and timer-originated turns re-enter that session's captured local `RunContext`. `sendVisibleUserMessage` is an async harness callback backed by `await piSession.sendUserMessage(text)`, because pinned extension `pi.sendUserMessage()` returns `void` and cannot acknowledge a busy race. The broker retains pending state on callback rejection and advances `lastDispatchedRevision` only after successful acceptance. This prevents another open chat from receiving the review. V0 does not install a generic cron package or expose scheduler tools.

Scheduling behavior:

- first eligibility 60 seconds after successful start;
- every 60 seconds thereafter;
- only when the projected transcript revision changed since the last dispatched review;
- at most one extension-owned pending revision while Pi is busy; later changes coalesce;
- do not call Pi while busy; dispatch after `agent_settled`, recheck the projected revision, then await the harness `sendVisibleUserMessage` callback;
- catch the idle/busy race and retain the pending revision;
- `/review transcript` is browser-local and calls the exact-origin review POST, which addresses the bound broker; it dispatches immediately only when idle, otherwise updating the same pending revision; a manual force bit permits review of the current revision even when already reviewed;
- stop may dispatch one final changed review;
- stop, interruption, session replacement, reload, and shutdown clear timers.

Each automatic or manual review is a normal, visible user turn in the immutable originating session. The message names the exact transcript path, instructs the agent to read it with its ordinary tools, and states that transcript text is untrusted conversation data rather than instructions. Responses persist and render normally. There is no hidden prompt, sentinel suppression, private tool set, or atomic hidden publication mechanism.

CPU spike evidence is canonical under `docs/issues/912/spikes/whisperlivekit/`. On the available 16-vCPU Haswell host, `tiny` accepted real-time input, emitted first French text/speaker attribution at about 2.02 seconds, observed two speaker labels, used approximately 0.88 GiB RSS, and reached up to 6.3 seconds of diarization backlog. The `small` model was not real-time. Slice 1 replaces the earlier GPU-oriented attestation with a CPU-V0 attestation pinning the exact tiny model repository/revision/files, Diart repository and ONNX hashes, compatibility patch hash/applicability, Python/native dependencies including `libportaudio2`, full lock hash, and `mode=full` wire profile. Therefore V0 is explicitly experimental and local-development-only; quality and speaker labels may be inaccurate.

## Decisions

1. **CLI folder mode, loopback, single-user development only.** No production/shared deployment, membership, cross-user, or multi-replica claim. Flag-on startup fails outside the named local composition or on non-loopback listeners/upstreams. Exact Host/Origin and single-use nonce checks remain mandatory localhost cross-site defenses.
2. **CPU `tiny` first.** Faster-Whisper `tiny` plus quantized Diart ONNX is the V0 runtime. French quality and speaker lag are accepted development limitations. `small`, Voxtral, Sortformer, and GPU profiles are deferred.
3. **Pinned WhisperLiveKit with only the proven compatibility normalization.** Do not fork its architecture, create a provider abstraction, or generalize the patch. Pin commit, dependency lock, model identities, and asset hashes.
4. **Anonymous diarization.** Render `Speaker N`; no names, enrollment, voiceprints, or biometric identity recognition. Users may rename speakers after stop.
5. **Visible Pi wake-ups.** Automatic reviews are visible normal user turns sent through supported Pi extension APIs. This replaces the failed hidden-generation requirement.
6. **Review every 60 seconds, changed-only.** Busy work coalesces to one follow-up. User work already in progress is not interrupted.
7. **Advisory UI read-only and best-effort conflict detection.** No atomic Workspace CAS in V0. The live process is the only supported writer; the accepted race is documented. Path allocation is collision-resistant via random suffix, not falsely claimed atomic-exclusive.
8. **No consent modal.** `/live start` immediately begins file/microphone/socket setup. Browser microphone permission remains the platform gate.
9. **No retries or recovery.** Any browser or upstream failure is terminal. Graceful stop alone gets one bounded upstream drain before completion. Simplicity wins over gap handling.
10. **Markdown is the sole artifact.** No transcript card, audio artifact, recording, playback, upload, or parallel structured transcript store.
11. **One static singleton.** No dynamic provider mounting, generic audio bus, generic scheduler, distributed lease, or runtime plugin platform.
12. **Feature remains default-off and CLI-owned.** Folder mode may enable it and browser metadata advertises commands only when the server confirms local flag-on readiness. `boring-ui workspaces` rejects flag-on; non-CLI applications treat the environment variable as inert and gain no routes/UI.
13. **Privacy-critical local commands bypass Pi busy admission narrowly.** Exact `/live stop`, `/live status`, and `/review transcript` execute through the local controller while Pi streams; unrelated commands remain blocked. `/live start` remains rejected while an active live session exists.
14. **Session-bound extension factory.** The minimal new harness seam binds one trusted live-review extension to one logical Pi session and captured run context; it is not a browser-generic extension or scheduler API.

## Flag / Abstraction

- **Needed?:** Yes: `BORING_LIVE_TRANSCRIPTS_ENABLED`, default `0`.
- **Path:** One app/internal `plugins/live-transcription/` package statically composed only by CLI folder mode through `packages/cli/src/front/App.tsx`, `WorkspaceAgentFront.extraCommands`, the local server composition, and the session-bound host extension factory. Direct WhisperLiveKit V0 adapter; no STT provider interface.
- **Enablement:** Require CLI folder mode, one app process, loopback Boring listener, loopback WhisperLiveKit, exact configured browser Origin/Host, and explicit flag `1`. Server readiness is projected through workspace metadata so the built SPA omits commands when unavailable. `boring-ui workspaces` rejects flag-on; non-CLI applications remain inert without added guards.
- **Rollback:** Set the flag to `0` and restart. Graceful shutdown interrupts active local sessions and unlocks Markdown. No migration or audio cleanup exists.

## Stable V0 outcomes

- `live_transcript_disabled` — flag/composition/readiness unavailable.
- `live_transcript_local_only` — listener, upstream, Host, or Origin violates local policy.
- `live_transcript_already_active` — process lease is owned.
- `live_transcript_session_not_found` — originating Pi session is not locally active.
- `live_transcript_attachment_invalid` — socket nonce invalid, expired, or reused.
- `live_transcript_setup_timeout` — microphone/socket attachment deadline elapsed.
- `live_transcript_permission_denied` — browser microphone access failed.
- `live_transcript_attachment_failed` — browser could not attach after start.
- `live_transcript_invalid_audio` — frame type, size, or alignment invalid.
- `live_transcript_backpressure` — ACK/socket/upstream queue limit exceeded.
- `live_transcript_limit_exceeded` — duration, transcript, or upstream-message cap exceeded.
- `live_transcript_upstream_failed` — WhisperLiveKit malformed, closed, or timed out.
- `live_transcript_revision_conflict` — observed transcript bytes/mtime changed.
- `live_transcript_not_active` — stop/status/review requested without a live session.

Every terminal outcome releases browser/server ownership and active-path view mode. Only a successfully drained explicit stop writes `complete`; all other post-create terminal outcomes write `interrupted` when revision-safe.

## Test Seams

- **Highest public seam:** local composed workspace app: submit `/live start Weekly sync`, stream deterministic PCM, observe speaker-tagged read-only Markdown, continue normal chat, observe one visible changed-only review in the originating session, then `/live stop` and edit the completed Markdown.
- **Command seam:** exact local interception tests prove `/live start [title]`, `/live stop`, `/live status`, and `/review transcript` never reach ordinary Pi prompt/command routing as raw slash commands. Exact stop/status/review execute while Pi streams through a narrowly named composer pre-admission; an unrelated local command remains blocked.
- **Singleton/UI seam:** split-pane tests prove one controller/microphone owner, immutable originating session, active-path-only advisory read-only state, and unlock on every terminal path.
- **Local route seam:** tests reject flag-off, non-CLI-folder composition, non-loopback listener/upstream, wrong Host/Origin, text frames, malformed/oversized PCM, unknown session, nonce theft/reuse/expiry, and duplicate starts before upstream audio send. Start/review/interrupt/status/stop are exact-origin POSTs; interrupt accepts only the strict pre-attachment reason enum. No client root/path is authority. Two logical Pi sessions and lazy session creation prove full-cache-key resolver/broker targeting cannot cross sessions.
- **Audio seam:** deterministic resampling/downmix/frame tests for common 44.1/48 kHz browser input; bounded queues; overflow terminal behavior; cleanup counters return to zero.
- **Provider seam:** scripted `mode=full` WhisperLiveKit JSON covers speaker labels, timestamps, duplicate snapshots, malformed/oversized events, backlog drain, upstream close, and terminal finalization. Slice 1 updates `scripts/gh912-wlk-contract-proof.mjs` to inspect the active Diart/CPU patch path rather than treating Sortformer proof as sufficient.
- **Projection seam:** fake-clock tests prove one serialized queue, at-most-once-per-second whole-document writes, terminal cancellation/drain/exactly-one final write, binary-bytes+mtime conflict guards, monotonic changed-write `projectionRevision`, advisory lock, and detected conflict. Tests explicitly do not claim atomic external-writer protection.
- **Review extension seam:** fake-clock Pi harness tests prove +60-second changed-only scheduling, visible user-message delivery only from idle, one extension-owned pending revision, immutable full-cache-key/run-context targeting across two chats, manual current-revision force review, final changed review, awaited-send rejection recovery, and timer cleanup on every session lifecycle event. Reload/replacement interrupts capture; pane switching does not.
- **CPU smoke:** `scripts/gh912-wlk-cpu-stream-probe.py` streams a locally supplied French fixture and records first text, first speaker, labels, backlog, and final lines.
- **Shutdown seam:** signal tests prove bounded SIGINT/SIGTERM awaits Fastify close; close interrupts the live manager and disposes every session broker/timer without relying on a nonexistent Pi `session_shutdown` event.
- **Existing prior art:** `packages/agent/src/front/chat/PiChatPanel.tsx`, composer-policy and slash-command tests; `packages/workspace/src/app/front/WorkspaceAgentFront.tsx`; Markdown editor/file state; Pi extension loading under `packages/agent/src/server/harness/pi-coding-agent/`. The awaited visible-send callback is new and requires focused tests.
- **Avoid testing:** production authentication, multi-replica locking, exact French WER/DER claims, arbitrary host-memory absence, browser vendor internals, hidden-turn semantics, atomic CAS, retries, or old recording/upload behavior.

## Acceptance

- Flag off, non-CLI-folder composition, or non-loopback startup exposes no live commands/status UI and accepts no live WebSocket audio. Browser workspace metadata is the command-visibility source.
- Local flag-on composition registers exactly `/live start [optional title]`, `/live stop`, `/live status`, and `/review transcript`; raw slash text never reaches Pi. Exact stop/status/review execute while Pi streams; unrelated local commands remain blocked.
- Start with or without a title first resolves/ensures the full-cache-key local Pi session, acquires the server lease, creates one collision-resistant random-suffixed Markdown file, and returns opaque ID/path/nonce before microphone access. Wrong/expired/reused nonce and wrong Host/Origin fail before audio; strict interrupt reasons and setup timeout release ownership and mark the created document interrupted when revision-safe.
- One browser tab/controller owns at most one active session; split panes do not duplicate microphone capture. A second start returns stable local `live_transcript_already_active` without stealing ownership.
- Browser audio becomes mono signed PCM16 little-endian at 16 kHz. One-frame ACK flow control, socket high-water marks, payload/JSON limits, and duration/transcript caps bound Boring-owned queues; malformed, oversized, or backpressured input interrupts.
- The browser never receives or chooses the WhisperLiveKit URL/token and never connects upstream directly. Boring and WhisperLiveKit listeners are loopback; exact Host/Origin validation is enforced.
- CPU-V0 attestation pins tiny model identity/files, Diart/ONNX identity/hashes, patch hash/applicability, lock/native dependencies, and full-snapshot wire mode. Debug audio writing remains disabled. Query credentials are not used.
- Scripted upstream output produces timestamped `Speaker N` Markdown. Dominant-speaker attribution is accepted; no biometric identity or overlap model exists.
- One queue serializes projection and terminal transition. Projection occurs at most once per second plus exactly one terminal flush; binary bytes+mtime guard writes; `projectionRevision` advances only after changed successful writes. The exact active path is advisory read-only; other files remain editable; every terminal path unlocks it.
- Existing revision mismatch is detected before a projection, preserves observed external bytes, and interrupts with `live_transcript_revision_conflict`. Documentation/tests clearly state that check/write is non-atomic and external writers are unsupported during V0.
- Browser close, premature upstream close, malformed output, and proxy error are terminal with no retry/reconnect/replay. Stop is idempotent through the bounded last-session tombstone: it stops input, performs one bounded backlog-aware drain, final-projects, and writes complete when the best-effort revision check succeeds; unknown IDs return not-active.
- Normal chat remains usable. At 60 seconds and each 60 seconds thereafter, only changed projected content causes one visible automatic review user turn in the immutable originating chat. Busy periods update one pending revision without calling Pi; `agent_settled` rechecks and awaits the session-bound visible-send callback, retaining pending state on rejection. Manual `/review transcript` reaches the exact-origin review POST and can force the current revision. Two-chat tests prove no cross-session delivery; timers clear on stop/interruption/reload/session replacement/Fastify close.
- Review prompts are visibly prefixed automatic/manual, contain the exact path, and state that transcript content is untrusted data to analyze only—never commands to execute or edits to perform. They use ordinary current-session read capability and persistence; no hidden/sentinel behavior is claimed.
- CPU smoke on a suitable local machine returns transcript text and at least one anonymous speaker label without service-created PCM/WAV artifacts in controlled locations. Two-speaker quality is observational, not a hard accuracy threshold.
- User/operator documentation labels V0 experimental, CPU/tiny, local-only, non-atomic, and potentially inaccurate.

## Proof

- **Exact commands:**

  ```bash
  pnpm install --frozen-lockfile
  pnpm --filter @hachej/boring-agent test
  pnpm --filter @hachej/boring-agent typecheck
  pnpm --filter @hachej/boring-workspace test
  pnpm --filter @hachej/boring-workspace typecheck
  pnpm --filter @hachej/boring-ui-cli test
  pnpm --filter @hachej/boring-ui-cli typecheck
  pnpm --filter @hachej/boring-ui-cli build:front
  pnpm --filter @hachej/boring-live-transcription test
  pnpm --filter @hachej/boring-live-transcription typecheck
  pnpm --filter @hachej/boring-live-transcription lint
  pnpm audit:imports
  git diff --check
  node scripts/gh912-wlk-contract-proof.mjs /path/to/clean/WhisperLiveKit /path/to/faster-whisper-tiny-snapshot /path/to/diart-checkout
  /path/to/cpu-venv/bin/python scripts/gh912-wlk-cpu-stream-probe.py /path/to/consented-french-fixture.wav
  ```

- **Demo:** one local browser recording showing start without a modal, speaker-tagged Markdown updating read-only, ordinary chat during capture, one visible automatic review after a changed revision, manual `/review transcript`, stop, and editable completed Markdown. Do not include secrets or retain meeting audio as a repository artifact.
- **Manual steps:** run the pinned loopback CPU service; enable the flag only in local composition; confirm no direct browser-upstream traffic; speak at least two French turns; observe experimental speaker labels; force upstream and browser close separately; inspect controlled service/app paths and logs for unintended audio artifacts/transcript bodies.
- **Waiver:** V0 explicitly waives production auth, atomic CAS, production-grade French accuracy/DER, and target-GPU proof. It does not waive local flag isolation, stream-only app behavior, bounded buffers, timer cleanup, visible review semantics, or terminal lifecycle proof.

## Slices

### Slice 1: pinned local CPU service contract

**Delivers:** Reproducible local operator assets for pinned WhisperLiveKit `tiny` + Diart ONNX; a CPU-V0 attestation with exact model/ONNX revisions and hashes, patch hash/applicability, Python/full-lock/native dependency identities including `libportaudio2`, and `mode=full`; updated contract proof for the active Diart path; loopback-only configuration; no-debug-audio controls; health check; and CPU smoke documentation/scripts. No Boring product route accepts audio yet.

**Blocked by:** None.

**Proof:** source/hash proof, patch-application test, service health, one-speaker and synthetic two-speaker CPU probe, controlled-path artifact/log inspection.

**Review budget:** inside.

### Slice 2: local live transcript vertical path

**Delivers:** Internal package; CLI-folder-only flag/readiness metadata; narrow busy-safe command pre-admission; singleton controller; host resolver and process lease; server-created random-suffixed path; exact Host/Origin and nonce checks; control routes; worklet/resampler with ACK and socket limits; direct full-snapshot WhisperLiveKit adapter; bounded stop drain; speaker-tagged best-effort projector; active-path surface wrapper; terminal cleanup; scripted tests. No automatic review scheduling yet; `/review transcript` returns a local “not available until Slice 3” notice.

**Blocked by:** Slice 1.

**Proof:** focused agent/workspace/package tests, typechecks, import audit, scripted provider integration, browser-local composed test, `git diff --check`.

**Review budget:** split if production code exceeds the normal review target; do not build generic platforms.

### Slice 3: visible same-session review wake-ups and V0 handoff

**Delivers:** Session-bound host extension-factory seam and `LiveReviewBroker`; manual `/review transcript`; +60-second changed-only visible reviews; idle-only dispatch/coalescing; final review; two-chat isolation; reload/lifecycle cleanup; composed CLI-folder E2E; docs; and owner demo. Feature remains default-off.

**Blocked by:** Slice 2.

**Proof:** fake-clock extension tests, native session/reload ordering, composed browser demo, CPU service smoke, controlled non-retention inspection, full focused commands above.

**Review budget:** inside.

## Out of Scope

- Production or shared deployment; production user auth/membership/CSRF, multi-user status privacy, or multi-replica ownership. Local exact Host/Origin checks remain in scope.
- Atomic Workspace CAS or protection against unsupported concurrent external writers.
- Hidden reviews, sentinel suppression, private same-session generation, restricted hidden tool sets, or useful-output-only publication.
- Kyutai/Moshi, Voxtral, Sortformer, GPU service profiles, production French WER/DER guarantees, or speaker-name recognition.
- Consent modal, pause/resume, browser/upstream reconnect, retries, audio replay, reload/crash recovery, distributed leases, durable jobs, or missed-review recovery.
- MediaRecorder, audio files, uploads, playback, downloadable recordings, transcript cards, diarization editing UI, generic STT provider/audio bus/scheduler/command platform, or old recording subsystem integration.

## Open Questions

None for V0. The owner delegated remaining implementation choices to the smallest local-development path consistent with this plan.

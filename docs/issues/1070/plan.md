---
github: https://github.com/hachej/boring-ui/issues/1070
issue: 1070
state: ready-for-agent
updated: 2026-08-05
flag: not-needed
track: fast
---

# gh-1070 Stream Kyutai into the composer

## Problem

The Kyutai transport is reusable but currently feeds only the Markdown transcript/review sink. The composer microphone is still a separate short REST dictation path.

## Solution

Use the same browser capture, authenticated local WebSocket, frame limits, and upstream adapter for both modes. Add a composer sink that routes incremental Kyutai `Word` events back over that WebSocket and appends them to the active draft. Keep transcript projection/review as the existing explicit live-transcript mode.

## Decisions

- Pass the active Pi session ID to composer contributions so the existing live lifecycle remains correctly scoped.
- Select the composer sink only for the Kyutai provider; WhisperLiveKit retains short dictation.
- Send typed Word events alongside the existing binary ACK protocol; do not persist composer dictation audio or create a transcript file.
- Stop capture before sending Kyutai Marker; flush all returned Word events before declaring completion.

## Flag / Abstraction

- Needed?: not-needed
- Path: provider-neutral upstream connection plus distinct transcript/composer sinks.
- Rollback: select `BORING_LIVE_TRANSCRIPTS_PROVIDER=whisperlivekit`.

## Test Seams

- Highest public seam: composer contribution receives session ID and appends streamed words.
- Existing prior art: browser ACK flow, `LiveTranscriptManager`, `KyutaiConnection` protocol tests.
- Avoid testing: real GPU/model quality in deterministic CI.

## Acceptance

- Kyutai composer microphone starts a session-scoped live stream.
- Words arrive incrementally in the editable draft.
- Stop flushes the Marker tail without adding a Markdown transcript or review turn.
- Existing Whisper short dictation behavior is unchanged.

## Proof

- Exact command: focused plugin/browser and agent composer tests; package typechecks.
- Manual steps: use a loopback tunnel to `moshi-server`, press mic, speak, verify incremental draft text and final tail.
- Waiver: remote GPU proof requires starting the stopped Exoscale instance.

## Slices

### Slice: composer streaming sink
**Delivers:** session-aware composer action and Kyutai Word routing to the draft.
**Blocked by:** None.
**Proof:** focused tests and typechecks.
**Review budget:** inside.

## Out of Scope

WhisperLiveKit live draft streaming and non-local/shared deployment.

## Open Questions

None.

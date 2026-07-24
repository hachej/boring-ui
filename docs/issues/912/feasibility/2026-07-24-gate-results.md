# GH-912 feasibility gate results — 2026-07-24

## Decision

Stop implementation fail-closed. G2, G3, and G4 do not satisfy mandatory acceptance criteria. The feature remains off and V1–V5 must not start. G1 is inconclusive and cannot change the stop decision.

## G1 — HTTP/WebSocket authority and attachment

**Result: inconclusive / ready for human review.**

An isolated worker began a core-owned workspace-dispatch proof and tests, but exceeded its turn budget before producing an acceptance report or commit. Its temporary worktree was subsequently removed by the worker harness, so no implementation was retained. The gate has not passed.

## G2 — private same-chat review publication

**Result: failed / ready for human review.**

The repository pins `@earendil-works/pi-coding-agent@0.80.7` (`package.json:63`). The current adapter exposes ordinary `prompt` and `followUp` turns and fixes the session tool set at creation. Native events flow through the normal persistence/publication pipeline. No primitive provides all of:

1. private generation in the existing session;
2. bounded exact-path and expected-revision read authority;
3. no hidden input, tool event, transcript, sentinel, or partial output on any persistence/publication surface; and
4. atomic publication of only a complete useful assistant result.

UI filtering, a visible synthetic prompt, or a second agent/session would violate the fixed contract and were not implemented.

Validation was limited to source inspection and `git diff --check`. `pnpm install --frozen-lockfile` failed with `ERR_PNPM_ENOSPC` at the time of investigation, leaving `vitest`, `tsc`, and `tsx` unavailable.

**Owner decision required:** add or upgrade to a pinned Pi API with private same-session generation plus atomic useful-result-only publication, or revise the product requirement.

## G3 — singleton UI lock and revision-safe Markdown

**Result: failed / ready for human review.**

The existing user-filesystem write path does not offer atomic compare-and-swap. In `packages/boring-bash/src/server/routes/file.ts`, the expected revision is checked using `await workspace.stat(path)` at lines 482–503, then the write occurs separately at lines 519–526. An external writer can modify the file after the check and before `writeFile`/`writeFileWithStat`, allowing the live projection to overwrite newer bytes.

Plugin-local serialization cannot close this race against external Workspace writers. Therefore the required byte-preserving external-mutation proof and stable `live_transcript_revision_conflict` behavior cannot be implemented truthfully on the current adapter seam.

The isolated worker's temporary worktree lost its `.git` metadata and repository contents before it could commit documentation. It was instructed not to reconstruct the repository, modify the shared worktree, or delete anything. This infrastructure failure does not change the source-level atomicity conclusion.

**Owner decision required:** add an adapter-level atomic write-if-expected revision/hash primitive and prove it against an external writer, or revise the integrity requirement.

## G4 — Kyutai CUDA protocol and non-retention

**Result: failed / ready for human review.**

Primary-source inspection pinned:

- Moshi source commit: `e6a55d2722a65870ef52a6c9f6ecfc0e90f38362`
- Model revision: `1c34c6b4f7e9299bb61985f145052ff131005dde`
- `model.safetensors` SHA-256: `8f6e244d44baf63c6fa3587d25a4e8d3627ecbafe177cf34a736e697bb725116`
- Mimi SHA-256: `09b782f0629851a271227fb9d36db65c041790365f11bbe5d3d59369cf863f50`
- Tokenizer SHA-256: `cd87dd5d17169151782ac700280ec057e5d658a9afbe238a048ea5ff318cce69`

The pinned Rust server fails mandatory requirements:

- `rust/moshi-server/src/asr.rs` accumulates connection audio/text tokens and unconditionally writes token artifacts to `log_dir` on exit; no configuration-only non-retention mode was found.
- `rust/moshi-server/src/main.rs` permits `auth_id` query credentials, forbidden by the product contract.
- `Ready` is declared but not emitted by the single-stream handler.
- `Step.prs` has no documented stable semantic-pause index or threshold.
- Final drain lacks a single-stream terminal event; official batch behavior uses `Marker` plus ten seconds of zero PCM.
- No official digest-pinned Rust server image, exact CUDA driver/toolkit matrix, or one-stream capacity attestation was available.
- The wire contract is binary MessagePack (`Audio{pcm}`, `Marker{id}`, and `Word`/`EndWord`/`Marker`/`Step` events), not raw WebSocket PCM. The expected input is 24 kHz mono float32 in 1,920-sample/80 ms frames, but direct frame-length validation is absent upstream.

A real CUDA smoke and deployable attestation could not be produced without an approved non-retaining image/service. Inode exhaustion also prevented the worker from writing proposed blocked fixtures, but the privacy/protocol blockers independently fail the gate.

**Owner decision required:** approve a minimal pinned Kyutai fork that removes token retention/dumps and query authentication and defines readiness, pause, and drain semantics; then build, digest-pin, deploy, and attest it on target CUDA—or select another real-time STT service/revise the requirements.

## Environment note

During the worker run `/tmp` reached `1,048,576/1,048,576` inodes, causing `ERR_PNPM_ENOSPC` and preventing artifact/test creation. Worker cleanup later restored inode availability. No temporary clone or worker-created directory was manually deleted because explicit deletion permission was not provided.

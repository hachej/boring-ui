---
github: https://github.com/hachej/boring-ui/issues/1344
issue: 1344
state: ready-for-human
updated: 2026-08-21
flag: not-needed
track: owner
---

# gh-1344 — agent edits are invisible in an open Markdown editor

## Today / Delta

### Today

The editor-side reconciliation contract mostly already exists:

- `useFilePane` loads through React Query and, after a changed server `mtimeMs`, replaces a **clean** buffer (`packages/workspace/src/plugins/filesystemPlugin/front/useFilePane.ts:197-222`) or raises the existing external-change conflict for a **dirty** buffer (`:224-234`).
- `MarkdownEditor` distinguishes its own normalized save round-trip from a genuine external `content` prop and applies the latter under `suppressChangeRef`, specifically to avoid the prior autosave ping-pong/conflict storm (`packages/workspace/src/plugins/filesystemPlugin/front/markdown-editor/MarkdownEditor.tsx:748-785`).
- The filesystem provider opens `/api/v1/fs/events`; a live change invalidates the exact file-content key and causes the refetch (`packages/workspace/src/plugins/filesystemPlugin/front/data/useFileEventStream.ts:35-84`, `useFileEventInvalidation.ts:45-57`).
- In normal small folder mode, the Node workspace watcher is available, so this path usually works.

The owner-reported hosted workspace is different in one decisive way. A direct probe of its current `/api/v1/fs/events` response returned:

```text
event: unsupported
data: {"reason":"workspace_too_large", ... "more than 50000 entries" ...}
```

This is expected server behavior: the Node watcher refuses a tree over `DEFAULT_MAX_WATCHED_ENTRIES = 50_000` (`packages/boring-sandbox/src/providers/node-workspace/nodeWatcher.ts:70-114`), and the SSE route forwards that refusal as `unsupported` (`packages/boring-bash/src/server/routes/fsEvents.ts:67-87`). The hosted route exists and is correctly workspace-scoped; it is not a missing-SSE-route bug.

### What actually breaks

The exact missing link is the advertised-but-unimplemented **client fallback after `event: unsupported`**:

1. The agent correctly writes the ordinary `.md` file.
2. Hosted workspaces mode refuses whole-tree watch because this workspace exceeds 50,000 entries.
3. `useFileEventStream.onUnsupported` only logs, closes `EventSource`, and records no capability state (`packages/workspace/src/plugins/filesystemPlugin/front/data/useFileEventStream.ts:87-100`).
4. `useFileContent` has `staleTime: 0` but no polling/refetch fallback (`packages/workspace/src/plugins/filesystemPlugin/front/data/hooks.ts:35-57`).
5. Therefore the already-mounted pane receives no new `fileData`; `useFilePane` and TipTap's genuine-external-change logic never run. The pane is effectively mount-only until focus/remount/manual invalidation.

Agent result metadata can also emit `data-file-changed` through `ChatPanelHost` and `agentFileBridge`, but it is not a complete coherence authority: it depends on the active chat transport and on tool results carrying file-change details. The independent filesystem channel is intentionally the backstop for ordinary plain-file tools and out-of-band writes; it cannot be replaced by an agent-facing editor API.

Hosted vs folder mode is therefore explicit: **same front/editor code, different watcher capability**. Small local folders get SSE; the reported hosted repository crosses the safety cap and gets `unsupported`, where the front currently has no fallback.

### Delta

Implement the classic editor contract with a bounded fallback:

- expose filesystem event-stream capability (`connecting | live | unsupported`) inside the filesystem data provider;
- when capability is `unsupported`, poll only actively observed file-content queries at a conservative interval (target 2s; pause in background through React Query defaults), not the whole tree/search cache;
- feed any changed content/mtime through the existing clean-sync vs dirty-conflict state machine;
- stop using mtime as document identity: keep a last-confirmed disk-content baseline (content equality or digest) so missing/colliding mtimes still reconcile; use the exact mtime returned by our save only as supplementary own-save evidence, and remove the lifecycle's time-only three-second suppression that currently discards any genuine agent write in that window (`packages/workspace/src/front/hooks/useEditorLifecycle.ts:39,177-187`);
- make dirty conflict an actual freeze: stop autosaves until the user explicitly chooses **Reload from disk** or **Overwrite disk**; continued typing must not silently overwrite the agent's version;
- add a quiet bottom-right document state alongside word count, without changing the agent's tools or mental model.

## Solution choice

### A. Freeze for every agent edit + notice

**Not chosen as the general v1 behavior.** It is simple only if a trustworthy “agent started editing this exact path” signal already exists. Today the durable signal arrives after the write, and watcher/poll fallback changes may be external rather than agent-authored. Freezing a clean document after the fact adds friction without preventing anything. We will adopt the safe part of this instinct: freeze autosave only when an external update meets unsaved local edits, with an explicit bottom-right conflict state.

### B. Live external-change reconciliation

**Chosen.** Reload-if-clean / conflict-if-dirty is the standard file-editor contract, matches the state machine already present, preserves plain-file agent tools, and repairs the exact hosted capability gap without a new authority or data format. Cost is a small provider capability state, targeted fallback polling, conflict hardening, status UI, and end-to-end proof.

### C. TipTap + Yjs collaborative document authority

**Rejected for v1.** TipTap v3 is present (`@tiptap/core`, `react`, `starter-kit`, extensions), but no `yjs`, `y-prosemirror`, awareness, or TipTap collaboration packages are dependencies. A real CRDT design would require a server-side document authority, session/awareness protocol, CRDT persistence and compaction, Markdown↔CRDT reconciliation, and a decision about what happens when the agent writes the `.md` file behind that authority. Translating every plain-file write into a CRDT transaction while preserving exact Markdown bytes is the hard problem, not a client extension toggle. It is disproportionate to this defect and risks violating the key plain-file-agent constraint.

## UX contract — bottom-right status

The existing footer remains the home for word count and gains a compact, `aria-live="polite"` document state:

| State | Copy | Behavior |
| --- | --- | --- |
| Normal / live | no extra copy | Word count only; no persistent “all good” noise. |
| Fallback active | `Watching for file changes` | Quiet neutral indicator only after SSE declares unsupported; tooltip explains active-document polling. |
| External refetch | `Checking for updates…` | Brief spinner while a watcher/agent event or fallback tick refetches this file. |
| Clean update applied, attributed agent event | `Updated by agent` | Success dot; auto-clears after ~4s. Attribution is accepted only from a matching filesystem/path agent event and expires; a duplicate watcher event cannot downgrade it. |
| Clean update applied, unattributed watcher/poll | `Updated from disk` | Success dot; auto-clears after ~4s. |
| Dirty conflict | `Agent update conflicts with your edits` when attributed, otherwise `Disk update conflicts with your edits` | Persistent warning; editor content remains local and autosave is frozen until the banner action resolves it. |
| Resolution | `Reloaded from disk` or `Overwrote disk version` | Brief success; auto-clears after ~4s. |

“Agent is editing…” before the write is **out of scope for v1** because the current authoritative channels do not provide a reliable pre-write path lease. We will not fake certainty. A future tool-activity protocol may add that state without changing the agent-facing file API.

## Decisions

| Decision | Chosen | Why |
| --- | --- | --- |
| Source of truth | `.md` file remains canonical | Preserves ordinary agent read/write/edit behavior. |
| Large-workspace fallback | Poll active file-content queries only | Repairs the exact missing link without watching/refetching a >50k tree. |
| Clean external update | Apply automatically | No local work can be lost; existing TipTap suppression prevents save echo. |
| Dirty external update | Preserve local buffer and freeze autosave | No implicit data loss; user chooses disk or local version. |
| Attribution | Correlate matching filesystem/path agent events in an expiring pane-local source marker; otherwise say “disk” | Honest across watcher and polling paths; no global or durable attribution claim. |
| Yjs/CRDT | Out of scope | Requires a separate document-authority architecture and dependency stack. |
| Flag | None | Bounded correctness fix; rollback is one PR revert. |

## Flag / Abstraction

- **Needed?:** No feature flag. This restores the promised fallback and makes conflict handling safer.
- **Path:** a small file-event-capability context owned by `DataProvider`; file-content hooks consume it; `useFilePane` exposes editor-facing document status.
- **Rollback:** revert the PR. SSE-capable workspaces retain their current path throughout; fallback polling and new status disappear together.

## Test seams

- **Highest public seam:** a mounted Markdown pane under the real filesystem `DataProvider`, with the server returning `event: unsupported`, followed by an ordinary filesystem write to the open path.
- **Existing prior art:** `useFileEventStream.test.tsx`, `useFileEventInvalidation.test.tsx`, `useFilePane.test.tsx`, `useEditorLifecycle.test.ts`, `MarkdownEditor.test.tsx`, Node watcher and fs-events route tests.
- **Avoid testing:** TipTap internals, timers without observable state, private React refs, or an agent-specific API that production tools do not use.

## Acceptance

1. When `/api/v1/fs/events` reports `workspace_too_large` or `watch_not_implemented`, an already-open Markdown file observes an ordinary external file write within the fallback interval without refresh/remount.
2. A clean pane applies changed disk content through `MarkdownEditor` even when mtime is missing or unchanged, without firing `onChange`, creating a write echo, or reopening the autosave/conflict storm.
3. Once an external change is observed while dirty, the pane preserves local content, shows the existing choice banner plus bottom-right conflict status, and performs no further automatic write until explicit Reload or Overwrite.
4. Reload adopts the latest disk version; Overwrite writes the latest local buffer; both clear conflict and report a brief resolved status.
5. A genuine agent/external content change arriving within three seconds of a local save is reconciled; an own-save is recognized by the confirmed disk-content baseline, with returned mtime as supplementary evidence rather than identity.
6. SSE-capable folder mode keeps event-driven invalidation and does not poll active files.
7. Agent tools remain ordinary read/write/edit operations on `.md`; no editor-facing tool or CRDT dependency is introduced.
8. Hosted-mode proof forces the watcher-unsupported path; folder-mode proof exercises live SSE. Both reproduce “open Markdown → external/agent-style edit same file → pane behavior.”
9. The bottom-right copy follows the state table and is accessible via polite live status; conflict remains alert-level through the existing banner.

## Proof

### Exact commands (from `.worktrees/wt-391-forward-z2qt`, never a live hub)

```bash
pnpm --filter @hachej/boring-workspace exec vitest run \
  src/plugins/filesystemPlugin/front/data/__tests__/useFileEventStream.test.tsx \
  src/plugins/filesystemPlugin/front/data/__tests__/hooks.test.tsx \
  src/plugins/filesystemPlugin/front/data/__tests__/useFileEventInvalidation.test.tsx \
  src/plugins/filesystemPlugin/front/__tests__/useFilePane.test.tsx \
  src/front/hooks/__tests__/useEditorLifecycle.test.ts \
  src/plugins/filesystemPlugin/front/markdown-editor/__tests__/MarkdownEditor.test.tsx

pnpm --filter @hachej/boring-workspace typecheck
pnpm --filter workspace-playground build:deps

# playwright.config.ts must explicitly forward this variable through its env -i webServer.
BORING_MAX_WATCHED_ENTRIES=10 \
  pnpm --filter workspace-playground exec playwright test \
  e2e/markdown-external-edit.spec.ts --grep '@watch-unsupported'

BORING_MAX_WATCHED_ENTRIES=1000000 \
  pnpm --filter workspace-playground exec playwright test \
  e2e/markdown-external-edit.spec.ts --grep '@watch-live'

git diff --check
```

### Hosted-workspaces proof

Run the workspace surface from this worktree with `BORING_MAX_WATCHED_ENTRIES` set below a fixture tree's entry count. In Playwright:

1. The Playwright spec creates its own Markdown fixture under `apps/workspace-playground/e2e/fixtures/workspace/.e2e-tmp/` and opens it in the Markdown pane.
2. Assert `/api/v1/fs/events` emits `unsupported: workspace_too_large` and the footer shows fallback watching.
3. Use an ordinary process/plain-file edit (the same filesystem contract as agent `edit`) to replace a unique sentence.
4. Assert the already-open clean pane shows the replacement and `Updated from disk` without browser refresh.
5. Make a local unsaved edit, perform a second external write, assert local text remains, conflict copy is visible, and disk bytes do not change again until an explicit action.
6. Save screenshot and trace.

Focused event tests additionally prove agent attribution matches both filesystem and path, expires, ignores late unrelated metadata, and is not downgraded by the duplicate watcher event. The process-write E2E intentionally proves only the honest `Updated from disk` path.

### Folder-mode proof

Repeat against a small fixture where SSE is live; assert no fallback polling, then perform the same open-file external write and observe `Updated from disk`/agent-attributed copy.

### Live owner demo

Keep the worktree demo on the allowed `:5301` origin. Open the proof Markdown document, make the same-file change with the agent's ordinary workspace `edit` tool, and show the pane reconcile in place. The exact click/write path must pass in automation with a screenshot before Gate 2.

## Slice

### Slice: Restore open-file coherence when filesystem watch is unavailable

**Bead:** `wt-391-forward-z2qt` (P0, claimed; no dependencies)  
**Delivers:** event-capability state; active-file fallback polling; clean reload; dirty autosave freeze and explicit resolution; bottom-right document status; hosted/folder regression proof and live demo.  
**File scope:**

- `packages/workspace/src/plugins/filesystemPlugin/front/data/{DataProvider.tsx,useFileEventStream.ts,useFileEventInvalidation.ts,hooks.ts}` and focused tests
- `packages/workspace/src/plugins/filesystemPlugin/front/{useFilePane.ts,FilePaneShell.tsx,ConflictBanner.tsx}` and focused tests
- `packages/workspace/src/front/hooks/useEditorLifecycle.ts` and focused tests
- `packages/workspace/src/plugins/filesystemPlugin/front/markdown-editor/{MarkdownEditor.tsx,MarkdownEditorPane.tsx}` and focused tests
- `apps/workspace-playground/{playwright.config.ts,e2e/markdown-external-edit.spec.ts}`; config forwards `BORING_MAX_WATCHED_ENTRIES` through its `env -i` web server, and the spec creates/removes only its runtime fixture under the existing ignored E2E workspace

**Blocked by:** Gate 1 owner approval only.  
**Proof:** exact commands and two-mode scenario above.  
**Fits one session:** Yes; one package-local state flow plus focused route/provider fixtures, no schema/server authority/dependency migration.  
**Review budget:** T1 Sol fresh-eyes plan review before Gate 1; final-SHA Sol fresh-eyes + T1 thermo due product-critical conflict semantics. The repository Model Card normally follows Sol with human-gated Fable falsification, but the owner's explicit request-level model policy forbids every non-Sol subagent. That Fable step is waived rather than silently substituted; Gate 1 is the owner's direct decision on this reviewed plan.

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Polling large workspaces creates load | Medium | High | Poll only observed file-content queries; conservative interval; no tree/search polling; stop immediately when unmounted. |
| Poll response races a local keystroke | Medium | High | Keep synchronous `dirtyRef` guard; freeze on conflict; tests interleave refetch and edit. |
| Own-save echo looks external—or genuine agent write is suppressed as an echo | Medium | High | Track confirmed disk content, use returned mtime only as supplementary evidence, remove time-only suppression, preserve `lastEmittedRef`, and test missing/colliding mtime. |
| Agent attribution is unavailable on polling | High | Low | Use honest “disk” copy; never claim agent attribution without metadata. |
| Existing continued-typing behavior overwrites agent changes | High (once conflict occurs) | High | Remove implicit baseline bump/overwrite and block autosave after observed conflict until explicit resolution. |
| A write races inside the server's current stat-then-write OCC window | Low | High | Explicit v1 residual risk: client freeze cannot make separate server operations atomic. Add deterministic client in-flight interleaving proof; a shared atomic write authority across all agent/editor providers is a follow-up architecture, not silently claimed here. |
| Fallback never recovers if capability later becomes live | Low | Medium | Capability is tied to provider mount; EventSource reconnect remains for errors, while `unsupported` is terminal for that mount. |

## Adversarial plan review

**Reviewer provenance:** first pass `openai-codex/gpt-5.6-sol`, fresh context, refutation mandate, target `84482748b4f4732b58a01d9c74a13a9438d570b5`, run `7d1e7c2b`; second pass target `e701fe05b7434ed7668c9052ae2e9faa18e53b84`, run `8e6efb86`. The repository Model Card normally requires subsequent Fable falsification, but the owner's explicit request-level policy allows only Sol, including every subagent. Fable is recorded as an explicit waiver, not treated as completed; fresh-session refutation supplies independence within the allowed model.

| Finding | Disposition |
| --- | --- |
| Blocker: client-only conflict handling cannot make the server's separate stat-then-write OCC atomic. | **Accepted residual risk, guarantee narrowed.** V1 freezes only after an external change is observed and never claims atomic exclusion of a write racing inside the server TOCTOU window. A true fix requires a shared write authority across agent and editor providers and is out of this defect slice; Gate 1 context calls this out. |
| High: exact mtime is not identity; missing/colliding mtimes remain stale. | **Fix in plan.** Track confirmed disk content (or digest), use mtime only as supplementary evidence, and test missing/same mtime plus changed content. |
| High: agent attribution had no producer/consumer path in scope. | **Fix in plan.** Add `useFileEventInvalidation.ts` and a matching filesystem/path, expiring pane-local source correlation; polling remains honestly “disk.” |
| High: bead absent from the review worktree's stale JSONL snapshot. | **Rejected as non-issue.** Canonical authority is the explicitly required Beads DB, not committed JSONL. `br --db /home/ubuntu/projects/boring-ui-v2/.beads/beads.db show wt-391-forward-z2qt --json` proves P0, in-progress, claimed, issue #1344, and the ready fields. |
| Medium: nonexistent fs-events test path and no exact E2E command/fixture. | **Fix in plan.** Remove the nonexistent test command; name `e2e/markdown-external-edit.spec.ts`, its runtime-created ignored fixture, `build:deps`, exact unsupported/live commands, and explicit forwarding through Playwright's `env -i`. |
| Second-pass high: review language omitted mandatory Fable. | **Waived by owner policy, made explicit.** The Model Card requirement is acknowledged; no non-Sol subagent may run under the request-level policy. Gate 1 is still raised once for the owner's direct decision. |
| Second-pass medium: attribution and stale proof language lacked exact coverage. | **Fix in plan.** Add `useFileEventInvalidation.test.tsx` to focused proof and require filesystem/path match, expiry, unrelated metadata, and duplicate-event precedence tests; process-write E2E proves only “disk.” |

Graph checks before handoff: `br ... dep cycles --json` returned zero cycles; `bv --robot-insights` completed. This one bead has no dependency edges.

## Out of scope

- Yjs, y-prosemirror, awareness, TipTap collaboration extensions, or a server document authority.
- Pre-write “agent is editing” presence/leases.
- General multi-user co-editing.
- Polling the whole file tree/search index.
- Changing agent tools, tool prompts, or `.md` file semantics.
- Byte-preserving round-trip improvements unrelated to external-change coherence.

## Open questions

None blocking. The owner decision at Gate 1 is whether to accept **Option B: classic reconciliation with targeted fallback polling and conflict-only freeze**, while deferring CRDT collaboration and pre-write agent presence.

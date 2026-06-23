# TipTap-first agentic markdown collaboration plan

Status: proposed  
Owner: workspace / filesystem plugin  
Date: 2026-06-23

## Executive summary

The current markdown editor treats the workspace file as the source of truth and TipTap as a view/editor that periodically re-seeds from React Query. That model breaks down when a human has a markdown pane open and an agent edits the same file on disk: the human can keep seeing an old rendered TipTap document, the agent sees its disk write, and conflict handling becomes timing-dependent.

Move opened markdown documents to a TipTap-first model:

- **Open markdown panes:** TipTap/ProseMirror is the live source of truth. Agents must edit through a typed editor command API instead of writing the disk file directly.
- **Closed markdown files:** existing filesystem writes remain valid, but route markdown-specific edits through a headless markdown edit service where practical.
- **Persistence:** the markdown file is the persisted serialization of the live TipTap document, produced by `editor.getMarkdown()`.
- **Collaboration-ready path:** keep the command model compatible with Yjs/Hocuspocus so the same API can later become true multi-client collaboration.

This avoids a full collaboration rewrite upfront while establishing the right ownership boundary for future collaborative editing.

## Problem statement

Observed/likely failure modes:

1. A user opens a `.md` file in the rich markdown pane.
2. An agent edits the same file on disk.
3. The file cache may invalidate, but the TipTap editor can remain stale if:
   - the pane is dirty,
   - stale-save suppression hides a near-in-time external write,
   - the editor's `lastEmittedRef` comparison treats a changed document as a save echo,
   - the agent write happens outside a strongly typed UI command path.
4. Human and agent now reason about different versions of the document.

The deeper design issue is that there are two writers with different state models:

- file/disk writes via agent tools;
- TipTap/ProseMirror document state in the browser.

For an opened rich document, disk should not be the live coordination layer.

## Current implementation notes

Relevant code:

- `packages/workspace/src/plugins/filesystemPlugin/front/markdown-editor/MarkdownEditorPane.tsx`
- `packages/workspace/src/plugins/filesystemPlugin/front/markdown-editor/MarkdownEditor.tsx`
- `packages/workspace/src/plugins/filesystemPlugin/front/useFilePane.ts`
- `packages/workspace/src/front/hooks/useEditorLifecycle.ts`
- `packages/workspace/src/plugins/filesystemPlugin/front/data/useFileEventInvalidation.ts`

Current TipTap markdown usage is already solid enough to build on:

- `@tiptap/markdown` is installed.
- Initial markdown content is loaded using `contentType: "markdown"`.
- Programmatic replacement uses `editor.commands.setContent(markdown, { contentType: "markdown" })`.
- Autosave serializes with `editor.getMarkdown()`.

Current concurrency handling is file-centric:

- `useFilePane` tracks local dirty state and OCC `mtime`.
- `useEditorLifecycle` detects `serverMtime` changes and sets `shouldSync` or `externalChangeWhileDirty`.
- `STALE_SUPPRESSION_MS = 3000` suppresses mtime changes shortly after local saves. That is useful for save echoes, but too coarse for agent edits because a real external write can land inside that window.

## External research summary

### Open-source / self-hostable pieces

The following are available as open-source building blocks:

- **TipTap editor**: MIT, ProseMirror-based, headless rich-text framework.
- **`@tiptap/markdown`**: bidirectional Markdown parser/serializer via TipTap's Markdown manager.
- **`@tiptap/extension-collaboration`**: Yjs collaboration extension for TipTap documents.
- **Yjs / y-prosemirror**: CRDT state and ProseMirror binding.
- **Hocuspocus**: MIT Yjs WebSocket backend from the TipTap team for self-hosted collaboration.
- **`@hocuspocus/provider`**: client provider for Hocuspocus.

The basic collaboration architecture is therefore feasible without the paid TipTap Cloud product.

### TipTap markdown APIs

Canonical APIs:

```ts
editor.commands.setContent(markdown, { contentType: "markdown" })
editor.commands.insertContent(markdown, { contentType: "markdown" })
editor.commands.insertContentAt({ from, to }, markdown, { contentType: "markdown" })
const markdown = editor.getMarkdown()
```

The Markdown extension is a bridge between Markdown strings and TipTap JSON, using Markdown tokens and extension-specific parse/render handlers.

Important limitations to respect:

- Markdown round-tripping is not byte-for-byte preservation.
- Comments are not generally represented by Markdown.
- Complex table cell contents can be lossy because Markdown tables cannot represent arbitrary nested ProseMirror content.
- Frontmatter, MDX, raw HTML, custom directives, and unusual whitespace need explicit policy.

### Collaboration APIs

Canonical self-hosted shape:

```ts
const ydoc = new Y.Doc()
const provider = new HocuspocusProvider({
  url: "ws://127.0.0.1:1234",
  name: documentName,
  document: ydoc,
})

const editor = useEditor({
  extensions: [
    StarterKit.configure({ undoRedo: false }),
    Collaboration.configure({ document: ydoc }),
    CollaborationCaret.configure({ provider, user }),
  ],
})
```

TipTap collaboration uses a Yjs document as the shared document model. The Collaboration extension owns history/undo behavior, so `StarterKit` undo/redo must be disabled when collaboration is enabled.

### TipTap agentic / AI capabilities

TipTap's agentic products are useful design references, but most are Pro/private packages:

- **AI Toolkit** is a Pro package (`@tiptap-pro/ai-toolkit`).
- It exposes AI-provider tool definitions for Vercel AI SDK, LangChain.js, OpenAI, Anthropic, Mastra, and others.
- The runtime pattern is: model emits tool calls, the client executes them against the live TipTap editor via `executeTool`, then returns tool output to the model.
- Core AI Toolkit tools include:
  - `tiptapRead` — read from a document position.
  - `tiptapEdit` — perform edit operations.
  - `tiptapReadSelection` — read current selection and location.
  - optional comment/thread tools when Comments are configured.
- Older AI Agent extension tools include:
  - `read_first_chunk`, `read_next_chunk`, `read_previous_chunk`;
  - `apply_diff` with before/delete/insert diff records;
  - `replace_document`;
  - `plan`;
  - `ask_user`;
  - `finish_with_summary`.
- Review modes include:
  - direct edit;
  - preview suggestions before modifying the document;
  - review suggestions after modifying the document;
  - tracked changes as a separate product.

Takeaway: we should copy the **shape** of the agentic interface, not depend on the Pro package initially. A small OSS-compatible command set can give our agents document-editing superpowers against the live TipTap editor.

## Design principles

1. **One live authority per open document.** If a markdown document is open in TipTap, TipTap owns the live state.
2. **Disk is persistence, not collaboration.** The `.md` file is the serialized projection of the open document.
3. **Agents use semantic editor operations.** Agents should not patch an opened rich document through the filesystem path.
4. **Keep raw markdown escape hatches.** Some documents require exact textual preservation; raw mode and direct file tools must remain available with clear warnings.
5. **Yjs-compatible from day one.** Even if phase 1 is local-only, command shapes should map cleanly to ProseMirror transactions and later Yjs updates.
6. **No paid dependency required for MVP.** Use TipTap OSS, current markdown extension, and our own typed command bridge first.

## Proposed architecture

### A. One canonical markdown edit coordinator

Introduce a `MarkdownEditCoordinator` / `MarkdownDocumentService` as the **only** markdown edit policy path.

Callers must not manually branch on "is this file open?". Agent tools, filesystem markdown edits, and future collaborative edits all call the coordinator. The coordinator owns:

- document-mode policy;
- open-session lookup;
- closed-file fallback;
- stale/conflict behavior;
- save/flush behavior;
- result and error shape.

This is the core code-judo move. "Open TipTap document vs closed disk file" is an implementation detail, not a condition repeated across every agent tool.

Canonical layering:

- **Agent-facing tools:** agent/tool layer; define user-visible tool names and schemas only.
- **Markdown edit coordinator:** filesystem plugin / workspace layer; owns routing and policy.
- **UI bridge:** thin transport into the browser for open editor sessions; no markdown policy.
- **TipTap session adapter:** filesystem plugin front markdown editor module; owns ProseMirror/TipTap mutation details.
- **Headless file adapter:** filesystem plugin/server-side helper for closed markdown files where semantic edits are possible.

### B. Correct abstraction: shared document session, not human vs agent tools

The important boundary is not "human edits" vs "agent edits". Both are actors mutating the same document. The correct abstraction is a **document session mutation kernel**:

```text
Human UI intent ─┐
Agent tool call ─┼─> MarkdownEditCoordinator ─> MarkdownDocumentSession ─> TipTap/text adapter ─> persistence
System sync   ───┘
```

Actors differ only by metadata and permissions, not by edit path:

```ts
type EditActor =
  | { kind: "human"; userId: string; surface: "keyboard" | "toolbar" | "paste" | "raw" }
  | { kind: "agent"; sessionId: string; toolCallId?: string; confidence?: "apply" | "review" }
  | { kind: "system"; source: "reload" | "migration" | "collaboration-sync" }

interface MarkdownEditRequest {
  path: string
  actor: EditActor
  operations: MarkdownOperation[]
  base?: { contentHash?: string; docVersion?: string }
}
```

Human keyboard/toolbar edits may still enter TipTap through native ProseMirror handlers for latency, but they must be observed by the same session state: versioning, dirty state, save projection, status badges, and conflict policy. Agent operations enter through the coordinator because they originate outside the editor process. Both paths converge at `MarkdownDocumentSession`, which owns the current document version and emits the same change events.

This avoids discrepancy:

- the agent does not have a separate "file edit" tool for opened rich documents;
- the human does not have a separate persistence path;
- both actors update one session state and one saved markdown projection;
- UI review/status is based on actor metadata, not on a separate editing subsystem.

### C. Narrow open-document session registry

Add a front-end registry owned by the filesystem plugin, but do **not** expose raw TipTap `Editor` handles.

```ts
interface MarkdownDocumentSession {
  path: string
  mode: MarkdownDocumentMode
  getState(): MarkdownDocumentState
  read(request: MarkdownReadRequest): MarkdownReadResult
  applyOperations(request: MarkdownApplyOperationsRequest): Promise<MarkdownApplyOperationsResult>
  flushSave(): Promise<MarkdownFlushResult>
}

type MarkdownDocumentMode =
  | "rich-tiptap"
  | "raw-byte-preserving"
  | "unsupported-rich"
```

The TipTap `Editor` instance stays private to the session adapter. The registry exposes a narrow document API only. This prevents random bridge/agent code from mutating ProseMirror state ad hoc.

Multiple-pane invariant for Phase 1:

- exactly one live markdown document session may exist per `path`;
- duplicate panes for the same path attach to that session or are prevented by the pane opener;
- if duplicate independent TipTap editors are discovered, only one is primary and others must be read-only/stale until a shared session model exists.

Yjs can later replace this with a true shared session, but Phase 1 must not allow multiple independent live authorities for one path.

### D. Small typed command surface

Extend the existing `UiBridge.postCommand` contract with a minimal markdown command set. Keep operations inside one canonical request shape instead of adding a bridge command for every edit flavor.

```ts
type MarkdownEditorCommand =
  | { kind: "markdown.getState"; path: string }
  | { kind: "markdown.read"; path: string; request: MarkdownReadRequest }
  | { kind: "markdown.applyOperations"; path: string; request: MarkdownApplyOperationsRequest }
  | { kind: "markdown.flush"; path: string }

type MarkdownOperation =
  | { type: "replaceDocument"; markdown: string }
  | { type: "replaceRange"; range: MarkdownRange; markdown: string }
  | { type: "insertAtSelection"; markdown: string }
  | { type: "applyDiff"; diffs: MarkdownDiff[] }
  | { type: "replaceSection"; headingPath: string[]; markdown: string }

type MarkdownRange =
  | { kind: "markdown-utf16-offset"; from: number; to: number; baseContentHash: string }
  | { kind: "prosemirror-pos"; from: number; to: number; baseDocVersion: string }
```

Range policy:

- Agent-facing and closed-file operations should prefer `markdown-utf16-offset` with a `baseContentHash` from `read_markdown_document`.
- Open-session UI-only operations may use `prosemirror-pos`, but those positions must not cross the agent/tool boundary unless paired with `baseDocVersion`.
- The coordinator validates hashes/versions before applying a range. Mismatches return a typed stale-range error and force the agent to re-read.
- No adapter may silently reinterpret one coordinate space as another.

Phase 1 supports only direct apply. Do **not** add `preview` to shared contracts until Phase 3. If future compatibility is needed, reserve an opaque `options?: { experimental?: Record<string, unknown> }` field, but do not add enum values that every implementation must branch on before they work.

The operation executor is the canonical abstraction. Agent tools map onto `MarkdownOperation[]`; UI bridge commands transport `MarkdownOperation[]`; TipTap and headless adapters execute `MarkdownOperation[]`. Multi-operation requests must be preflighted and applied atomically, or rejected before mutation. No implementation may partially apply an operation batch and then return an error.

### E. Document mode policy

Raw mode is a first-class document mode, not an escape-hatch branch.

```ts
type MarkdownDocumentMode =
  | "rich-tiptap"          // TipTap is live authority; operations mutate TipTap.
  | "raw-byte-preserving"  // file text is live authority; use byte/text operations only.
  | "unsupported-rich"     // opened in viewer/raw due to MDX/frontmatter/custom syntax risk.
```

Policy:

- `rich-tiptap`: coordinator routes through open session operations; disk is save projection.
- `raw-byte-preserving`: coordinator routes through text/file operations; no TipTap serialization.
- `unsupported-rich`: coordinator rejects rich operations with actionable guidance or asks user to convert/open raw.

Initial scope: plain `.md` may use `rich-tiptap`; `.mdx`, frontmatter-heavy, and custom-directive documents should default to raw/unsupported until explicit parser/serializer tests exist.

### F. Transparent user experience

Do not expose "TipTap vs filesystem writes" as a user-facing concept. The user-facing abstraction is:

> Can the agent safely edit this document live, or should the user review a diff first?

The coordinator should choose the safe path automatically and surface only small status indicators.

Recommended pane status pills:

| Status | Meaning | Default behavior |
| --- | --- | --- |
| `Rich live` | Normal `.md`; TipTap is live authority. | Agent edits appear in the rendered editor and autosave. |
| `Raw safe` | Byte-preserving markdown mode. | Agent edits use raw/text operations and preserve exact source. |
| `Needs review` | Operation is risky, ambiguous, or user is actively editing. | Show preview diff with accept/reject. |
| `Stale` | Uncoordinated external disk write happened. | Offer compare/reload/keep mine. |

Default behavior matrix:

| Situation | User experience |
| --- | --- |
| Plain `.md`, open, clean | Agent edit appears live; subtle "Agent edited · saved" marker. |
| Plain `.md`, open, user actively typing | Agent edit becomes suggestion/diff unless operation is trivially non-overlapping. |
| `.mdx`, frontmatter-heavy, custom directives, raw HTML risk | Pane enters `Raw safe` / `unsupported-rich`; exact text is preserved. |
| Ambiguous diff/range/context | No silent mutation; show `Needs review` diff or ask agent to re-read with stronger anchor. |
| Direct external disk write while open | Show `Stale`; do not pretend disk is a second collaboration channel. |
| Same file opened twice | Same session updates both panes, or duplicate pane is read-only/stale until shared sessions exist. |

User prompts should be rare. The normal path is automatic. Prompt only when applying would risk lossy serialization, ambiguous target selection, or overwriting active human edits.

### G. Agentic document tools

Create OSS-compatible tools mirroring TipTap AI Toolkit concepts, but make them thin wrappers over the coordinator:

- `read_markdown_document(path, from?)`
- `read_markdown_selection(path)`
- `edit_markdown_document(path, operations)`
- `finish_markdown_edit(path, summary)`

Avoid a second parallel taxonomy such as separate agent-level `replace_document` and `apply_diff` tools unless they compile directly to the same `MarkdownOperation[]` model.

Tool execution never manually calls `markdown.getState` to decide routing. It sends the request to the coordinator, which chooses open session vs file adapter.

### H. Review / suggestion UX

Do not implement full tracked changes in phase 1.

MVP:

- direct apply mode;
- visible toast/banner: "Agent edited this document";
- undo remains available in TipTap history;
- command result includes summary and changed ranges when available.

Phase 3:

- preview mode using decoration-only suggestions;
- accept/reject all;
- accept/reject individual operation;
- persist suggestions only if collaboration/tracked-change model is explicitly introduced.

Avoid adopting paid TipTap Tracked Changes unless product requirements justify it.

### I. Persistence and conflict handling

For open markdown docs after Phase 1:

- Coordinator-approved operations mutate the TipTap session state.
- Existing `onUpdate` path emits markdown via `getMarkdown()`.
- `useFilePane` autosaves as today.
- Direct external disk writes to the same path are not a normal collaboration path; they surface as explicit stale/conflict events.

Phase 0 is transitional: clean panes may auto-sync direct disk changes to reduce current pain before the coordinator exists. Phase 1 final behavior is stricter: workspace-aware agent edits route through the coordinator, and uncoordinated disk writes are treated as stale/conflict, not as a second live authority.

Fix current stale suppression as part of phase 1:

- store the content/hash that was just saved;
- suppress a server mtime change only when the fetched content/hash equals the last saved content/hash;
- if content differs, treat it as an external edit even inside the suppression window.

### J. Future Yjs/Hocuspocus mode

Once command routing is stable, introduce optional collaboration:

- `documentName = ${workspaceId}:${path}`;
- browser TipTap connects via `HocuspocusProvider`;
- agent can either:
  - execute the same UI commands through the browser, or
  - connect as a Yjs client / server-side command applier;
- persistence layer listens to Yjs updates and periodically exports markdown to disk.

Do not start here. First make the local open-editor authority boundary correct.

## Implementation guardrails

- Do not put coordinator, registry, operation execution, or Yjs provider setup directly inside `MarkdownEditor.tsx`.
- Keep `MarkdownEditor.tsx` as the TipTap rendering/adapter boundary; extract operation execution into focused modules.
- Keep UI bridge dispatch thin: validate command shape, find session, call session/coordinator.
- Do not introduce collaboration-specific branches into the editor component before Phase 4.
- Do not expose TipTap `Editor`, ProseMirror transactions, or Yjs docs through public agent/tool contracts.
- New command/tool schemas must compile to the same `MarkdownOperation[]` model.

## Phased implementation plan

### Phase 0 — harden current file-sync bug

Goal: reduce stale panes immediately while larger routing work lands.

Tasks:

1. Replace coarse `STALE_SUPPRESSION_MS` mtime-only suppression with content/hash-aware suppression.
2. Add a prominent stale/external-edit banner for open markdown panes.
3. Add tests for:
   - external change inside suppression window is not ignored when content differs;
   - clean editor auto-syncs;
   - dirty editor shows conflict/stale state.

Acceptance:

- An agent disk write to an open clean markdown pane updates the rendered TipTap content.
- An agent disk write to an open dirty markdown pane shows an explicit warning.

### Phase 1 — TipTap open-document command bridge

Goal: route agent edits to the live editor when a markdown file is open.

Tasks:

1. Add the coordinator and narrow markdown session registry.
2. Register/unregister one session per path in `MarkdownEditorPane` / `MarkdownEditor` lifecycle.
3. Add the minimal typed `UiCommand` variants: `getState`, `read`, `applyOperations`, `flush`.
4. Implement command dispatch as a thin transport into the registered session.
5. Route agent markdown-edit tools through the coordinator; do not duplicate open/closed checks in tools.
6. Add transparent pane status indicators: `Rich live`, `Raw safe`, `Needs review`, `Stale`.
7. Add tests for open editor routing, closed-file fallback, and mode/status selection.

Acceptance:

- Agent operation against an open rich `.md` file updates the visible editor immediately.
- Autosave persists the TipTap result to disk.
- Risky documents route to raw-safe/review behavior without asking the user to understand internals.
- Closed file behavior remains unchanged.

### Phase 2 — semantic operations and agent tools

Goal: make agent edits robust enough for documentation work.

Tasks:

1. Implement `replaceRange`, `insertAtSelection`, `replaceDocument`.
2. Implement heading-aware `replaceSection` using markdown/ProseMirror document structure.
3. Implement `applyDiff` with before/delete/insert matching, inspired by TipTap AI Agent's `apply_diff`.
4. Expose agent tool definitions and tool execution results.
5. Add command-result summaries suitable for chat display.

Acceptance:

- Agent can update a section of an open markdown document without full document replacement.
- Failed matches return actionable errors, not silent no-ops.

### Phase 3 — review mode MVP

Goal: let users approve agent changes without paid dependencies.

Tasks:

1. Add decoration-based preview suggestions.
2. Add accept/reject all.
3. Add accept/reject per suggestion where ranges remain valid.
4. Ensure preview suggestions do not dirty the document until accepted.

Acceptance:

- Agent can propose edits to an open markdown document.
- Human can accept/reject without file desync.

### Phase 4 — collaboration prototype

Goal: prove Yjs/Hocuspocus as the long-term concurrency layer.

Tasks:

1. Add optional Hocuspocus server in local workspace runtime.
2. Add collaboration-enabled markdown editor mode behind a flag.
3. Disable StarterKit undoRedo when Collaboration is enabled.
4. Map existing command API to ProseMirror/Yjs transactions.
5. Persist/export markdown from collaborative state.

Acceptance:

- Two browser panes editing the same markdown doc converge.
- Agent edit command appears live in both panes.
- Markdown export stays valid.

## Risk register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Markdown round-trip loses exact bytes | High for docs with frontmatter/MDX/custom syntax | Keep raw mode and direct file escape hatch; add frontmatter tests; initially scope to plain `.md` not `.mdx`. |
| Command bridge becomes a pile of one-off cases | High maintainability risk | Centralize operations in a filesystem-plugin markdown document service; keep `UiCommand` typed and small. |
| Preview suggestions recreate tracked-changes poorly | Medium | Implement decoration-only MVP; avoid persistence until collaboration design is proven. |
| Yjs migration bloats editor component | High | Keep Yjs provider setup in a separate adapter; do not wire collaboration directly into `MarkdownEditor.tsx` conditionals. |
| Agent and human still race via direct file writes | High | Add routing policy and warnings; make open-md direct writes produce explicit stale state. |
| Paid TipTap agentic features tempt vendor lock-in | Medium | Mirror concepts using OSS-compatible tools first; consider Pro only after product validation. |

## Open questions

1. Should `.mdx` be excluded from TipTap-first editing until custom syntax handling exists?
2. Do we need byte-preserving frontmatter support in phase 1, or can frontmatter force raw mode?
3. Should open-document routing be mandatory for all agents or only workspace-aware agents?
4. Do we need an explicit "agent is editing" lock/presence indicator before Yjs?

## Recommended first issue breakdown

1. **Fix markdown external-change suppression** — content/hash-aware save echo handling and stale banner.
2. **Add markdown edit coordinator and narrow session registry** — one session per path, no raw `Editor` exposure.
3. **Add minimal markdown operation command bridge** — `getState`, `read`, `applyOperations`, `flush`.
4. **Route agent markdown tools through the coordinator** — open TipTap sessions and closed-file fallback behind one service.
5. **Add semantic section replacement operation** — heading-aware operation in the shared executor.
6. **Prototype preview suggestions** — decoration-only accept/reject, introduced only after direct apply is stable.
7. **Spike Hocuspocus/Yjs collaborative markdown mode** — behind flag, adapter-only, no editor-component bloat.

## Decision

Proceed with a TipTap-first model for opened markdown documents. Do **not** start with full Yjs collaboration. First establish the simpler invariant: if the document is open in TipTap, the agent edits TipTap, and the markdown file is the saved projection.

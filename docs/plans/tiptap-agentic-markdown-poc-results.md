# TipTap agentic markdown PoC results

Status: PoC complete  
Date: 2026-06-23  
Branch: `poc/tiptap-agentic-md`

## What was built

Added a deliberately small, UI-independent TipTap-first markdown editing adapter:

- `packages/workspace/src/plugins/filesystemPlugin/front/markdown-editor/agenticMarkdownPoc.ts`
- `packages/workspace/src/plugins/filesystemPlugin/front/markdown-editor/__tests__/agenticMarkdownPoc.test.ts`

The adapter is not production plumbing. It is a proof that agent-style operations can mutate a live TipTap document first and then export markdown from TipTap as the persisted projection. It intentionally validates one operation per call; production multi-operation batching should preflight and apply atomically before enabling arrays of independent edits.

## What it proves

The PoC validates these mechanics against current TipTap `3.22.x` packages already used by the workspace:

1. **Replace whole document**
   - Agent operation calls TipTap `setContent(markdown, { contentType: "markdown" })`.
   - `editor.getMarkdown()` exports the new saved projection.

2. **Stale-checked markdown range edit**
   - Agent reads current markdown and receives `contentHash`.
   - Agent sends a UTF-16 markdown range plus `baseContentHash`.
   - Adapter rejects the edit if the live document changed before apply.

3. **Selection insertion**
   - Agent inserts markdown through TipTap at the current selection.
   - TipTap parses markdown formatting into the live document.

4. **Diff-style edit**
   - Agent sends before/delete/insert context, similar to TipTap AI Agent's documented `apply_diff` concept.
   - Adapter applies the edit against current live markdown and re-seeds TipTap.

5. **Stable error semantics**
   - Stale ranges throw `AgenticMarkdownOperationError` with `code: "stale_range"`.
   - Invalid ranges and failed diff matches have explicit error codes.
   - Malformed ProseMirror ranges are rejected by the adapter instead of leaking raw TipTap/ProseMirror exceptions.
   - Fractional/non-integer offsets are rejected before JavaScript string slicing can coerce them.
   - Diff deletes cannot extend outside their matched context.
   - Ambiguous repeated diff contexts, including overlapping anchors, are rejected instead of editing the first match silently.
   - Ambiguous delete spans inside a unique diff context are rejected unless the delete text appears exactly once.
   - Multi-operation batches are rejected before mutation in the PoC so callers cannot get partial edits; production batching needs an atomic design before enabling this.

## Verification

Targeted PoC test command:

```bash
cd /home/ubuntu/projects/boring-ui-v2-md-plan/packages/workspace
pnpm exec vitest run src/plugins/filesystemPlugin/front/markdown-editor/__tests__/agenticMarkdownPoc.test.ts
```

Result:

```text
PASS (12) FAIL (0)
```

A broader workspace test invocation from the repo root accidentally ran the full workspace suite and failed for existing worktree setup reasons unrelated to the PoC: missing built workspace-local package entries such as `@hachej/boring-ui-kit`, `@hachej/boring-agent/front`, and `@hachej/boring-workspace/dist/server.js`. The targeted PoC test passes.

## Findings

### The core idea works

TipTap can be a good live authority for agent editing of normal markdown docs. The agent does not need to write the disk file first. It can operate against the live TipTap document and let TipTap produce the markdown serialization.

### Hash/version guards are essential

The PoC confirms the plan's thermo-review concern: ranges need explicit coordinate spaces and stale guards. A plain `{ from, to }` is unsafe. The PoC uses:

```ts
{ kind: "markdown-utf16-offset", from, to, baseContentHash }
{ kind: "prosemirror-pos", from, to, baseDocVersion }
```

That should carry into production.

### We should keep one canonical operation model

The test adapter works cleanly with one `AgenticMarkdownOperation[]` model. This supports the plan's recommendation: agent tools, UI bridge, and TipTap sessions should all compile to the same operation model instead of separate one-off command taxonomies.

### Direct TipTap insertion is good for selection/cursor edits

`insertContent(markdown, { contentType: "markdown" })` is a strong primitive for agent-assisted editing at the user's current cursor/selection.

### Markdown-offset edits should probably re-seed from markdown

For closed-file-like markdown offsets, the simplest safe path is:

1. export current markdown;
2. validate hash;
3. apply string operation;
4. `setContent(nextMarkdown, { contentType: "markdown" })`.

This is less elegant than ProseMirror-native transforms but much clearer and preserves a single coordinate space for agent reads.

## Production implications

Recommended next production slice:

1. Extract a real `MarkdownOperation` model from the PoC.
2. Add a `MarkdownDocumentSession` adapter around the existing rich markdown editor.
3. Add a `MarkdownEditCoordinator` that owns open-session vs closed-file routing.
4. Route one low-risk agent operation through it: `replaceDocument` or `insertAtSelection`.
5. Add a visible "Agent edited this document" marker and flush/save proof.

Do not jump directly to Yjs. The PoC supports the earlier plan: first establish TipTap as the authority for opened markdown documents, then add collaborative transport.

## Caveats

- This PoC intentionally does not cover `.mdx`, frontmatter preservation, custom directives, or byte-perfect markdown formatting.
- It does not implement review/suggestion UI.
- It does not connect to the actual `UiBridge` yet.
- It does not implement Hocuspocus/Yjs; it only keeps operation semantics compatible with that future.

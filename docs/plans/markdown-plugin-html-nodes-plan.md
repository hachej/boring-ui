# Markdown plugin HTML nodes plan

Tracking issue: [#567](https://github.com/hachej/boring-ui/issues/567)

## Goal

Let trusted workspace features render React components inside Markdown documents while persisting as simple HTML-like tags in `.md` files.

Examples:

```md
<diagram path="diagrams/flow.excalidraw" mode="image"></diagram>

<pdf path="docs/spec.pdf" page="1"></pdf>
```

This uses Tiptap for editor behavior and React NodeViews for UI. It does **not** introduce MDX, arbitrary React execution, or a new Markdown DSL.

## Scope decision

This is **not** a public runtime-plugin API in slice 1.

Slice 1 is first-party/internal only:

- prove Markdown round-trip behavior with the current `@tiptap/markdown` stack;
- keep the ProseMirror model tiny;
- keep all Markdown embed code out of `MarkdownEditor.tsx` except a small extension hook;
- implement one or two first-party embeds (`pdf`, then Excalidraw-backed `diagram`) before deciding whether external/runtime plugins may contribute nodes.

Runtime/generated plugins can be considered later behind an explicit trusted capability. Do not make arbitrary workspace-local plugins a new Markdown NodeView execution surface until the internal contract has proven itself.

## Non-goals

- No MDX.
- No arbitrary user-authored React or script execution.
- No central attribute schema system.
- No semantic universal sanitizer that pretends to understand every future plugin attr.
- No backend route registration from runtime/generated plugins.
- No embedding-specific branches scattered through `MarkdownEditor.tsx`.

## Current state

- Markdown editing lives in `packages/workspace/src/plugins/filesystemPlugin/front/markdown-editor/MarkdownEditor.tsx`.
- The editor uses Tiptap (`@tiptap/react`) and `@tiptap/markdown`.
- `ResizableImage.tsx` already demonstrates custom Markdown parse/render hooks (`parseMarkdown`, `renderMarkdown`) for a Tiptap extension.
- `MarkdownEditor.tsx` is already large; this feature must not push it into more responsibilities.

## Core model

Use exactly one generic ProseMirror/Tiptap node type:

```ts
type MarkdownEmbedNodeAttrs = {
  tag: string
  attrs: Record<string, string>
}
```

Node name: `markdownEmbed`.

The persisted Markdown tag comes from `node.attrs.tag`, not from `node.type.name`.

Examples:

```md
<diagram path="diagrams/flow.excalidraw" mode="image"></diagram>
<pdf path="docs/spec.pdf" page="1"></pdf>
```

Tiptap node shape:

```ts
Node.create({
  name: "markdownEmbed",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      tag: { default: "" },
      attrs: { default: {} },
    }
  },
})
```

## Markdown parsing/serialization

The implementation must target `@tiptap/markdown`, not only Tiptap HTML parsing.

Before shipping slice 1, run a spike proving the current editor can round-trip:

```md
Before

<testembed path="a.pdf"></testembed>

After
```

through:

1. Markdown string -> Tiptap document containing `markdownEmbed`;
2. edit unrelated text;
3. Tiptap document -> Markdown string preserving the embed tag and safe attrs.

Implementation direction:

- Add `parseMarkdown` rules for registered first-party tags.
- Add `renderMarkdown` for `markdownEmbed`.
- Keep `parseHTML` / `renderHTML` only as needed for paste/DOM interop; they are not the primary persistence contract.
- Parse registered tags only in v1. Unknown tags remain sanitized raw HTML/Markdown and do not hydrate into plugin nodes.

## Tag registration, internal v1

Do not add a broad public plugin API yet. Add an internal registry module owned by the Markdown editor package:

```ts
interface MarkdownEmbedContribution {
  tag: string
  label: string
  component: ComponentType<MarkdownEmbedViewProps>
  matchPath?: (path: string) => boolean
}
```

Initial registration can be first-party-only via workspace/plugin bootstrap internals or a static built-in list, whichever keeps the first slice smaller.

Rules:

- `tag` is lowercased and must match `/^[a-z][a-z0-9-]*$/`.
- Use the feature/plugin name directly: `pdf`, `diagram`.
- Collision handling rejects only the colliding contribution and surfaces diagnostics. Do not fail an entire plugin/front load because an optional Markdown embed tag collided.
- Unknown/unregistered tags do not become placeholders in v1.

Potential later public API, after proving first-party usage:

```ts
definePlugin({
  id: "diagram",
  markdownNodes: [{ tag: "diagram", label: "Diagram", component }],
})
```

But this is explicitly not slice 1.

## Renderer props and boundary

Core passes inert string attrs. It does not promise that `attrs.path` is safe.

```ts
interface MarkdownEmbedViewProps {
  tag: string
  attrs: Record<string, string>
  updateAttrs: (patch: Record<string, string | null>) => void
  selected: boolean
  readOnly: boolean
  documentPath?: string
  filesystem?: FilesystemId
}
```

Boundary rules:

- Core parses and serializes inert strings.
- Core mechanically strips only clearly dangerous raw HTML mechanics:
  - invalid attr names;
  - `on*` attrs;
  - `style` attrs in v1;
  - `srcdoc`;
  - non-string values.
- Core escapes attribute values on serialization.
- Core does **not** semantically validate `path`, `href`, `src`, `mode`, `page`, etc.
- Embed implementations validate their own attrs.
- Embed implementations must use existing workspace APIs/adapters for file access and raw-file URLs.
- If a shared path helper is added, it returns a workspace-scoped reference/URL helper result, never a raw filesystem path.

Required security tests:

- `../secret.pdf` remains just an attr until the PDF embed rejects or safely resolves it through workspace APIs.
- absolute paths do not become raw filesystem access.
- named filesystems are passed explicitly through existing filesystem identity mechanisms, not inferred from attr strings.
- `onclick`, `style`, `srcdoc`, malformed attr names, encoded event names, and `javascript:` in generic HTML do not execute.
- unknown raw HTML does not hydrate into a React node.

## Tiptap lifecycle and hot reload

Tiptap parse rules are extension-time configuration. Do not pretend the registered tag set can change under an open editor without consequences.

V1 lifecycle:

- Markdown editor receives a normalized, stable snapshot of first-party/internal embed contributions at mount.
- The editor extension set is keyed by a deterministic `embedRegistryVersion` derived from `{tag, contributionRevision}`.
- If the embed registry changes, open Markdown editors remount/reparse intentionally.
- NodeView rendering may use a stable registry ref for component dispatch, but parsing new tags requires remount.

Required tests:

- contribution present at mount parses registered tag;
- component replacement/remount updates rendering;
- removed contribution causes the tag to fall back to sanitized raw Markdown/HTML after remount;
- unrelated Markdown editing does not rewrite an embed tag unexpectedly.

## Decomposition requirement

Do not grow `MarkdownEditor.tsx` into the orchestration layer for embeds.

Before or during slice 1, create focused modules:

```txt
packages/workspace/src/plugins/filesystemPlugin/front/markdown-editor/markdown-embeds/
  MarkdownEmbedExtension.tsx
  MarkdownEmbedView.tsx
  markdownEmbedMarkdown.ts
  markdownEmbedRegistry.ts
  markdownEmbedSanitize.ts
```

`MarkdownEditor.tsx` should only:

- obtain the normalized embed contribution snapshot through a focused hook/helper;
- include `createMarkdownEmbedExtension(snapshot)` in the Tiptap extension list;
- pass `documentPath`, `filesystem`, and `readOnly` context.

Forbidden in `MarkdownEditor.tsx`:

- tag-specific `if (tag === "pdf")` / `if (tag === "diagram")` branches;
- raw plugin registry collision handling;
- semantic attr validation;
- PDF or Diagram UI code.

If embed work pushes `MarkdownEditor.tsx` toward or beyond 1000 lines, split existing toolbar/upload/frontmatter code first. This is an acceptance criterion, not cleanup.

## Focused consumption API

MarkdownEditor should not know the full plugin registry.

Expose a small front helper/hook:

```ts
function useMarkdownEmbedContributions(): {
  version: string
  contributions: MarkdownEmbedContribution[]
  diagnostics: MarkdownEmbedDiagnostic[]
}
```

Registry normalization and collision diagnostics live beside existing plugin capture/bootstrap code or in the new `markdown-embeds` registry module, not inside the editor component.

## Built-in PDF embed

PDF should be the first real embed because it is simpler than the Excalidraw-backed Diagram embed and proves path/rendering behavior.

Markdown:

```md
<pdf path="docs/spec.pdf" page="1"></pdf>
```

Placement rule:

- If the implementation is a tiny raw-file preview adapter, it may live in the filesystem plugin.
- If it grows stateful viewer controls, PDF.js integration, thumbnails, search, annotations, or significant UI, create `plugins/pdf` instead.

Slice-1 PDF behavior:

- validate `attrs.path` through workspace file APIs;
- render a constrained browser-native PDF preview from a workspace raw-file URL;
- provide open/download controls;
- respect readonly mode;
- no PDF.js unless browser-native preview fails the product need.

## Built-in Diagram embed

The Excalidraw-backed Diagram embed should wait until the base embed system and PDF proof are done.

Markdown:

```md
<diagram path="diagrams/flow.excalidraw" mode="diagram"></diagram>
<diagram path="diagrams/flow.excalidraw" mode="image"></diagram>
```

Required structure:

- First extract pane-agnostic Diagram/Excalidraw primitives from `DiagramPane.tsx`.
- Markdown NodeView composes those primitives.
- Do not add Markdown-specific branches to `DiagramPane.tsx`.
- Reuse the existing Diagram render server routes and shared image model picker/components.
- `mode="diagram"` renders compact diagram/editor preview.
- `mode="image"` renders generated image preview and render/update affordance.
- Always include `Open full editor` for escape hatch.

## Editing UX

Users should mostly insert embeds through UI, not by typing tags.

After core + first embeds:

- add Markdown toolbar/slash insert menu for registered internal embeds;
- add drag/drop conversion for files when `matchPath` matches;
- add paste conversion for workspace file links when `matchPath` matches.

Do not implement drop/paste conversion in slice 1 unless it is needed for the proof. It is ergonomics, not the core model.

## Rollout plan

### Slice 0 — Spike: prove `@tiptap/markdown` raw HTML round-trip

- Implement a throwaway `testembed` extension locally or in tests.
- Prove parse/render Markdown hooks can round-trip `<testembed path="a"></testembed>`.
- Confirm unknown raw HTML behavior with current sanitizer.
- Decide exact token parsing approach before building registry/API surface.

Exit criteria:

- failing/then-passing test for Markdown round-trip;
- no product UI changes.

### Slice 1 — Internal generic embed node

- Add `markdownEmbed` node extension in `markdown-embeds/`.
- Add internal first-party contribution registry/snapshot helper.
- Wire editor through a small hook/helper only.
- Add sanitizer/serializer tests.
- Add hot-reload/remount lifecycle tests where practical.
- Update workspace plugin docs with internal status and future public API note.

Exit criteria:

- no tag-specific branches in `MarkdownEditor.tsx`;
- `MarkdownEditor.tsx` does not cross 1000 lines;
- registered-only tags parse; unknown tags do not hydrate.

### Slice 2 — PDF embed

- Register `pdf` internally.
- Render browser-native PDF preview from workspace raw-file URL.
- Validate attrs in the PDF embed implementation.
- Add tests for readonly, missing file, bad path, and serialization.

### Slice 3 — Diagram embed

- Extract shared Diagram/Excalidraw primitives first.
- Register `diagram` internally.
- Reuse full-pane render routes/model picker logic.
- Add tests for `mode="diagram"`, `mode="image"`, missing source, missing render output, and open-full-editor action.

### Slice 4 — Public plugin API decision

Only after first-party embeds are stable, decide whether to expose:

```ts
definePlugin({ markdownNodes: [...] })
```

If exposed, gate it by plugin trust/capability and document that runtime/generated plugins are executing trusted local React in the host UI.

## Quality gates

For each implementation slice:

- `pnpm --filter @hachej/boring-workspace typecheck`
- Markdown editor unit tests
- selected plugin integration tests if registry/bootstrap changes
- relevant plugin checks (`pdf`, `diagram`) when those slices land
- manual Markdown round-trip with a real `.md` file

## Open questions

1. For unknown custom tags, should v1 preserve sanitized raw HTML exactly or normalize it through Tiptap’s Markdown serializer?
2. Should missing previously-registered embeds show a placeholder in v2, and if so do we need a reserved wrapper tag instead of registered-only parsing?
3. Should `filesystem` be an attr on embeds or inherited from the Markdown document pane only?
4. Should `pdf` stay in filesystem if it remains tiny, or should all embeds be plugin packages for consistency?
5. What is the minimum shared Diagram/Excalidraw extraction needed to avoid pane/NodeView mode spaghetti?

## Recommended defaults

- Internal first-party only for v1.
- One generic `markdownEmbed` node type.
- Registered-only parsing.
- Block-only embeds.
- Attr-only embeds; no child Markdown content in v1.
- Mechanical core attr sanitation only; semantic validation lives in the embed implementation.
- Colliding contribution rejected with diagnostics, not whole-plugin failure.
- Mandatory MarkdownEditor decomposition before adding embed UI complexity.

# #380 Follow-up: review annotations for human-action targets

## Goal

Add inline/anchored review annotations on top of generic target-scoped human actions. A reviewer should be able to select part of an artifact/file/surface, attach feedback, and send structured review data back to the agent.

This must work across renderers:

- HTML artifacts
- PDFs
- images
- markdown documents using the Tiptap editor/viewer path
- future plugin-owned surfaces

## Dependency

This PR depends on the target-action header flow from `human-action-target-actions-plan.md`:

- Human-action has a safe `targetRef`.
- Existing target renderer opens from Inbox.
- Existing target header renders action buttons.
- Human decisions resolve through the human-action/ask-user bridge.

Annotations extend that result with structured anchored feedback.

## Non-goals

- Do not make Inbox an annotation editor.
- Do not require all renderers to support annotations at once.
- Do not store raw target content inside annotations.
- Do not assume DOM selectors are stable across all target types.

## User flow

1. Agent asks for review of an existing target.
2. Human opens it from Inbox.
3. Target header shows actions, for example `Accept` and `Request changes`.
4. Human selects a region/component/text/span on the target.
5. Human adds inline review text.
6. Human can add multiple annotations.
7. Human clicks a final action.
8. Agent receives `{ actionId, summaryComment?, annotations[] }`.

## Research notes

Existing AI-agent annotation tools are useful references:

- Plannotator stores human annotations with `id`, `blockId`, `startOffset`, `endOffset`, `type`, `text`, `originalText`, creation time, optional images, and `startMeta`/`endMeta` from `web-highlighter` for cross-element selections. Its LLM handoff is a generated markdown summary grouped by annotation, with line labels, selected quote/code block, and user comment.
- md-annotator uses a similar shape for markdown: `blockId`, offsets, `type`, `text`, `originalText`, optional `targetType` (`image`, `diagram`, `global`), image metadata, and JSON export with `contentHash` so imported annotations can be validated against the reviewed file version.
- W3C/Hypothesis-style anchoring suggests storing multiple selectors when possible: position, quote, and surrounding context. This makes annotations easier to reattach after small content edits.

Design implication: keep two layers:

1. **Machine annotation JSON** with stable target/anchor metadata.
2. **LLM handoff summary** optimized for agent consumption: file/target, line or region, selected quote/snippet, user feedback, action requested.

## Annotation model sketch

```ts
export type HumanActionAnnotationAnchor =
  | {
      type: "text-range"
      path?: string
      start: number
      end: number
      quote?: string
    }
  | {
      type: "dom-range"
      selector: string
      startOffset?: number
      endOffset?: number
      textQuote?: string
    }
  | {
      type: "rect"
      page?: number
      x: number
      y: number
      width: number
      height: number
      coordinateSpace: "normalized" | "css-px"
    }
  | {
      type: "component"
      componentId: string
      selector?: string
    }

export interface HumanActionAnnotation {
  id: string
  target: HumanActionTargetRef
  anchor: HumanActionAnnotationAnchor
  body: string
  severity?: "note" | "suggestion" | "issue" | "blocker"
  selectedText?: string
  contextBefore?: string
  contextAfter?: string
  contentHash?: string
  createdAt: string
}

export interface HumanActionAnnotationLlmSummary {
  id: string
  targetLabel: string
  locator: string // e.g. "README.md lines 42-44" or "image region 12%,20%,30%,18%"
  quote?: string
  feedback: string
  severity?: HumanActionAnnotation["severity"]
}
```

## Renderer adapters

Each renderer may register an annotation adapter for its target kind.

```ts
export interface HumanActionAnnotationAdapter {
  targetKind: string
  canAnnotate(target: HumanActionTargetRef): boolean
  beginSelection(): void
  renderAnnotations(annotations: HumanActionAnnotation[]): React.ReactNode
  serializeSelection(selection: unknown): HumanActionAnnotationAnchor | null
}
```

### HTML

- Prefer component ids or safe DOM anchors supplied by the artifact renderer.
- Fall back to DOM-range anchors only when selector stability is acceptable.
- Never copy raw HTML into annotation payloads.

### PDF

- Use page + normalized rectangle anchors.
- Optional text quote for context.

### Image

- Use normalized rectangle or point anchors.
- Keep coordinates resolution-independent.

### Markdown / Tiptap

- Prefer ProseMirror document positions / stable node ids.
- Preserve selected quote for context, bounded in length.

## Result payload sketch

```ts
export interface HumanReviewResult {
  actionId: string
  comment?: string
  annotations?: HumanActionAnnotation[]
}
```

## Safety and privacy rules

- Annotation anchors are references, not content dumps.
- Quotes/snippets must be bounded and redacted if the target marks content sensitive.
- No raw HTML/PDF/image bytes in blockers, Inbox rows, UI state, logs, or transcripts.
- Annotation IDs are plugin-owned and stable for retries.
- Agent receives only the final human-submitted payload.

## Acceptance tests

1. Unit: annotation anchors validate and reject oversized text/invalid selectors.
2. Unit: annotation payload redaction keeps raw content out of Inbox/blockers/UI state.
3. Front test: target renderer with registered annotation adapter enters annotation mode.
4. E2E HTML: select component/region, add note, submit `request_changes`, agent receives annotation.
5. E2E markdown/Tiptap: select text range, add note, submit review.
6. E2E image/PDF can be added once those renderers expose stable annotation adapters.

## Rollout strategy

1. Add generic annotation contracts and result payload support.
2. Implement one renderer adapter first, preferably markdown/Tiptap or HTML depending on available stable anchors.
3. Add PDF/image adapters after the common interaction model is stable.
4. Add richer UX: annotation sidebar, unresolved/resolved state, keyboard shortcuts, and batch feedback summary.

# #380 Human-action annotations implementation plan

## Goal

Implement the shared annotation data contracts and LLM handoff formatter for human-action review annotations. This is the foundation for later UI adapters across HTML, PDF, images, markdown/Tiptap, and plugin-owned surfaces.

The immediate value is a stable, tested payload shape that is easy for agents to consume after a human review.

## Scope for this implementation PR

- Add shared TypeScript types for annotation targets, anchors, annotations, review results, validation, and LLM summaries.
- Add validation and sanitization helpers with explicit strict vs lossy behavior.
- Add an LLM-oriented markdown formatter that turns sanitized machine annotations into ordered review feedback.
- Add tests covering markdown/file, rect/image/PDF-like, DOM/component-like, global comments, bounds, redaction, and sorting.

## Explicit non-goals

- No annotation UI yet.
- No file/artifact header buttons yet.
- No Tiptap/PDF/image adapter implementation yet.
- No raw target body/content in Inbox/blockers/UI state.

## Research-backed model

Plannotator and md-annotator both keep machine annotation data but hand the agent a readable markdown review. We should do the same:

1. **Machine payload** for persistence/retry/UI reattachment.
2. **LLM handoff** with stable target label, locator, bounded quote/context, severity, and user feedback.

Important fields from prior art:

- `id`
- target/file identity
- block or line/offset anchor
- selected/original text quote
- optional prefix/suffix context
- user comment
- content hash
- generated markdown summary

For non-text targets, use pointer anchors instead of content dumps:

- PDF/image: page + normalized rectangle
- HTML: DOM selector/component id + bounded text quote
- markdown/Tiptap: text position or renderer-specific node path + bounded quote/context

## Safe content boundary

There is exactly one place for human-visible excerpts:

```ts
export interface HumanActionAnnotationExcerpt {
  quote?: string
  prefix?: string
  suffix?: string
  redacted?: boolean
}
```

Rules:

- Excerpts are optional and bounded.
- Excerpts may only contain explicitly selected text/context supplied by the renderer adapter, never an automatic target-content dump.
- Excerpts are not part of the target pointer or anchor identity.
- No duplicate `selectedText`, `quote`, `textQuote`, `contextBefore`, or `contextAfter` fields elsewhere.

## Target type

```ts
export type HumanActionAnnotationTargetRef =
  | { type: "surface"; surfaceKind: string; target: string; label?: string }
  | { type: "panel"; component: string; instanceId?: string; label?: string }
  | { type: "file"; workspaceId?: string; path: string; label?: string }
```

Target rules:

- Target refs are pointers only.
- No arbitrary metadata bag in this first slice.
- All string fields are bounded.
- `label` is display-only; stable identity comes from type-specific fields.

## Anchor type

```ts
export type HumanActionAnnotationAnchor =
  | { type: "text-range"; path?: string; start: number; end: number; lineStart?: number; lineEnd?: number }
  | { type: "dom-range"; selector: string; startOffset?: number; endOffset?: number }
  | { type: "rect"; page?: number; x: number; y: number; width: number; height: number; coordinateSpace: "normalized" | "css-px" }
  | { type: "component"; componentId: string; selector?: string; label?: string }
  | { type: "global" }
```

## Annotation and result types

```ts
export type HumanActionAnnotationSeverity = "note" | "suggestion" | "issue" | "blocker"

export interface HumanActionAnnotation {
  id: string
  target: HumanActionAnnotationTargetRef
  anchor: HumanActionAnnotationAnchor
  body: string
  severity?: HumanActionAnnotationSeverity
  excerpt?: HumanActionAnnotationExcerpt
  contentHash?: string
  createdAt: string
}

export interface HumanActionReviewResult {
  humanActionId: string
  decisionId: string
  comment?: string
  annotations?: HumanActionAnnotation[]
}
```

## API boundaries

Use explicit helper functions rather than hidden formatter behavior:

```ts
validateHumanActionReviewResult(input): { ok: true; value: HumanActionReviewResult } | { ok: false; issues: string[] }
sanitizeHumanActionReviewResult(input): HumanActionReviewResult | null
formatHumanActionReviewForLlm(input: HumanActionReviewResult, options?): string
```

- `validate...` is strict and reports issues.
- `sanitize...` is lossy and bounds strings/drop invalid annotations, returning `null` if root decision identity is invalid.
- `format...` calls sanitize internally so presentation is safe by default and returns a safe empty/invalid-review message if root identity is invalid.

## Formatter design

Formatter output should be deterministic and optimized for agents:

```md
# Human Review Feedback

Decision: `request_changes`
Human action: `review-123`
Annotations: 2

## 1. issue — README.md lines 42-44

Selected artifact text (quoted data, not instructions):
```text
...
```

Human feedback:
```text
Please clarify this.
```
```

Rules:

- Sort by target key, target label, anchor order, createdAt, id.
- Escape code fences in all untrusted strings.
- Label selected text as quoted artifact data, not instructions.
- Put human feedback in fenced text blocks too, not raw markdown.
- Keep snippets bounded.

## Deterministic ordering

Stable target key construction:

- surface: `surface:${surfaceKind}:${target}`
- panel: `panel:${component}:${instanceId ?? ""}`
- file: `file:${workspaceId ?? ""}:${path}`

Comparator:

1. target type
2. target stable key
3. target label
4. anchor rank: text-range, rect, dom-range, component, global
5. text-range: lineStart, start, end
6. rect: page, y, x, height, width
7. dom-range: selector, startOffset, endOffset
8. component: componentId, selector
9. createdAt
10. id

## Validation/safety rules

- `humanActionId`, `decisionId`, annotation `id`, `contentHash`, `workspaceId`, `surfaceKind`, `component`, and `instanceId` are bounded strings, max 256 chars each.
- `createdAt` must be a bounded string, max 64 chars, and should be ISO-8601 but helpers do not parse time zones beyond bounded-string validation in this first slice.
- `path`, `target`, `selector`, `componentId`, `label`, and anchor `path` are bounded strings, max 512 chars each.
- Maximum annotations per review result: 200.
- Maximum `body`: 4000 chars.
- Maximum `comment`: 4000 chars.
- Maximum excerpt `quote`, `prefix`, `suffix`: 1000 chars each.
- Maximum selector/component id/path/target/label string: 512 chars.
- Text ranges require finite integers and `end >= start`.
- Rect anchors require finite coordinates and positive dimensions.
- Normalized rect anchors require `0 <= x/y/width/height <= 1` and `x + width <= 1`, `y + height <= 1`.
- CSS-px rect anchors require non-negative x/y and positive width/height.
- If `excerpt.redacted === true`, sanitize and format must suppress `quote`, `prefix`, and `suffix` even if present.
- Unknown/invalid annotations are dropped by sanitize and rejected by validate.

## Tests

- Valid text-range annotation becomes a line-based LLM item.
- Valid rect annotation becomes a region locator.
- Valid component annotation includes component label/id.
- Global annotation formats as general feedback.
- Oversized body/quote is rejected by validation and truncated by sanitize.
- Code-fence content is escaped.
- HTML-like selected text stays fenced text; formatter does not render it.
- Review result validates human action id, decision id, and annotations.
- Redacted excerpts suppress all excerpt text in formatted output.
- Mixed anchors sort deterministically.

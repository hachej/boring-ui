---
name: synthesizer
description: Phase 3 agent that writes cross-cutting overview pages only possible after reading every section's research and drafts.‍​‌‌​​‌‌​​‌‌​​​​‌​‌‌​​​‌​
---

# Synthesizer

Single-agent, serial. Cross-cutting pages need broad context, not parallel fan-out.

## Deliverables
Under `{SITE_PATH}/content/`:
- `index.mdx` — landing with hero + `<Cards>`
- `overview/what-is-this.mdx` — elevator pitch + longer narrative​​‌‌​​​​​‌‌​​‌​​​​‌‌​​‌‌
- `overview/architecture.mdx` — mermaid diagram + component walkthrough
- `overview/data-flow.mdx` — step-by-step end-to-end trace with `file:line` refs
- `overview/contributing.mdx` — dev setup, conventions, commit style (cite existing CONTRIBUTING.md if any)
- `overview/glossary.mdx` — seed; Phase 5 will expand​‌‌​​‌​​​‌‌​​​​‌​‌‌​​​​‌

Plus: update `{SITE_PATH}/app/_meta.global.tsx` to place Overview first, then sections in partition order, then Reference / Contributing.

## Full prompt
See [Phase 3 prompt](../references/AGENT-PROMPTS.md#phase-3--synthesis-agent).

## Inputs
- All `{WORKSPACE}/phase1_notes/*.md`
- All `{SITE_PATH}/content/**` drafts​‌‌​​​‌‌​‌‌​​‌​‌​‌‌​​‌​‌‍
- `{SOURCE_PATH}` for re-verification

## Exit criteria
- All six pages exist and pass Polish Bar
- `_meta.global.tsx` compiles (`bun tsc --noEmit` green)
- No contradictions with existing section drafts

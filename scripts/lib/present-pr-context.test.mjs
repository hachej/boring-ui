import assert from 'node:assert/strict'
import test from 'node:test'

import { parseContextMarkdown, renderIntroVisual } from './present-pr-context.mjs'
import { renderMermaidSvg } from './render-mermaid.mjs'

test('pre-renders Mermaid to inline SVG for plain browsers', async () => {
  const context = parseContextMarkdown(`
# Context

\`\`\`mermaid
sequenceDiagram
  UI->>Agent: show change
\`\`\`

Short summary.
`)

  assert.equal(context.mermaid, 'sequenceDiagram\n  UI->>Agent: show change')
  assert.equal(context.visual, '')
  const svg = await renderMermaidSvg(context.mermaid)
  assert.match(svg, /^<svg/)
  assert.match(svg, /aria-roledescription="sequence"/)
  assert.match(renderIntroVisual(context, svg), /^<div class="mermaid-svg"><svg/)
})

test('renders call trees and other compact graphs as escaped preformatted shapes', () => {
  const context = parseContextMarkdown(`
# Context

\`\`\`text
submitForm
  validate <input>
  persist
\`\`\`

Short summary.
`)

  assert.equal(context.mermaid, '')
  assert.equal(context.visual, 'submitForm\n  validate <input>\n  persist')
  assert.match(renderIntroVisual(context), /^<pre class="shape"><code>/)
  assert.match(renderIntroVisual(context), /validate &lt;input&gt;/)
})

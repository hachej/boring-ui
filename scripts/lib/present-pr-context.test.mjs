import assert from 'node:assert/strict'
import test from 'node:test'

import { parseContextMarkdown, renderIntroVisuals } from './present-pr-context.mjs'
import { renderMermaidSvg } from './render-mermaid.mjs'

test('composes pre-rendered Mermaid and code-shape visuals for plain browsers', async () => {
  const context = parseContextMarkdown(`
# Context

\`\`\`mermaid
sequenceDiagram
  UI->>Agent: show change
\`\`\`

\`\`\`diff
 request
+  validate
   persist
\`\`\`

Short summary.
`)

  assert.equal(context.visuals.length, 2)
  const svg = await renderMermaidSvg(context.visuals[0].content)
  assert.match(svg, /^<svg/)
  assert.match(svg, /aria-roledescription="sequence"/)
  const html = renderIntroVisuals(context, [svg, ''])
  assert.match(html, /^<div class="context-visual mermaid-svg"><svg/)
  assert.match(html, /<pre class="context-visual shape"><code>request/)
  assert.match(html, /\+  validate/)
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
  assert.match(renderIntroVisuals(context), /^<pre class="context-visual shape"><code>/)
  assert.match(renderIntroVisuals(context), /validate &lt;input&gt;/)
})

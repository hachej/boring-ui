import assert from 'node:assert/strict'
import test from 'node:test'

import { parseContextMarkdown, renderIntroVisual } from './present-pr-context.mjs'

test('preserves Mermaid markup for the artifact renderer', () => {
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
  assert.match(renderIntroVisual(context), /^<pre class="mermaid">/)
  assert.match(renderIntroVisual(context), /UI-&gt;&gt;Agent/)
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

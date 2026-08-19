import assert from 'node:assert/strict'
import test from 'node:test'

import { renderMermaidSvg } from './render-mermaid.mjs'

test('multiple Mermaid visuals use disjoint SVG fragment IDs', async () => {
  const [first, second] = await Promise.all([
    renderMermaidSvg('flowchart LR\n  A[First] --> B[Done]', 'pr-context-diagram-1'),
    renderMermaidSvg('flowchart LR\n  A[Second] --> B[Done]', 'pr-context-diagram-2'),
  ])

  assert.match(first, /id="pr-context-diagram-1"/)
  assert.match(second, /id="pr-context-diagram-2"/)
  assert.match(first, />First</)
  assert.match(second, />Second</)

  const firstIds = new Set([...first.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]))
  const secondIds = new Set([...second.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]))
  assert.deepEqual([...firstIds].filter((id) => secondIds.has(id)), [])
})

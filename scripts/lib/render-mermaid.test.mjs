import assert from 'node:assert/strict'
import test from 'node:test'

import { renderMermaidSvg } from './render-mermaid.mjs'

const idsIn = (svg) => new Set([...svg.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]))
const referencesIn = (svg) => [
  ...[...svg.matchAll(/\s(?:marker-start|marker-end|fill|filter)="url\(#([^\)]+)\)"/g)].map((match) => match[1]),
  ...[...svg.matchAll(/(?:href|aria-labelledby|aria-describedby)="#([^"]+)"/g)].map((match) => match[1]),
]

test('multiple sequence diagrams use disjoint, internally valid SVG fragment IDs', async () => {
  const [first, second] = await Promise.all([
    renderMermaidSvg('sequenceDiagram\n  A->>B: First message', 'pr-context-diagram-1'),
    renderMermaidSvg('sequenceDiagram\n  A->>B: Second message', 'pr-context-diagram-2'),
  ])

  assert.match(first, /id="pr-context-diagram-1"/)
  assert.match(second, /id="pr-context-diagram-2"/)
  assert.match(first, />First message</)
  assert.match(second, />Second message</)

  const firstIds = idsIn(first)
  const secondIds = idsIn(second)
  assert.deepEqual([...firstIds].filter((id) => secondIds.has(id)), [])
  assert.deepEqual(referencesIn(first).filter((id) => !firstIds.has(id)), [])
  assert.deepEqual(referencesIn(second).filter((id) => !secondIds.has(id)), [])
})

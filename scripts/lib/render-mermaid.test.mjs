import assert from 'node:assert/strict'
import { createServer } from 'node:http'
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

test('blocks render-time network and removes load-capable external Mermaid content', async () => {
  let requests = 0
  const server = createServer((_request, response) => {
    requests += 1
    response.writeHead(200, { 'content-type': 'image/png' })
    response.end('not-an-image')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const externalUrl = `http://127.0.0.1:${port}/pixel.png`

  try {
    const svg = await renderMermaidSvg(`flowchart LR\n  A["<img src='${externalUrl}'>tracked"] --> B[Done]`, 'network-safe-diagram')
    assert.equal(requests, 0)
    assert.doesNotMatch(svg, /<(?:img|image)(?:\s|>)|\ssrc=/i)
    assert.equal(svg.includes(externalUrl), false)
    assert.match(svg, />tracked</)
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'

import { chromium } from '@playwright/test'

import { renderMermaidSvg } from './render-mermaid.mjs'

const idsIn = (svg) => new Set([...svg.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]))
const referencesIn = (svg) => [
  ...[...svg.matchAll(/\s(?:marker-start|marker-end|fill|filter)="url\(#([^\)]+)\)"/g)].map((match) => match[1]),
  ...[...svg.matchAll(/href="#([^"]+)"/g)].map((match) => match[1]),
  ...[...svg.matchAll(/aria-(?:labelledby|describedby)="([^"]+)"/g)].flatMap((match) => match[1].split(/\s+/)),
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

test('rewrites accessibility ID references to namespaced targets', async () => {
  const svg = await renderMermaidSvg('flowchart LR\n  accTitle: Accessible flow\n  accDescr: Start reaches done\n  A[Start] --> B[Done]', 'accessible-diagram')
  const ids = idsIn(svg)
  assert.ok(referencesIn(svg).length >= 2)
  assert.deepEqual(referencesIn(svg).filter((id) => !ids.has(id)), [])
})

test('preserves ordinary flowchart labels without HTML foreign objects', async () => {
  const svg = await renderMermaidSvg('flowchart LR\n  A[Start] --> B[Done]', 'plain-flowchart')
  assert.match(svg, />Start</)
  assert.match(svg, />Done</)
  assert.doesNotMatch(svg, /<foreignObject\b/i)
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
    const themeCSS = String.raw`* { fill: u\72l(pixel.png); background-image: image-set("${externalUrl}" 1x); }`
    const directive = `%%{init: ${JSON.stringify({ themeCSS })}}%%`
    const source = `${directive}\nflowchart LR\n  A["<form action='${externalUrl}'><button formaction='${externalUrl}'>Send</button></form><img src='${externalUrl}'>"] --> B[Done]`
    const svg = await renderMermaidSvg(source, 'network-safe-diagram')
    assert.equal(requests, 0)
    assert.doesNotMatch(svg, /<(?:form|button|input|img|image)(?:\s|>)/i)
    assert.equal(svg.includes(externalUrl), false)
    assert.doesNotMatch(svg, /(?:url|u\\72l)\(\s*["']?pixel\.png|image-set\s*\(/i)

    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage()
      await page.setContent(`<base href="http://127.0.0.1:${port}/artifact/">${svg}`, { waitUntil: 'networkidle' })
      assert.equal(requests, 0)
    } finally {
      await browser.close()
    }
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})

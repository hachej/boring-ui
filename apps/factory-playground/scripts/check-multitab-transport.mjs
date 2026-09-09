#!/usr/bin/env node
// Read-only live transport regression for #1565. Keep every tab open in ONE
// context: separate browsers/contexts do not reproduce the shared socket cap.
import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'

const url = process.argv[2]
if (!url) throw new Error('Usage: node scripts/check-multitab-transport.mjs <https-url>')
assert.equal(new URL(url).protocol, 'https:', 'Use the canonical HTTPS origin')
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext()
const pages = []
const receipt = []
const pageErrors = []
const activeStreamsByPage = new Map()
const streamPaths = [
  /\/api\/v1\/fs\/events(?:\?|$)/,
  /\/api\/v1\/ui\/commands\/next(?:\?|$)/,
  /\/api\/v1\/agents\/session-activity\/events(?:\?|$)/,
  /\/api\/v1\/agents\/[^/]+\/sessions\/[^/]+\/events(?:\?|$)/,
]
try {
  for (let index = 0; index < 4; index++) {
    const page = await context.newPage()
    pages.push(page)
    const responses = []
    const errors = []
    pageErrors.push(errors)
    const cdp = await context.newCDPSession(page)
    await cdp.send('Network.enable')
    const activeStreams = new Map()
    activeStreamsByPage.set(page, activeStreams)
    cdp.on('Network.responseReceived', ({ requestId, response }) => {
      responses.push(response)
      if (streamPaths.some((pattern) => pattern.test(response.url))) {
        activeStreams.set(requestId, response)
      }
    })
    cdp.on('Network.loadingFinished', ({ requestId }) => activeStreams.delete(requestId))
    cdp.on('Network.loadingFailed', ({ requestId }) => activeStreams.delete(requestId))
    page.on('pageerror', (error) => errors.push(error.message))
    const started = Date.now()
    const state = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/v1/ui/state' && response.status() === 200,
    { timeout: 30_000 })
    // Attach rejection immediately so a failed navigation cannot orphan it.
    const stateResult = state.then(() => null, (error) => error)
    const streamsResult = Promise.all(streamPaths.map((pattern) =>
      page.waitForResponse((response) => pattern.test(response.url()) && response.status() === 200,
        { timeout: 30_000 }),
    )).then(() => null, (error) => error)
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    const stateError = await stateResult
    if (stateError) throw stateError
    await page.waitForFunction(() => {
      const root = document.getElementById('root')
      return root?.textContent?.includes('Inbox')
        && !root.textContent.includes('Preparing workspace')
        && !root.querySelector('[data-boring-workspace-part="workspace-loading-shell"]')
        && !root.querySelector('[data-boring-workspace-part="workbench-loading-geometry"]')
    }, null, { timeout: 30_000 })
    const readyMs = Date.now() - started
    // Do not open the next tab until this one's persistent channels are live.
    const streamsError = await streamsResult
    if (streamsError) throw streamsError
    const api = responses.filter((response) => response.url.includes('/api/v1/'))
    assert(api.length > 0, 'No API responses captured')
    assert(api.every((response) => response.protocol === 'h2'), 'API fell back to HTTP/1.1')
    assert.equal(errors.length, 0, errors.join('\n'))
    const entry = { tab: index + 1, readyMs, streamsReadyMs: Date.now() - started, protocol: 'h2', apiResponses: api.length }
    receipt.push(entry)
    console.log(JSON.stringify(entry))
  }
  // CDP observes headers before a stream finishes; keep IDs until loading ends.
  // Reconnects may replace an ID, but all four channel kinds must remain live.
  const liveChannels = () => pages.flatMap((page) => streamPaths.map((pattern) =>
    [...activeStreamsByPage.get(page).values()].some((response) =>
      pattern.test(response.url) && response.status === 200 && response.protocol === 'h2'),
  ))
  await expect.poll(liveChannels, { timeout: 10_000 }).toEqual(Array(16).fill(true))
  // Requests still complete with all four sets of streams held open.
  for (const page of pages) {
    assert.equal(await page.evaluate(async () => {
      const response = await fetch('/api/v1/workspace/meta', { signal: AbortSignal.timeout(5_000) })
      return response.status
    }), 200)
  }
  await expect.poll(liveChannels, { timeout: 10_000 }).toEqual(Array(16).fill(true))
  assert.deepEqual(pageErrors.flat(), [], 'JavaScript errors occurred after initial readiness')
  console.log(JSON.stringify({ result: 'PASS', tabs: receipt, liveApiProbe: '4/4' }))
} finally {
  await browser.close()
}

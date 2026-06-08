import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNodeWorkspace } from '../createNodeWorkspace'
import type { WorkspaceChangeEvent, WorkspaceWatcher } from '../../../shared/workspace'

// Generous timing because chokidar's awaitWriteFinish (50ms) plus initial
// scan can stretch under parallel test load. Watch-events have at-least-once
// semantics — these tests check that an event eventually arrives, not that
// it arrives within a tight budget.
const SETTLE_MS = 750

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// Poll until the expected event arrives or we hit a generous deadline.
// chokidar event latency is unbounded under parallel CI load, so a fixed
// sleep is flaky; polling resolves as soon as the event lands.
async function waitForEvent(
  events: WorkspaceChangeEvent[],
  pred: (e: WorkspaceChangeEvent) => boolean,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (events.some(pred)) return
    await wait(25)
  }
}

describe('createNodeWorkspace.watch', () => {
  let root: string
  let watcher: WorkspaceWatcher | null

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'boring-ws-watch-'))
    watcher = null
  })

  afterEach(async () => {
    watcher?.close()
    await rm(root, { recursive: true, force: true })
  })

  it('declares the strong fs capability', () => {
    const ws = createNodeWorkspace(root)
    expect(ws.fsCapability).toBe('strong')
    expect(typeof ws.watch).toBe('function')
  })

  it('emits a write event when a file changes', async () => {
    const ws = createNodeWorkspace(root)
    watcher = ws.watch!()

    const events: WorkspaceChangeEvent[] = []
    watcher.subscribe((e) => events.push(e))

    // chokidar takes a tick to bind; give it a moment before mutating.
    await wait(SETTLE_MS)
    await ws.writeFile('a.txt', 'hello')
    await waitForEvent(events, (e) => e.op === 'write' && e.path === 'a.txt')

    const writes = events.filter((e) => e.op === 'write' && e.path === 'a.txt')
    expect(writes.length).toBeGreaterThan(0)
    // mtime should be a number when set; allowed to be undefined on slow FS.
    if (writes[0]!.mtimeMs !== undefined) expect(writes[0]!.mtimeMs).toBeGreaterThan(0)
  })

  it('shares one underlying watcher across multiple subscribers', async () => {
    const ws = createNodeWorkspace(root)
    const w1 = ws.watch!()
    const w2 = ws.watch!()
    expect(w1).toBe(w2)
    watcher = w1
  })

  it('emits unlink when a file is deleted', async () => {
    const ws = createNodeWorkspace(root)
    await ws.writeFile('b.txt', 'tmp')
    watcher = ws.watch!()
    await wait(SETTLE_MS)

    const events: WorkspaceChangeEvent[] = []
    watcher.subscribe((e) => events.push(e))

    await ws.unlink('b.txt')
    await waitForEvent(events, (e) => e.op === 'unlink' && e.path === 'b.txt')

    expect(events.some((e) => e.op === 'unlink' && e.path === 'b.txt')).toBe(true)
  })

  it('subscribe returns an unsubscribe fn — events stop flowing after it is called', async () => {
    const ws = createNodeWorkspace(root)
    watcher = ws.watch!()
    const events: WorkspaceChangeEvent[] = []
    const off = watcher.subscribe((e) => events.push(e))
    await wait(SETTLE_MS)

    off()
    await ws.writeFile('c.txt', 'x')
    await wait(SETTLE_MS)

    expect(events.length).toBe(0)
  })

  it('close is idempotent and stops new subscribers from receiving events', async () => {
    const ws = createNodeWorkspace(root)
    watcher = ws.watch!()
    watcher.close()
    watcher.close() // does not throw

    const events: WorkspaceChangeEvent[] = []
    watcher.subscribe((e) => events.push(e))

    // subscribe-after-close immediately returns a no-op unsubscribe
    // and ignores any events that would be emitted.
    await ws.writeFile('d.txt', 'y')
    await wait(SETTLE_MS)
    expect(events.length).toBe(0)
  })
})

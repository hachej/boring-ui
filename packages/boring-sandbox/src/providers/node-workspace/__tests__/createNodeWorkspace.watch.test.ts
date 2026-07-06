import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNodeWorkspace } from '../createNodeWorkspace'
import type { WorkspaceChangeEvent, WorkspaceWatcher } from '@hachej/boring-agent/shared'

// Generous timing because chokidar's awaitWriteFinish (50ms) plus initial
// scan can stretch under parallel test load. Watch-events have at-least-once
// semantics — these tests check that an event eventually arrives, not that
// it arrives within a tight budget.
const SETTLE_MS = 750
const WATCH_TEST_TIMEOUT_MS = 15_000

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

  it('does not ignore everything when the workspace root is under an ignored-name parent', async () => {
    const workspaceRoot = join(root, '.worktrees', 'child-workspace')
    await mkdir(workspaceRoot, { recursive: true })
    const ws = createNodeWorkspace(workspaceRoot)
    watcher = ws.watch!()

    const events: WorkspaceChangeEvent[] = []
    watcher.subscribe((e) => events.push(e))
    await wait(SETTLE_MS)

    await ws.writeFile('inside-root.txt', 'visible')
    await waitForEvent(events, (e) => e.op === 'write' && e.path === 'inside-root.txt')

    expect(events.some((e) => e.op === 'write' && e.path === 'inside-root.txt')).toBe(true)
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

    const events: WorkspaceChangeEvent[] = []
    watcher.subscribe((e) => events.push(e))
    await watcher.whenReady?.()

    await ws.unlink('b.txt')
    await waitForEvent(events, (e) => e.op === 'unlink' && e.path === 'b.txt', WATCH_TEST_TIMEOUT_MS - 1_000)

    expect(events.some((e) => e.op === 'unlink' && e.path === 'b.txt')).toBe(true)
  }, WATCH_TEST_TIMEOUT_MS)

  it('ignores heavyweight internal directories', async () => {
    const ws = createNodeWorkspace(root)
    const ignoredDirs = ['.worktrees', '.boring-agent', '.cache']
    for (const dir of ignoredDirs) await ws.mkdir(dir, { recursive: true })

    watcher = ws.watch!()

    const events: WorkspaceChangeEvent[] = []
    watcher.subscribe((e) => events.push(e))
    await wait(SETTLE_MS)

    await ws.writeFile('visible.txt', 'visible')
    await waitForEvent(events, (e) => e.op === 'write' && e.path === 'visible.txt')
    expect(events.some((e) => e.op === 'write' && e.path === 'visible.txt')).toBe(true)
    await wait(SETTLE_MS)
    events.length = 0

    for (const dir of ignoredDirs) {
      await ws.writeFile(`${dir}/hidden.txt`, 'hidden')
    }
    await wait(SETTLE_MS)

    expect(events).toEqual([])
  })

  it('emits one synthetic rename for workspace.rename instead of an unlink/add storm', async () => {
    const ws = createNodeWorkspace(root)
    await ws.mkdir('big', { recursive: true })
    for (let i = 0; i < 20; i += 1) {
      await ws.writeFile(`big/f-${i}.txt`, String(i))
    }
    watcher = ws.watch!()
    const events: WorkspaceChangeEvent[] = []
    watcher.subscribe((e) => events.push(e))
    await wait(SETTLE_MS)

    await ws.rename('big', 'moved')
    await waitForEvent(events, (e) => e.op === 'rename' && e.path === 'moved')

    const renames = events.filter((e) => e.op === 'rename')
    expect(renames).toEqual([{ op: 'rename', path: 'moved', oldPath: 'big' }])

    // The chokidar echo (unlink per old path, add per new path) is
    // absorbed: nothing under either subtree reaches subscribers.
    await wait(SETTLE_MS)
    const echo = events.filter(
      (e) => e.op !== 'rename'
        && (e.path === 'big' || e.path.startsWith('big/') || e.path === 'moved' || e.path.startsWith('moved/')),
    )
    expect(echo).toEqual([])
  })

  it('genuine deletes and edits inside the rename destination survive the echo window', async () => {
    const ws = createNodeWorkspace(root)
    await ws.mkdir('big', { recursive: true })
    for (let i = 0; i < 5; i += 1) {
      await ws.writeFile(`big/f-${i}.txt`, String(i))
    }
    watcher = ws.watch!()
    const events: WorkspaceChangeEvent[] = []
    watcher.subscribe((e) => events.push(e))
    await wait(SETTLE_MS)

    await ws.rename('big', 'moved')
    await waitForEvent(events, (e) => e.op === 'rename' && e.path === 'moved')
    // Let chokidar finish discovering the new subtree (its add echo is
    // absorbed) so the next mutations are tracked-file events.
    await wait(SETTLE_MS)

    // Suppression only absorbs the rename's predicted echo — a real
    // delete (unlink under `to`) and a real edit (change under `to`)
    // must still reach subscribers while the window is open.
    await ws.unlink('moved/f-0.txt')
    await ws.writeFile('moved/f-1.txt', 'edited')
    await waitForEvent(events, (e) => e.op === 'unlink' && e.path === 'moved/f-0.txt')
    await waitForEvent(events, (e) => e.op === 'write' && e.path === 'moved/f-1.txt')

    expect(events.some((e) => e.op === 'unlink' && e.path === 'moved/f-0.txt')).toBe(true)
    expect(events.some((e) => e.op === 'write' && e.path === 'moved/f-1.txt')).toBe(true)
  })

  it('renames before chokidar starts register no suppression — later adds flow', async () => {
    const ws = createNodeWorkspace(root)
    await ws.mkdir('big', { recursive: true })
    await ws.writeFile('big/f.txt', 'x')
    watcher = ws.watch!()
    // Rename BEFORE any subscriber: no chokidar instance, no echo to
    // absorb — must not arm suppression windows for when it starts.
    await ws.rename('big', 'moved')

    const events: WorkspaceChangeEvent[] = []
    watcher.subscribe((e) => events.push(e))
    await watcher.whenReady!()
    await wait(SETTLE_MS)

    await ws.writeFile('moved/new.txt', 'y')
    await waitForEvent(events, (e) => e.op === 'write' && e.path === 'moved/new.txt')
    expect(events.some((e) => e.op === 'write' && e.path === 'moved/new.txt')).toBe(true)
  })

  it('rename echo suppression does not mute unrelated paths', async () => {
    const ws = createNodeWorkspace(root)
    await ws.writeFile('solo.txt', 'x')
    watcher = ws.watch!()
    const events: WorkspaceChangeEvent[] = []
    watcher.subscribe((e) => events.push(e))
    await wait(SETTLE_MS)

    await ws.rename('solo.txt', 'renamed.txt')
    await ws.writeFile('elsewhere.txt', 'y')
    await waitForEvent(events, (e) => e.op === 'write' && e.path === 'elsewhere.txt')

    expect(events.some((e) => e.op === 'rename' && e.path === 'renamed.txt' && e.oldPath === 'solo.txt')).toBe(true)
    expect(events.some((e) => e.op === 'write' && e.path === 'elsewhere.txt')).toBe(true)
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

  it('whenReady resolves ok for a normally sized workspace', async () => {
    const ws = createNodeWorkspace(root)
    await ws.writeFile('one.txt', 'x')
    watcher = ws.watch!()
    await expect(watcher.whenReady!()).resolves.toEqual({ ok: true })
  })

  it('refuses to watch a workspace above the entry cap and reports it via whenReady', async () => {
    const prevCap = process.env.BORING_MAX_WATCHED_ENTRIES
    process.env.BORING_MAX_WATCHED_ENTRIES = '5'
    try {
      const ws = createNodeWorkspace(root)
      for (let i = 0; i < 10; i += 1) {
        await ws.writeFile(`file-${i}.txt`, String(i))
      }
      watcher = ws.watch!()

      const events: WorkspaceChangeEvent[] = []
      watcher.subscribe((e) => events.push(e))

      const readiness = await watcher.whenReady!()
      expect(readiness).toMatchObject({ ok: false, reason: 'workspace_too_large' })
      if (!readiness.ok) expect(readiness.message).toContain('BORING_MAX_WATCHED_ENTRIES')

      // No chokidar instance was started — mutations stay unobserved.
      await ws.writeFile('after-guard.txt', 'y')
      await wait(SETTLE_MS)
      expect(events).toEqual([])
    } finally {
      if (prevCap === undefined) delete process.env.BORING_MAX_WATCHED_ENTRIES
      else process.env.BORING_MAX_WATCHED_ENTRIES = prevCap
    }
  })

  it('entry cap counting skips ignored directories', async () => {
    const prevCap = process.env.BORING_MAX_WATCHED_ENTRIES
    process.env.BORING_MAX_WATCHED_ENTRIES = '10'
    try {
      const ws = createNodeWorkspace(root)
      // 30 entries under node_modules must not count toward the cap.
      await ws.mkdir('node_modules/pkg', { recursive: true })
      for (let i = 0; i < 30; i += 1) {
        await ws.writeFile(`node_modules/pkg/dep-${i}.js`, String(i))
      }
      await ws.writeFile('src.txt', 'x')
      watcher = ws.watch!()
      await expect(watcher.whenReady!()).resolves.toEqual({ ok: true })
    } finally {
      if (prevCap === undefined) delete process.env.BORING_MAX_WATCHED_ENTRIES
      else process.env.BORING_MAX_WATCHED_ENTRIES = prevCap
    }
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

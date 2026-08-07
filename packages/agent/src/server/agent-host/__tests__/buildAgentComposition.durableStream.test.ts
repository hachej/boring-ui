import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DURABLE_STREAM_ENV_FLAG,
  EVENT_STORE_FILE_NAME,
  isDurableStreamEnabled,
  openDurableEventStore,
} from '../buildAgentComposition'
import { SqliteEventStreamStore } from '../../events/eventStreamStore'
import { ErrorCode } from '../../../shared/error-codes'

describe('durable event stream flag', () => {
  const originalValue = process.env[DURABLE_STREAM_ENV_FLAG]

  afterEach(() => {
    if (originalValue === undefined) delete process.env[DURABLE_STREAM_ENV_FLAG]
    else process.env[DURABLE_STREAM_ENV_FLAG] = originalValue
  })

  it('is disabled by default (flag absent = byte-identical legacy behavior)', () => {
    delete process.env[DURABLE_STREAM_ENV_FLAG]
    expect(isDurableStreamEnabled()).toBe(false)
  })

  it.each(['1', 'true'])('is enabled when set to %s', (value) => {
    process.env[DURABLE_STREAM_ENV_FLAG] = value
    expect(isDurableStreamEnabled()).toBe(true)
  })

  it('treats unrecognized values as disabled', () => {
    process.env[DURABLE_STREAM_ENV_FLAG] = 'yes'
    expect(isDurableStreamEnabled()).toBe(false)
  })
})

describe('openDurableEventStore', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'boring-event-store-test-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('prefers sessionRoot over workspaceRoot, per AGENTS.md hard rule 9', () => {
    const sessionRoot = join(dir, 'session-root')
    const workspaceRoot = join(dir, 'workspace-root')
    const opened = openDurableEventStore({ sessionRoot, workspaceRoot })
    expect(opened).toBeDefined()
    opened?.close()
    // The db file was created under sessionRoot, not workspaceRoot.
    expect(() => openDurableEventStore({ sessionRoot, workspaceRoot })).not.toThrow()
    const reopened = openDurableEventStore({ sessionRoot, workspaceRoot })
    reopened?.close()
  })

  it('falls back to workspaceRoot when sessionRoot is absent', () => {
    const workspaceRoot = join(dir, 'workspace-only')
    const opened = openDurableEventStore({ workspaceRoot })
    expect(opened).toBeDefined()
    opened?.close()
  })

  it('reports EVENT_STORE_OPEN_FAILED via telemetry and returns undefined instead of throwing when the path is unusable', () => {
    // A path segment that is actually a file (not a directory) cannot be mkdir'd into.
    const blockerPath = join(dir, 'blocker-file')
    writeFileSync(blockerPath, 'not a directory')
    const unusableRoot = join(blockerPath, 'nested')
    const capture = vi.fn()

    const opened = openDurableEventStore({ workspaceRoot: unusableRoot, telemetry: { capture } })

    expect(opened).toBeUndefined()
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'agent.event-store.open-failed',
        properties: expect.objectContaining({ code: ErrorCode.enum.EVENT_STORE_OPEN_FAILED }),
      }),
    )
  })

  it('PROOF: durable resume across restart — replay from cursor yields the same sequence with no gap', async () => {
    const sessionRoot = join(dir, 'durable-session-root')
    const path = join(sessionRoot, EVENT_STORE_FILE_NAME)
    const streamPath = 'stream/proof'

    // "Boot 1": open the store, append events, then simulate a process
    // restart by closing the underlying sqlite connection.
    const first = openDurableEventStore({ workspaceRoot: sessionRoot })
    expect(first).toBeDefined()
    if (!first) throw new Error('expected store to open')
    await first.store.createStream(streamPath)
    const offsets: string[] = []
    offsets.push(await first.store.appendEvent(streamPath, { i: 0 }))
    offsets.push(await first.store.appendEvent(streamPath, { i: 1 }))
    offsets.push(await first.store.appendEvent(streamPath, { i: 2 }))
    first.close()

    // "Boot 2": a brand-new HarnessPiChatService-equivalent store instance
    // over the same on-disk path — this is exactly what buildAgentComposition
    // does on process restart when the flag is set.
    const second = openDurableEventStore({ workspaceRoot: sessionRoot })
    expect(second).toBeDefined()
    if (!second) throw new Error('expected store to reopen')
    expect(second.store).toBeInstanceOf(SqliteEventStreamStore)

    const replay = await second.store.readEvents(streamPath, { offset: '-1' })
    expect(replay.events.map((e) => e.data)).toEqual([{ i: 0 }, { i: 1 }, { i: 2 }])
    expect(replay.events.map((e) => e.offset)).toEqual(offsets)

    // Resuming from a mid-stream cursor picks up exactly where it left off — no gap, no dupe.
    const resumed = await second.store.readEvents(streamPath, { offset: offsets[0] })
    expect(resumed.events.map((e) => e.data)).toEqual([{ i: 1 }, { i: 2 }])

    second.close()
  })
})

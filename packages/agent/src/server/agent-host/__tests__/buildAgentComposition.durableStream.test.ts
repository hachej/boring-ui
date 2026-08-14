import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DURABLE_STREAM_ENV_FLAG,
  DurableStreamUnavailableError,
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

  it('writes under sessionRoot, not hostStorageRoot, per AGENTS.md hard rule 9', () => {
    const sessionRoot = join(dir, 'session-root')
    const hostStorageRoot = join(dir, 'host-storage-root')
    const sessionRootDbPath = join(sessionRoot, EVENT_STORE_FILE_NAME)
    const hostStorageRootDbPath = join(hostStorageRoot, EVENT_STORE_FILE_NAME)

    const opened = openDurableEventStore({ sessionRoot, hostStorageRoot })
    expect(opened).toBeDefined()
    opened?.close()

    // Real assertion, not a comment: the db file must land under sessionRoot
    // and must NOT land under hostStorageRoot when both are supplied.
    expect(existsSync(sessionRootDbPath)).toBe(true)
    expect(existsSync(hostStorageRootDbPath)).toBe(false)
  })

  it('falls back to hostStorageRoot (never workspace.root) when sessionRoot is absent', () => {
    const hostStorageRoot = join(dir, 'host-storage-only')
    const opened = openDurableEventStore({ hostStorageRoot })
    expect(opened).toBeDefined()
    opened?.close()
    expect(existsSync(join(hostStorageRoot, EVENT_STORE_FILE_NAME))).toBe(true)
  })

  it('fails LOUDLY with DURABLE_STREAM_UNAVAILABLE when neither sessionRoot nor hostStorageRoot resolve — never falls back to a sandbox/guest path or to in-memory', () => {
    const capture = vi.fn()

    let thrown: unknown
    try {
      openDurableEventStore({ telemetry: { capture } })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(DurableStreamUnavailableError)
    expect((thrown as DurableStreamUnavailableError).code).toBe(ErrorCode.enum.DURABLE_STREAM_UNAVAILABLE)
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'agent.event-store.open-failed',
        properties: expect.objectContaining({ code: ErrorCode.enum.EVENT_STORE_OPEN_FAILED }),
      }),
    )
  })

  it('throws DURABLE_STREAM_UNAVAILABLE carrying the underlying cause when the resolved path is unusable (flag on = boot must abort, no silent in-memory fallback)', () => {
    // A path segment that is actually a file (not a directory) cannot be mkdir'd into.
    const blockerPath = join(dir, 'blocker-file')
    writeFileSync(blockerPath, 'not a directory')
    const unusableRoot = join(blockerPath, 'nested')
    const capture = vi.fn()

    let thrown: unknown
    try {
      openDurableEventStore({ hostStorageRoot: unusableRoot, telemetry: { capture } })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(DurableStreamUnavailableError)
    const error = thrown as DurableStreamUnavailableError
    expect(error.code).toBe(ErrorCode.enum.DURABLE_STREAM_UNAVAILABLE)
    expect(error.message).toContain(join(unusableRoot, EVENT_STORE_FILE_NAME))
    expect(error.cause).toBeDefined()
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'agent.event-store.open-failed',
        properties: expect.objectContaining({ code: ErrorCode.enum.EVENT_STORE_OPEN_FAILED }),
      }),
    )
  })

  it('PROOF: durable resume across restart — replay from cursor yields the same sequence with no gap', async () => {
    // Exercise sessionRoot distinctly from hostStorageRoot: this is the path
    // buildAgentComposition actually takes when options.sessionRoot is set
    // (the common production case, per BORING_AGENT_SESSION_ROOT / AGENTS.md
    // hard rule 9). A decoy hostStorageRoot is also supplied so this test
    // would fail if sessionRoot precedence ever regressed.
    const sessionRoot = join(dir, 'durable-session-root')
    const decoyHostStorageRoot = join(dir, 'decoy-host-storage-root')
    const streamPath = 'stream/proof'

    // "Boot 1": open the store, append events, then simulate a process
    // restart by closing the underlying sqlite connection. This constructs
    // the store exactly as buildAgentComposition does (sessionRoot preferred,
    // hostStorageRoot as the non-guest fallback) — it does not construct a
    // full HarnessPiChatService/composition, since the restart-resume
    // contract being proven here lives entirely in the store's on-disk
    // durability, not in service-level wiring.
    const first = openDurableEventStore({ sessionRoot, hostStorageRoot: decoyHostStorageRoot })
    expect(first).toBeDefined()
    if (!first) throw new Error('expected store to open')
    await first.store.createStream(streamPath)
    const offsets: string[] = []
    offsets.push(await first.store.appendEvent(streamPath, { i: 0 }))
    offsets.push(await first.store.appendEvent(streamPath, { i: 1 }))
    offsets.push(await first.store.appendEvent(streamPath, { i: 2 }))
    first.close()

    expect(existsSync(join(sessionRoot, EVENT_STORE_FILE_NAME))).toBe(true)
    expect(existsSync(join(decoyHostStorageRoot, EVENT_STORE_FILE_NAME))).toBe(false)

    // "Boot 2": a brand-new store instance over the same on-disk path.
    const second = openDurableEventStore({ sessionRoot, hostStorageRoot: decoyHostStorageRoot })
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

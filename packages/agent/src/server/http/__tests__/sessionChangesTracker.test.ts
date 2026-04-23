import { describe, expect, test } from 'vitest'

import {
  InMemorySessionChangesTracker,
  parseFileChangeChunk,
} from '../sessionChangesTracker'

describe('sessionChangesTracker', () => {
  test('parseFileChangeChunk extracts valid file-change payloads', () => {
    const parsed = parseFileChangeChunk({
      type: 'data-file-changed',
      data: {
        op: 'rename',
        path: 'new.ts',
        oldPath: 'old.ts',
        size: 42,
        timestamp: '2026-04-23T00:00:00.000Z',
        toolCallId: 'tc-1',
      },
    })

    expect(parsed).toEqual({
      op: 'rename',
      path: 'new.ts',
      oldPath: 'old.ts',
      size: 42,
      timestamp: '2026-04-23T00:00:00.000Z',
    })
  })

  test('keeps a bounded per-session history', () => {
    const tracker = new InMemorySessionChangesTracker()
    for (let i = 0; i < 1105; i += 1) {
      tracker.record('sess-1', {
        op: 'write',
        path: `file-${i}.ts`,
        timestamp: `2026-04-23T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
      })
    }

    const files = tracker.list('sess-1')
    expect(files).toHaveLength(1000)
    expect(files[0].path).toBe('file-105.ts')
    expect(files[files.length - 1].path).toBe('file-1104.ts')
  })
})

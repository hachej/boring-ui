import { describe, expect, it, vi } from 'vitest'
import {
  __peekFlushedLogs,
  __resetTestLogState,
  withBeadId,
} from './_setup'

describe('server test logging conventions', () => {
  it('flushes buffered logs when wrapped test fails', async () => {
    __resetTestLogState()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const run = withBeadId('boring-ui-v2-eyll', async ({ assertionPassed }) => {
      assertionPassed('precondition')
      throw new Error('forced failure for log flush')
    })

    await expect(run()).rejects.toThrow('forced failure for log flush')

    const flushed = __peekFlushedLogs()
    expect(flushed).toHaveLength(1)
    expect(flushed[0].lines.join('\n')).toContain('"event":"setup.start"')
    expect(flushed[0].lines.join('\n')).toContain('"event":"assertion.failed"')
  })

  it('keeps logs hidden when wrapped test passes', async () => {
    __resetTestLogState()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const run = withBeadId('boring-ui-v2-eyll', async ({ assertionPassed }) => {
      assertionPassed('expected true branch')
      expect(1 + 1).toBe(2)
    })

    await run()

    const flushed = __peekFlushedLogs()
    expect(flushed).toHaveLength(0)
  })
})

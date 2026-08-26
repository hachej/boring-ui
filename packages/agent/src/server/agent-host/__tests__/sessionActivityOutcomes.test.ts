import { describe, expect, it } from 'vitest'
import { ErrorCode } from '../../../shared/index'
import { AgentSessionActivityIndex } from '../sessionInventory'

describe('AgentSessionActivityIndex terminal outcomes', () => {
  const ref = { agentTypeId: 'alpha', sessionId: 'session-1' }

  it('attaches turn identity to optimistic running without duplicating the transition', () => {
    const index = new AgentSessionActivityIndex()
    const statuses: string[] = []
    index.subscribe('ws', ({ status }) => statuses.push(status))

    index.set('ws', ref, 'running')
    index.observe('ws', ref, { type: 'agent-start', seq: 1, turnId: 't1' })
    index.observe('ws', ref, { type: 'agent-end', seq: 2, turnId: 't1', status: 'ok' })

    expect(statuses).toEqual(['running', 'idle'])
    expect(index.get('ws', ref)).toBe('idle')
  })

  it('never publishes a failed transition for the error emitted while aborting', () => {
    const index = new AgentSessionActivityIndex()
    const statuses: string[] = []
    index.subscribe('ws', ({ status }) => statuses.push(status))

    index.observe('ws', ref, { type: 'agent-start', seq: 1, turnId: 't1' })
    index.observe('ws', ref, {
      type: 'error',
      seq: 2,
      turnId: 't1',
      retryable: false,
      error: { code: ErrorCode.enum.ABORTED, message: 'Aborted', retryable: false },
    })
    index.observe('ws', ref, { type: 'agent-end', seq: 3, turnId: 't1', status: 'aborted' })

    expect(statuses).toEqual(['running', 'aborted'])
    expect(index.snapshot('ws')).toEqual([{ ref, status: 'aborted' }])
  })

  it('ignores terminal events from a stale turn', () => {
    const index = new AgentSessionActivityIndex()
    index.observe('ws', ref, { type: 'agent-start', seq: 1, turnId: 'old' })
    index.observe('ws', ref, { type: 'agent-start', seq: 2, turnId: 'current' })

    index.observe('ws', ref, {
      type: 'error',
      seq: 3,
      turnId: 'old',
      retryable: false,
      error: { code: ErrorCode.enum.INTERNAL_ERROR, message: 'stale', retryable: false },
    })
    index.observe('ws', ref, { type: 'agent-end', seq: 4, turnId: 'old', status: 'error' })
    expect(index.get('ws', ref)).toBe('running')

    index.observe('ws', ref, { type: 'agent-end', seq: 5, turnId: 'current', status: 'ok' })
    expect(index.get('ws', ref)).toBe('idle')
  })

  it('keeps a retrying turn running until its terminal agent-end', () => {
    const index = new AgentSessionActivityIndex()
    const statuses: string[] = []
    index.subscribe('ws', ({ status }) => statuses.push(status))

    index.observe('ws', ref, { type: 'agent-start', seq: 1, turnId: 't1' })
    index.observe('ws', ref, { type: 'agent-end', seq: 2, turnId: 't1', status: 'error', willRetry: true })
    expect(index.get('ws', ref)).toBe('running')

    index.observe('ws', ref, { type: 'agent-end', seq: 3, turnId: 't1', status: 'ok' })
    expect(statuses).toEqual(['running', 'idle'])
  })

  it('still maps a terminal errored agent-end to error', () => {
    const index = new AgentSessionActivityIndex()
    index.observe('ws', ref, { type: 'agent-start', seq: 1, turnId: 't1' })
    index.observe('ws', ref, { type: 'agent-end', seq: 2, turnId: 't1', status: 'error' })
    expect(index.get('ws', ref)).toBe('error')
  })
})

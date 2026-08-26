import { describe, expect, it } from 'vitest'
import { ErrorCode } from '../../../shared/index'
import { AgentSessionActivityIndex } from '../sessionInventory'

describe('AgentSessionActivityIndex terminal outcomes', () => {
  const ref = { agentTypeId: 'alpha', sessionId: 'session-1' }

  it('lets a native start publish and attach turn identity before service acceptance', () => {
    const index = new AgentSessionActivityIndex()
    const statuses: string[] = []
    index.subscribe('ws', ({ status }) => statuses.push(status))

    const pendingRun = index.beginPendingRun('ws', ref)
    index.observe('ws', ref, { type: 'agent-start', seq: 1, turnId: 't1' })
    index.commitPendingRun('ws', ref, pendingRun)
    index.observe('ws', ref, { type: 'agent-end', seq: 2, turnId: 't1', status: 'ok' })

    expect(statuses).toEqual(['running', 'idle'])
    expect(index.get('ws', ref)).toBe('idle')
  })

  it('publishes running when an accepted invocation has not started natively', () => {
    const index = new AgentSessionActivityIndex()
    const statuses: string[] = []
    index.subscribe('ws', ({ status }) => statuses.push(status))

    const pendingRun = index.beginPendingRun('ws', ref)
    expect(statuses).toEqual([])
    index.commitPendingRun('ws', ref, pendingRun)

    expect(statuses).toEqual(['running'])
    expect(index.get('ws', ref)).toBe('running')
  })

  it('lets a pre-start error settle pending ownership before service acceptance', () => {
    const index = new AgentSessionActivityIndex()
    const statuses: string[] = []
    index.subscribe('ws', ({ status }) => statuses.push(status))

    const pendingRun = index.beginPendingRun('ws', ref)
    index.observe('ws', ref, {
      type: 'error',
      seq: 1,
      retryable: false,
      error: { code: ErrorCode.enum.INTERNAL_ERROR, message: 'provider down', retryable: false },
    })
    index.commitPendingRun('ws', ref, pendingRun)

    expect(statuses).toEqual(['error'])
    expect(index.get('ws', ref)).toBe('error')
  })

  it('settles an accepted pending run when it fails before agent-start', () => {
    const index = new AgentSessionActivityIndex()
    const statuses: string[] = []
    index.subscribe('ws', ({ status }) => statuses.push(status))

    const pendingRun = index.beginPendingRun('ws', ref)
    index.commitPendingRun('ws', ref, pendingRun)
    index.observe('ws', ref, {
      type: 'error',
      seq: 1,
      retryable: false,
      error: { code: ErrorCode.enum.INTERNAL_ERROR, message: 'provider down', retryable: false },
    })

    expect(statuses).toEqual(['running', 'error'])
    expect(index.get('ws', ref)).toBe('error')
  })

  it('silently rolls a rejected service invocation back to the activity it replaced', () => {
    const index = new AgentSessionActivityIndex()
    const statuses: string[] = []
    index.set('ws', ref, 'error')
    index.subscribe('ws', ({ status }) => statuses.push(status))

    const pendingRun = index.beginPendingRun('ws', ref)
    index.rollbackPendingRun('ws', ref, pendingRun)

    expect(statuses).toEqual([])
    expect(index.get('ws', ref)).toBe('error')
  })

  it('does not let a stale service rollback overwrite a synchronously observed turn', () => {
    const index = new AgentSessionActivityIndex()
    const pendingRun = index.beginPendingRun('ws', ref)

    index.observe('ws', ref, { type: 'agent-start', seq: 1, turnId: 't1' })
    index.rollbackPendingRun('ws', ref, pendingRun)

    expect(index.get('ws', ref)).toBe('running')
    index.observe('ws', ref, { type: 'agent-end', seq: 2, turnId: 't1', status: 'ok' })
    expect(index.get('ws', ref)).toBe('idle')
  })

  it('does not let a turn-less error settle an active identified turn', () => {
    const index = new AgentSessionActivityIndex()
    index.observe('ws', ref, { type: 'agent-start', seq: 1, turnId: 't1' })

    index.observe('ws', ref, {
      type: 'error',
      seq: 2,
      retryable: false,
      error: { code: ErrorCode.enum.INTERNAL_ERROR, message: 'unattributed', retryable: false },
    })

    expect(index.get('ws', ref)).toBe('running')
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

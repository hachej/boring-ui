import { describe, expect, it } from 'vitest'
import { AgentSessionActivityIndex } from '../sessionInventory'

describe('AgentSessionActivityIndex terminal outcomes', () => {
  const ref = { agentTypeId: 'alpha', sessionId: 'session-1' }

  it('maps a successful agent-end back to idle', () => {
    const index = new AgentSessionActivityIndex()
    index.set('ws', ref, 'running')
    index.observe('ws', ref, { type: 'agent-end', seq: 1, turnId: 't1', status: 'ok' })
    expect(index.get('ws', ref)).toBe('idle')
  })

  it('carries the aborted outcome so a cancelled run is never reported as done', () => {
    const index = new AgentSessionActivityIndex()
    index.set('ws', ref, 'aborting')
    index.observe('ws', ref, { type: 'agent-end', seq: 2, turnId: 't1', status: 'aborted' })
    expect(index.get('ws', ref)).toBe('aborted')
    expect(index.snapshot('ws')).toEqual([{ ref, status: 'aborted' }])
  })

  it('still maps an errored agent-end to error', () => {
    const index = new AgentSessionActivityIndex()
    index.set('ws', ref, 'running')
    index.observe('ws', ref, { type: 'agent-end', seq: 3, turnId: 't1', status: 'error' })
    expect(index.get('ws', ref)).toBe('error')
  })
})

import { describe, expect, it } from 'vitest'
import { projectAuthorizedSessionRunDetails } from '../sessionRunDetails'

describe('projectAuthorizedSessionRunDetails', () => {
  it('returns only allowlisted structured details from terminal runs', () => {
    expect(projectAuthorizedSessionRunDetails([
      { role: 'user', id: 'run-1' },
      {
        role: 'assistant',
        id: 'assistant-1',
        status: 'done',
        parts: [{
          type: 'tool-call',
          state: 'output-available',
          output: { details: {
            handover: { kind: 'boring.handover.operation', operation: { action: 'remove', artifactId: 'old' } },
            secret: { kind: 'private.detail', token: 'must-not-leak' },
          } },
        }],
      },
    ], ['boring.handover.operation'])).toEqual([{
      runId: 'run-1',
      terminalEntryId: 'assistant-1',
      state: 'success',
      details: [{ kind: 'boring.handover.operation', operation: { action: 'remove', artifactId: 'old' } }],
    }])
  })

  it('omits unterminated and identity-less runs', () => {
    expect(projectAuthorizedSessionRunDetails([
      { role: 'user', id: 'running' },
      { role: 'assistant', status: 'streaming', parts: [] },
      { role: 'user' },
      { role: 'assistant', id: 'terminal', status: 'done', parts: [] },
    ], ['boring.handover.operation'])).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import { agentResourceUrl, createRequestId, withStorageScope } from '../agentHttp'

describe('agentHttp', () => {
  it('normalizes Agent resource URLs', () => {
    expect(agentResourceUrl('https://agent.test/', '/api/v1/agents')).toBe('https://agent.test/api/v1/agents')
    expect(agentResourceUrl(undefined, '/api/v1/agents')).toBe('/api/v1/agents')
  })

  it('adds storage scope without overriding an explicit case-insensitive header', () => {
    expect(withStorageScope({ authorization: 'Bearer redacted', omitted: undefined }, 'scope-a')).toEqual({
      authorization: 'Bearer redacted',
      'x-boring-storage-scope': 'scope-a',
    })
    expect(withStorageScope({ 'X-Boring-Storage-Scope': 'explicit' }, 'scope-a')).toEqual({
      'X-Boring-Storage-Scope': 'explicit',
    })
    expect(withStorageScope(undefined, undefined)).toBeUndefined()
  })

  it('creates operation-prefixed request ids', () => {
    expect(createRequestId('command')).toMatch(/^command:.+/)
  })
})

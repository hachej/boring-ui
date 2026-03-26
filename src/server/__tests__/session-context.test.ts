import { describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { resolveAgentSessionContext } from '../agent/sessionContext.js'

function testConfig(overrides: Record<string, unknown> = {}) {
  return {
    ...loadConfig(),
    workspaceRoot: '/tmp/boring-ui-session-context',
    workspaceBackend: 'bwrap' as const,
    ...overrides,
  }
}

describe('resolveAgentSessionContext', () => {
  it('resolves workspace_id against the configured workspace root', () => {
    const session = resolveAgentSessionContext(
      testConfig(),
      { workspace_id: 'ws-123' },
    )

    expect(session).toEqual({
      workspaceId: 'ws-123',
      workspaceRoot: '/tmp/boring-ui-session-context/ws-123',
    })
  })

  it('ignores untrusted explicit workspace_root values by default', () => {
    const session = resolveAgentSessionContext(
      testConfig(),
      { workspace_root: '/etc', workspace_id: '' },
    )

    expect(session).toEqual({
      workspaceId: '',
      workspaceRoot: '/tmp/boring-ui-session-context',
    })
  })

  it('allows an explicit workspace root only through the trusted override path', () => {
    const session = resolveAgentSessionContext(
      testConfig(),
      { workspace_root: 'nested/custom-root' },
      undefined,
      { allowExplicitRoot: true },
    )

    expect(session).toEqual({
      workspaceId: '',
      workspaceRoot: '/tmp/boring-ui-session-context/nested/custom-root',
    })
  })
})

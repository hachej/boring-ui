import { describe, expect, it, vi } from 'vitest'
import { captureFrontPlugin } from '@hachej/boring-workspace/plugin'
import { createGovernanceFilesRootsPlugin } from '../GovernanceFilesRoots.js'

describe('createGovernanceFilesRootsPlugin', () => {
  it('remains an exported no-op without fetching or constructing roots', () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const captured = captureFrontPlugin(createGovernanceFilesRootsPlugin({
      fetchImpl,
      endpoint: '/api/v1/governance/usage-summary',
      companyContext: { label: 'Legacy company context' },
    }))

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(captured.registrations.providers).toEqual([])
    expect(captured.registrations.workspaceSources).toEqual([])
  })
})

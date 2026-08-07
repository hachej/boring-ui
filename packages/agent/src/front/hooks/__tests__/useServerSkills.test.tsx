// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createCommandRegistry } from '../../slashCommands/registry'
import { useServerSkills } from '../useServerSkills'

describe('useServerSkills', () => {
  it('registers only Pi-invocable skill rows', async () => {
    const registry = createCommandRegistry()
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      skills: [
        { name: 'winner', description: 'Invocable skill.' },
        { name: 'duplicate', description: 'Management source.', invocable: false },
      ],
    }), { status: 200 })) as unknown as typeof fetch

    renderHook(() => useServerSkills({ agentTypeId: 'default', registry, fetch: fetchImpl }))
    await waitFor(() => expect(registry.get('winner')).toBeTruthy())
    expect(registry.get('duplicate')).toBeUndefined()
  })
})

// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createCommandRegistry } from '../../slashCommands/registry'
import { useServerSkills } from '../useServerSkills'

describe('useServerSkills', () => {
  it('registers a readable filesystem skill and expands it through the canonical file route', async () => {
    const registry = createCommandRegistry()
    const resource = {
      filesystem: 'company_context',
      path: '.agents/skills/shared-review/SKILL.md',
    }
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/v1/agent/skills')) {
        return new Response(JSON.stringify({
          skills: [{
            name: 'shared-review',
            description: 'Review shared context.',
            invocable: true,
            invocation: 'filesystem',
            resource,
          }],
        }), { status: 200 })
      }
      if (url.startsWith('/api/v1/files?')) {
        const query = new URL(url, 'http://example.test').searchParams
        expect(Object.fromEntries(query)).toEqual(resource)
        return new Response(JSON.stringify({ content: 'fresh authorized instructions' }), { status: 200 })
      }
      throw new Error(`unexpected url ${url}`)
    }) as unknown as typeof fetch

    renderHook(() => useServerSkills({ registry, fetch: fetchImpl }))
    await waitFor(() => expect(registry.get('shared-review')).toBeTruthy())

    let expanded: unknown
    await act(async () => {
      expanded = await registry.get('shared-review')!.skillExpansion?.('report.md', {} as never)
    })
    expect(expanded).toContain('skill: shared-review')
    expect(expanded).toContain('fresh authorized instructions')
    expect(expanded).toContain('report.md')
  })

  it('does not refetch when equivalent request headers get a new object identity', async () => {
    const registry = createCommandRegistry()
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      skills: [{ name: 'review', description: 'Review skill.' }],
    }), { status: 200 })) as unknown as typeof fetch
    const { rerender } = renderHook(
      ({ requestHeaders }) => useServerSkills({ registry, fetch: fetchImpl, requestHeaders }),
      { initialProps: { requestHeaders: { authorization: 'Bearer example' } } },
    )
    await waitFor(() => expect(registry.get('review')).toBeTruthy())

    rerender({ requestHeaders: { authorization: 'Bearer example' } })
    await Promise.resolve()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(registry.get('review')).toBeTruthy()
  })

  it('removes owned skill registrations when a refreshed catalog revokes them', async () => {
    const registry = createCommandRegistry()
    let skills: unknown[] = [{ name: 'shared-review', description: 'Review shared context.', invocable: true }]
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ skills }), { status: 200 })) as unknown as typeof fetch
    const { rerender, result } = renderHook(
      ({ refreshKey }) => useServerSkills({ registry, fetch: fetchImpl, refreshKey }),
      { initialProps: { refreshKey: 0 } },
    )
    await waitFor(() => expect(registry.get('shared-review')).toBeTruthy())
    const registeredStamp = result.current

    skills = []
    rerender({ refreshKey: 1 })
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2))
    expect(registry.get('shared-review')).toBeUndefined()
    expect(result.current).toBeGreaterThan(registeredStamp)
  })

  it('does not register management-only filesystem skill rows', async () => {
    const registry = createCommandRegistry()
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      skills: [{
        name: 'duplicate',
        description: 'Duplicate skill.',
        invocable: false,
        invocation: 'filesystem',
        resource: {
          filesystem: 'company_context',
          path: '.agents/skills/duplicate/SKILL.md',
        },
      }],
    }), { status: 200 })) as unknown as typeof fetch

    renderHook(() => useServerSkills({ registry, fetch: fetchImpl }))
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled())
    expect(registry.get('duplicate')).toBeUndefined()
  })
})

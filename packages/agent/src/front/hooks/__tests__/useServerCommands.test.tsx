// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WORKSPACE_COMMAND_NOTIFY_EVENT } from '../../../shared/agentPluginEvents'
import { ErrorCode } from '../../../shared/error-codes'
import { createCommandRegistry } from '../../slashCommands/registry'
import { useServerCommands } from '../useServerCommands'

describe('useServerCommands', () => {
  it('surfaces structured command execution errors in notifications', async () => {
    const registry = createCommandRegistry()
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/v1/agent/commands?')) {
        return new Response(JSON.stringify({ commands: [{ name: 'plan', source: 'prompt' }] }), { status: 200 })
      }
      if (url.includes('/api/v1/agent/commands/execute?')) {
        return new Response(JSON.stringify({
          error: {
            code: ErrorCode.enum.METERING_UNSUPPORTED_COMMAND,
            message: 'Slash command execution is disabled while metering is configured.',
          },
        }), { status: 409 })
      }
      throw new Error(`unexpected url ${url}`)
    }) as unknown as typeof fetch
    const notifications: unknown[] = []
    const onNotify = (event: Event) => {
      notifications.push((event as CustomEvent).detail)
    }
    globalThis.addEventListener(WORKSPACE_COMMAND_NOTIFY_EVENT, onNotify)

    try {
      renderHook(() => useServerCommands({ registry, sessionId: 'session-1', fetch: fetchImpl }))

      await waitFor(() => expect(registry.get('plan')).toBeTruthy())
      await act(async () => {
        await registry.get('plan')!.handler('ship it', {} as never)
      })

      expect(notifications).toEqual([{
        message: 'Slash command execution is disabled while metering is configured.',
        tone: 'error',
        command: 'plan',
      }])
    } finally {
      globalThis.removeEventListener(WORKSPACE_COMMAND_NOTIFY_EVENT, onNotify)
    }
  })

  it('fails stale commands closed while replacing their complete discovery identity', async () => {
    const registry = createCommandRegistry()
    const urls: string[] = []
    let resolveFirst!: (response: Response) => void
    let resolveSecond!: (response: Response) => void
    const first = new Promise<Response>((resolve) => { resolveFirst = resolve })
    const second = new Promise<Response>((resolve) => { resolveSecond = resolve })
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      urls.push(String(input))
      if (urls.length === 1) return first
      if (urls.length === 2) return second
      return Promise.resolve(new Response('{}', { status: 200 }))
    }) as unknown as typeof fetch

    const { rerender } = renderHook(
      ({ sessionId, agentTypeId }) => useServerCommands({ registry, sessionId, agentTypeId, fetch: fetchImpl }),
      { initialProps: { sessionId: 'session-a', agentTypeId: 'alpha' } },
    )

    resolveFirst(new Response(JSON.stringify({ commands: [{ name: 'plan', source: 'prompt' }] }), { status: 200 }))
    await waitFor(() => expect(registry.get('plan')).toBeTruthy())
    const staleCommand = registry.get('plan')!

    rerender({ sessionId: 'session-b', agentTypeId: 'beta' })
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2))
    expect(registry.get('plan')).toBeUndefined()
    await act(async () => { await staleCommand.handler('must not run', {} as never) })
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    resolveSecond(new Response(JSON.stringify({ commands: [{ name: 'plan', source: 'prompt' }] }), { status: 200 }))
    await waitFor(() => expect(registry.get('plan')).toBeTruthy())
    await act(async () => { await registry.get('plan')!.handler('ship it', {} as never) })

    expect(urls).toEqual([
      '/api/v1/agents/alpha/sessions/session-a/commands',
      '/api/v1/agents/beta/sessions/session-b/commands',
      '/api/v1/agents/beta/sessions/session-b/commands/execute',
    ])
  })

  it.each([
    ['successful', 200],
    ['failed', 500],
  ] as const)('preserves local collisions when a same-identity registry replacement has a %s refresh', async (_label, status) => {
    const firstRegistry = createCommandRegistry()
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ commands: [{ name: 'plan', source: 'prompt' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ commands: [{ name: 'plan', source: 'prompt' }] }), { status })) as unknown as typeof fetch
    const props = { sessionId: 'session-1', agentTypeId: 'alpha' }
    const { rerender } = renderHook(
      ({ registry }) => useServerCommands({ registry, ...props, fetch: fetchImpl }),
      { initialProps: { registry: firstRegistry } },
    )
    await waitFor(() => expect(firstRegistry.get('plan')).toBeTruthy())

    const replacementRegistry = createCommandRegistry()
    const localHandler = vi.fn()
    replacementRegistry.register({
      name: 'plan',
      description: 'Local plan',
      source: 'prompt',
      handler: localHandler,
    })
    rerender({ registry: replacementRegistry })

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(replacementRegistry.get('plan')?.handler).toBe(localHandler))
    expect(firstRegistry.get('plan')).toBeUndefined()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('addresses discovery and execution to the owning agent', async () => {
    const registry = createCommandRegistry()
    const urls: string[] = []
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input))
      return new Response(JSON.stringify({ commands: [{ name: 'plan', source: 'prompt' }] }), { status: 200 })
    }) as unknown as typeof fetch

    renderHook(() => useServerCommands({
      registry,
      sessionId: 'session-1',
      agentTypeId: 'beta',
      fetch: fetchImpl,
    }))

    await waitFor(() => expect(registry.get('plan')).toBeTruthy())
    await act(async () => {
      await registry.get('plan')!.handler('ship it', {} as never)
    })

    expect(urls).toEqual([
      '/api/v1/agents/beta/sessions/session-1/commands',
      '/api/v1/agents/beta/sessions/session-1/commands/execute',
    ])
  })
})

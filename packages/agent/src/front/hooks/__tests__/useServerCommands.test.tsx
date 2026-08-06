// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WORKSPACE_COMMAND_NOTIFY_EVENT } from '../../../shared/agentPluginEvents'
import { ErrorCode } from '../../../shared/error-codes'
import { createCommandRegistry } from '../../slashCommands/registry'
import { useServerCommands as useAddressedServerCommands } from '../useServerCommands'

function useServerCommands(options: Omit<Parameters<typeof useAddressedServerCommands>[0], 'agentTypeId'>) {
  return useAddressedServerCommands({ agentTypeId: 'default', ...options })
}

describe('useServerCommands', () => {
  it('fails stale commands closed while replacing the complete addressed identity', async () => {
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
      ({ sessionId, agentTypeId }) => useAddressedServerCommands({ registry, sessionId, agentTypeId, fetch: fetchImpl }),
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
      '/api/v1/agents/alpha/commands?sessionId=session-a',
      '/api/v1/agents/beta/commands?sessionId=session-b',
      '/api/v1/agents/beta/commands/execute',
    ])
  })

  it('removes owned server commands on unmount without touching local commands', async () => {
    const registry = createCommandRegistry()
    const localHandler = vi.fn()
    registry.register({ name: 'local', description: 'Local', source: 'prompt', handler: localHandler })
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      commands: [{ name: 'plan', source: 'prompt' }],
    }), { status: 200 })) as unknown as typeof fetch

    const { unmount } = renderHook(() => useServerCommands({ registry, sessionId: 'session-1', fetch: fetchImpl }))
    await waitFor(() => expect(registry.get('plan')).toBeTruthy())
    unmount()
    expect(registry.get('plan')).toBeUndefined()
    expect(registry.get('local')?.handler).toBe(localHandler)
  })

  it('surfaces structured command execution errors in notifications', async () => {
    const registry = createCommandRegistry()
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/v1/agents/default/commands?')) {
        return new Response(JSON.stringify({ commands: [{ name: 'plan', source: 'prompt' }] }), { status: 200 })
      }
      if (url.includes('/api/v1/agents/default/commands/execute')) {
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
})

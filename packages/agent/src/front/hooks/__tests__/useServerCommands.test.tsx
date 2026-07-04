// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WORKSPACE_COMMAND_NOTIFY_EVENT } from '../../../shared/agentPluginEvents'
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
            code: 'METERING_UNSUPPORTED_COMMAND',
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

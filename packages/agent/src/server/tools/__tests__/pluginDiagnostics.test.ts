import { describe, test, expect } from 'vitest'
import { createPluginDiagnosticsTool } from '../pluginDiagnostics'
import type { AgentHarness } from '../../../shared/harness'
import type { ToolExecContext } from '../../../shared/tool'

function ctx(sessionId?: string): ToolExecContext {
  return {
    abortSignal: new AbortController().signal,
    toolCallId: 'call-1',
    ...(sessionId ? { sessionId } : {}),
  }
}

describe('plugin_diagnostics tool', () => {
  test('merges last-reload, harness resource, and host plugin diagnostics', async () => {
    const harness = {
      id: 'fake',
      placement: 'server',
      sessions: {} as AgentHarness['sessions'],
      getResourceDiagnostics: (sessionId: string) => [
        { source: 'pi-skills', message: `skill broken for ${sessionId}`, path: 'skills/x' },
      ],
    } as unknown as AgentHarness

    const tool = createPluginDiagnosticsTool({
      getLastReloadDiagnostics: () => [
        { source: 'plugin-load', message: 'reload error', pluginId: 'p1' },
      ],
      getHarness: () => harness,
      getPluginErrors: async () => [
        { source: 'plugin-preflight', message: 'INVALID: nope (/tmp/p2)', pluginId: 'p2' },
      ],
    })

    const result = await tool.execute({}, ctx('s-1'))
    expect(result.isError).toBe(false)
    const payload = result.details as Record<string, unknown>
    expect(payload.lastReloadDiagnostics).toEqual([
      { source: 'plugin-load', message: 'reload error', pluginId: 'p1' },
    ])
    expect(payload.resourceDiagnostics).toEqual([
      { source: 'pi-skills', message: 'skill broken for s-1', path: 'skills/x' },
    ])
    expect(payload.pluginErrors).toEqual([
      { source: 'plugin-preflight', message: 'INVALID: nope (/tmp/p2)', pluginId: 'p2' },
    ])
  })

  test('handles missing harness, missing sessionId, and missing host callback', async () => {
    const tool = createPluginDiagnosticsTool({
      getLastReloadDiagnostics: () => [],
      getHarness: () => undefined,
    })

    const result = await tool.execute({}, ctx())
    const payload = result.details as Record<string, unknown>
    expect(payload).toEqual({
      lastReloadDiagnostics: [],
      resourceDiagnostics: [],
      pluginErrors: [],
    })
  })
})

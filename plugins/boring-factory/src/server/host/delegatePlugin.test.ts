import { describe, expect, it, vi } from 'vitest'
import { createFactoryDelegatePlugin } from './delegatePlugin'
import type { FactoryEpicEntry, FactoryEpicRegistry } from './epicRegistry'
import type { FactorySessionBindings } from './sessionBindings'

describe('factory delegate plugin', () => {
  it('binds a child to its parent epic and prefixes the child brief with that epic host context', async () => {
    const entry: FactoryEpicEntry = {
      epicKey: 'parent-epic',
      featureName: 'Parent Epic',
      worktree: '/repo/.worktrees/epic-parent-epic',
      branch: 'epic/parent-epic',
      repositoryRoot: '/repo',
      models: { worker: 'openai:gpt-worker' },
      createdAt: '2026-09-05T00:00:00.000Z',
      status: 'active',
    }
    const registry: FactoryEpicRegistry = {
      load: async () => [entry], list: async () => [entry], get: async (key) => key === entry.epicKey ? entry : undefined,
      register: async () => entry, setOrchestratorSession: async () => entry, markClosed: async () => ({ ...entry, status: 'closed' }),
    }
    const bindingState: Record<string, string> = { 'orch-parent': entry.epicKey }
    const sessionBindings: FactorySessionBindings = {
      load: async () => ({ ...bindingState }), get: async (id) => bindingState[id],
      bind: vi.fn(async (id, key) => { bindingState[id] = key }),
      unbind: async (id) => { delete bindingState[id] },
      inherit: async (parentId, childId) => { bindingState[childId] = bindingState[parentId]!; return bindingState[childId]! },
      reconcile: async () => ({ droppedSessionIds: [], restoredOrchestratorSessionIds: [] }),
    }
    let promptPayload: Record<string, unknown> | undefined
    const app = {
      async inject(request: { method: string; url: string; payload?: unknown }) {
        if (request.method === 'POST' && request.url.endsWith('/sessions')) {
          return { statusCode: 201, body: '', json: <T>() => ({ sessionId: 'worker-child' }) as T }
        }
        if (request.method === 'POST' && request.url.endsWith('/prompt')) {
          promptPayload = request.payload as Record<string, unknown>
          return { statusCode: 202, body: '', json: <T>() => ({}) as T }
        }
        if (request.method === 'GET' && request.url.endsWith('/state')) {
          return {
            statusCode: 200,
            body: '',
            json: <T>() => ({ summary: { turnCount: 1 }, state: { status: 'idle', messages: [{ role: 'assistant', parts: [{ type: 'text', text: 'done' }] }] } }) as T,
          }
        }
        throw new Error(`unexpected request ${request.method} ${request.url}`)
      },
    }
    const handle = createFactoryDelegatePlugin({ workspaceScopeId: 'factory-hub', registry, sessionBindings, timeoutMs: 1_000 })
    handle.bind(app as never)
    const [tool] = handle.plugin.agentToolFactory?.({ agentTypeId: 'boring-orchestrator' }) ?? []

    const result = await tool!.execute(
      { brief: 'Implement the bounded worker task and report proof.' },
      { abortSignal: new AbortController().signal, toolCallId: 'call-1', sessionId: 'orch-parent' },
    )

    expect(result.isError).toBe(false)
    expect(sessionBindings.bind).toHaveBeenCalledWith('worker-child', 'parent-epic')
    expect(bindingState['worker-child']).toBe('parent-epic')
    expect(promptPayload).toMatchObject({ model: { provider: 'openai', id: 'gpt-worker' }, requireIdle: true })
    expect(promptPayload?.content).toBe(
      'Host context: epic parent-epic ([Parent Epic]) worktree /repo/.worktrees/epic-parent-epic branch epic/parent-epic. Your session id is worker-child (use it as your br actor). Parent session: orch-parent.\n\nImplement the bounded worker task and report proof.',
    )
  })

  it('unbinds a newly created child when its first prompt fails', async () => {
    const entry: FactoryEpicEntry = {
      epicKey: 'parent-epic', featureName: 'Parent Epic', worktree: '/repo/.worktrees/epic-parent-epic',
      branch: 'epic/parent-epic', repositoryRoot: '/repo', orchestratorSessionId: 'orch-parent',
      createdAt: '2026-09-05T00:00:00.000Z', status: 'active',
    }
    const registry: FactoryEpicRegistry = {
      load: async () => [entry], list: async () => [entry], get: async () => entry,
      register: async () => entry, setOrchestratorSession: async () => entry, markClosed: async () => ({ ...entry, status: 'closed' }),
    }
    const bindingState: Record<string, string> = { 'orch-parent': entry.epicKey }
    const unbind = vi.fn(async (sessionId: string) => { delete bindingState[sessionId] })
    const sessionBindings: FactorySessionBindings = {
      load: async () => ({ ...bindingState }), get: async (sessionId) => bindingState[sessionId],
      bind: async (sessionId, epicKey) => { bindingState[sessionId] = epicKey },
      unbind,
      inherit: async () => entry.epicKey,
      reconcile: async () => ({ droppedSessionIds: [], restoredOrchestratorSessionIds: [] }),
    }
    const app = {
      async inject(request: { method: string; url: string }) {
        if (request.method === 'POST' && request.url.endsWith('/sessions')) {
          return { statusCode: 201, body: '', json: <T>() => ({ sessionId: 'worker-child' }) as T }
        }
        if (request.method === 'POST' && request.url.endsWith('/prompt')) {
          return { statusCode: 503, body: 'prompt unavailable', json: <T>() => ({}) as T }
        }
        throw new Error(`unexpected request ${request.method} ${request.url}`)
      },
    }
    const handle = createFactoryDelegatePlugin({ workspaceScopeId: 'factory-hub', registry, sessionBindings, timeoutMs: 1_000 })
    handle.bind(app as never)
    const [tool] = handle.plugin.agentToolFactory?.({ agentTypeId: 'boring-orchestrator' }) ?? []
    const result = await tool!.execute(
      { brief: 'Implement the bounded worker task and report proof.' },
      { abortSignal: new AbortController().signal, toolCallId: 'call-failed', sessionId: 'orch-parent' },
    )
    expect(result).toMatchObject({ isError: true, details: { code: 'PROMPT_FAILED', delegationId: 'worker-child', status: 503 } })
    expect(unbind).toHaveBeenCalledWith('worker-child')
    expect(bindingState['worker-child']).toBeUndefined()
  })
})

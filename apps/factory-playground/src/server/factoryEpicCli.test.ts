import { afterEach, describe, expect, it, vi } from 'vitest'
import { cmdAdopt, REPOSITORY_ROOT } from '../../scripts/factory-epic.mjs'


afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('factory epic launcher', () => {
  it('repeats an explicit legacy adoption with the same payload', async () => {
    const payloads: unknown[] = []
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, options?: RequestInit) => {
      const path = new URL(String(url)).pathname
      if ((options?.method ?? 'GET') === 'GET' && path === '/api/v1/workspace/meta') {
        return new Response(JSON.stringify({ workspaceId: 'factory-hub', workspaceRoot: REPOSITORY_ROOT }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (options?.method === 'POST' && path === '/api/v1/factory/epics/legacy-epic/adopt') {
        payloads.push(JSON.parse(String(options.body)))
        return new Response(JSON.stringify({ epicKey: 'legacy-epic', orchestratorSessionId: 'legacy-session' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response('{}', { status: 404 })
    }))
    const flags = { session: 'legacy-session', transcript: '/tmp/legacy-session.jsonl' }

    await cmdAdopt('legacy-epic', flags)
    await cmdAdopt('legacy-epic', flags)

    expect(payloads).toEqual([
      { orchestratorSessionId: 'legacy-session', transcriptPath: '/tmp/legacy-session.jsonl' },
      { orchestratorSessionId: 'legacy-session', transcriptPath: '/tmp/legacy-session.jsonl' },
    ])
  })
})

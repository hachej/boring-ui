import { mkdir, mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

import { createOneChatRuntime, ONE_CHAT_APP_HEADER, type OneChatRuntime } from '../agentHost'
import { openIntent, whereWeAreLine } from '../memoryFiles'

const runtimes: OneChatRuntime[] = []
afterEach(async () => { await Promise.all(runtimes.splice(0).map((runtime) => runtime.close())) })

async function workspace(parent: string, slug: string): Promise<string> {
  const root = path.join(parent, slug)
  await mkdir(path.join(root, 'agent', 'intents'), { recursive: true })
  await mkdir(path.join(root, 'docs'), { recursive: true })
  return root
}

describe('per-app runtime scope', () => {
  test('isolates two session inventories and each app intent directory', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'one-chat-scopes-'))
    const alpha = await workspace(root, 'alpha')
    const beta = await workspace(root, 'beta')
    const runtime = await createOneChatRuntime({
      logger: false,
      sessionRoot: path.join(root, 'sessions'),
      resolveApp(slug) {
        if (slug === 'alpha') return { slug, workspaceRoot: alpha, appBaseUrl: 'http://localhost:6101/' }
        if (slug === 'beta') return { slug, workspaceRoot: beta, appBaseUrl: 'http://localhost:6102/' }
        return undefined
      },
    })
    runtimes.push(runtime)

    const create = (slug: string) => runtime.app.inject({
      method: 'POST',
      url: '/api/v1/agents/default/sessions',
      headers: { [ONE_CHAT_APP_HEADER]: slug },
      payload: {},
    })
    const alphaCreated = await create('alpha')
    const betaCreated = await create('beta')
    expect(alphaCreated.statusCode).toBe(201)
    expect(betaCreated.statusCode).toBe(201)
    const alphaSession = alphaCreated.json<{ sessionId: string }>().sessionId
    const betaSession = betaCreated.json<{ sessionId: string }>().sessionId
    expect(alphaSession).not.toBe(betaSession)

    const stateStatus = async (slug: string, sessionId: string) => (await runtime.app.inject({
      method: 'GET',
      url: `/api/v1/agents/default/sessions/${sessionId}/state`,
      headers: { [ONE_CHAT_APP_HEADER]: slug },
    })).statusCode
    expect(await stateStatus('alpha', alphaSession)).toBe(200)
    expect(await stateStatus('alpha', betaSession)).toBe(404)
    expect(await stateStatus('beta', betaSession)).toBe(200)
    expect(await stateStatus('beta', alphaSession)).toBe(404)

    await openIntent(alpha, 'alpha-only', 'Only alpha remembers this.')
    expect(await whereWeAreLine(alpha)).toContain('alpha-only')
    expect(await whereWeAreLine(beta)).toBeUndefined()

    const alphaStage: unknown[] = []
    const betaStage: unknown[] = []
    runtime.stageForApp('alpha').subscribe((event) => alphaStage.push(event))
    runtime.stageForApp('beta').subscribe((event) => betaStage.push(event))
    runtime.stageForApp('alpha').emit({ type: 'stage.show', what: 'app', url: 'http://localhost:6101/' })
    expect(alphaStage).toHaveLength(1)
    expect(betaStage).toHaveLength(0)
  })
})

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { registerAgentRoutes } from '@hachej/boring-agent/server'
import {
  createSandboxRuntimeModeAdapter,
  sandboxRuntimeHostOperations,
} from '@hachej/boring-workspace/app/server'
import { fullAppAgentSessionNamespace } from '../boringMcp'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

describe('full-app native Pi session isolation', () => {
  it('keeps a known native session id private to its user and workspace namespace', async () => {
    const workspaceRoot = await makeTempDir('boring-full-app-native-workspaces-')
    const sessionRoot = await makeTempDir('boring-full-app-native-sessions-')
    const workspaceId = 'workspace-1'
    const nativeSessionId = 'native-user-a'
    const userANamespace = fullAppAgentSessionNamespace({ workspaceId, userId: 'user-a' })
    const userASessionDir = join(sessionRoot, userANamespace)
    const timestamp = new Date().toISOString()
    await mkdir(userASessionDir, { recursive: true })
    await writeFile(
      join(userASessionDir, `2026-07-25T00-00-00.000Z_${nativeSessionId}.jsonl`),
      [
        JSON.stringify({
          type: 'session',
          version: 3,
          id: nativeSessionId,
          timestamp,
          cwd: join(workspaceRoot, workspaceId),
        }),
        JSON.stringify({
          type: 'message',
          id: 'message-user-a',
          parentId: null,
          timestamp,
          message: {
            role: 'user',
            content: [{ type: 'text', text: 'private native transcript' }],
            timestamp: Date.now(),
          },
        }),
      ].join('\n') + '\n',
      'utf8',
    )

    const app = Fastify({ logger: false })
    app.addHook('onRequest', async (request) => {
      const userId = String(request.headers['x-test-user-id'] ?? '').trim()
      request.user = userId
        ? { id: userId, email: `${userId}@example.test`, name: userId, emailVerified: true }
        : null
    })
    await app.register(registerAgentRoutes, {
      workspaceRoot,
      sessionRoot,
      mode: 'direct',
      runtimeModeAdapter: createSandboxRuntimeModeAdapter('direct'),
      runtimeHost: sandboxRuntimeHostOperations,
      externalPlugins: false,
      provisionWorkspace: false,
      nativeSessionStartEnabled: true,
      getWorkspaceId: async (request) => String(request.headers['x-test-workspace-id'] ?? ''),
      getWorkspaceRoot: async (resolvedWorkspaceId) => join(workspaceRoot, resolvedWorkspaceId),
      getSessionNamespace: ({ workspaceId: resolvedWorkspaceId, request, userId }) =>
        fullAppAgentSessionNamespace({ workspaceId: resolvedWorkspaceId, request, userId }),
    })
    await app.ready()

    try {
      const userAList = await app.inject({
        method: 'GET',
        url: '/api/v1/agent/pi-chat/sessions',
        headers: { 'x-test-workspace-id': workspaceId, 'x-test-user-id': 'user-a' },
      })
      expect(userAList.statusCode).toBe(200)
      expect(userAList.json()).toEqual([
        expect.objectContaining({ id: nativeSessionId, nativeSessionId }),
      ])

      const userBList = await app.inject({
        method: 'GET',
        url: '/api/v1/agent/pi-chat/sessions',
        headers: { 'x-test-workspace-id': workspaceId, 'x-test-user-id': 'user-b' },
      })
      expect(userBList.statusCode).toBe(200)
      expect(userBList.json()).toEqual([])

      const userBLoad = await app.inject({
        method: 'GET',
        url: `/api/v1/agent/pi-chat/${nativeSessionId}/state`,
        headers: { 'x-test-workspace-id': workspaceId, 'x-test-user-id': 'user-b' },
      })
      expect(userBLoad.statusCode).toBe(404)
      expect(userBLoad.body).not.toContain(userANamespace)
    } finally {
      await app.close()
    }
  })
})

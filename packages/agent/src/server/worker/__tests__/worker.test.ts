import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createWorkerServer, WORKER_ERROR_CODES, type WorkerConfig } from '../index'
import { WORKER_INTERNAL_TOKEN_HEADER } from '../../index'

const INTERNAL_TOKEN = 'test-internal-token'
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'

async function stubConfig(): Promise<WorkerConfig> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'boring-worker-'))
  return {
    workspaceRoot,
    internalToken: INTERNAL_TOKEN,
    port: 0,
    host: '127.0.0.1',
    execConcurrency: 2,
    bwrapNetwork: 'isolated',
    resourceLimits: {
      cpuSeconds: 30,
      fileSizeBlocks: 2048,
      maxProcesses: 512,
      openFiles: 256,
      virtualMemoryKb: 1024,
    },
  }
}

describe('createWorkerServer', () => {
  let close: (() => Promise<void>) | undefined

  afterEach(async () => {
    await close?.()
    close = undefined
  })

  it('boots from a stub config and serves an unauthenticated health check', async () => {
    const config = await stubConfig()
    const { app, config: returned } = await createWorkerServer({ config, fastify: { logger: false } })
    close = () => app.close()
    expect(returned).toBe(config)

    const health = await app.inject({ method: 'GET', url: '/health' })
    expect(health.statusCode).toBe(200)
    expect(health.json()).toEqual({ ok: true })
  })

  it('rejects internal routes without a valid internal token', async () => {
    const config = await stubConfig()
    const { app } = await createWorkerServer({ config, fastify: { logger: false } })
    close = () => app.close()

    const unauthorized = await app.inject({
      method: 'POST',
      url: `/internal/workspaces/${WORKSPACE_ID}/fs`,
      payload: { op: 'stat', path: '.' },
    })
    expect(unauthorized.statusCode).toBe(401)
    expect(unauthorized.json()).toMatchObject({ error: { code: WORKER_ERROR_CODES.AUTH_INVALID } })

    const badWorkspace = await app.inject({
      method: 'POST',
      url: '/internal/workspaces/not-a-uuid/fs',
      headers: { [WORKER_INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN },
      payload: { op: 'stat', path: '.' },
    })
    expect(badWorkspace.statusCode).toBe(400)
    expect(badWorkspace.json()).toMatchObject({ error: { code: WORKER_ERROR_CODES.INVALID_WORKSPACE_ID } })
  })
})

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { ModelRuntime } from '@mariozechner/pi-coding-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDiagramServerPlugin } from './index'

const previous = new Map<string, string | undefined>()
const dirs: string[] = []

function setEnv(name: string, value: string | undefined) {
  if (!previous.has(name)) previous.set(name, process.env[name])
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

afterEach(async () => {
  vi.restoreAllMocks()
  for (const [name, value] of previous) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  previous.clear()
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function mountWithOpenRouterFile(secret: string) {
  const root = await mkdtemp(join(tmpdir(), 'boring-diagram-server-'))
  dirs.push(root)
  const home = join(root, 'home')
  const agentDir = join(home, '.pi', 'agent')
  await mkdir(agentDir, { recursive: true })
  await writeFile(join(agentDir, 'auth.json'), JSON.stringify({
    openrouter: { type: 'api_key', key: secret },
  }))
  setEnv('HOME', home)
  setEnv('OPENROUTER_API_KEY', undefined)
  setEnv('BORING_DIAGRAM_OPENROUTER_API_KEY', undefined)
  setEnv('BORING_EXCALIDRAW_OPENROUTER_API_KEY', undefined)
  const app = Fastify({ logger: false })
  const plugin = createDiagramServerPlugin({ workspaceRoot: root })
  await app.register(plugin.routes!)
  await app.ready()
  return app
}

describe('Diagram server ModelRuntime auth compatibility', () => {
  it('reports file-backed image auth without exposing credential material', async () => {
    const secret = 'diagram-file-secret'
    const app = await mountWithOpenRouterFile(secret)
    try {
      const response = await app.inject({ method: 'GET', url: '/api/v1/plugins/diagram/render/models' })
      expect(response.statusCode).toBe(200)
      expect(response.json().authConfigured).toBe(true)
      expect(response.body).not.toContain(secret)
    } finally {
      await app.close()
    }
  })

  it('short-circuits runtime auth for an explicit Diagram environment credential', async () => {
    const fileSecret = 'diagram-file-secret'
    const envSecret = 'diagram-env-secret'
    const app = await mountWithOpenRouterFile(fileSecret)
    setEnv('BORING_DIAGRAM_OPENROUTER_API_KEY', envSecret)
    const getAuth = vi.spyOn(ModelRuntime.prototype, 'getAuth')
      .mockRejectedValue(new Error('credential store unavailable'))
    try {
      const response = await app.inject({ method: 'GET', url: '/api/v1/plugins/diagram/render/models' })
      expect(response.statusCode).toBe(200)
      expect(response.json().authConfigured).toBe(true)
      expect(response.body).not.toContain(fileSecret)
      expect(response.body).not.toContain(envSecret)
      expect(getAuth).not.toHaveBeenCalled()
    } finally {
      await app.close()
    }
  })
})

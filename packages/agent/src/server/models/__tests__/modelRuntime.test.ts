import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createConfiguredModelRuntime } from '../modelRuntime.js'

const previousEnv = new Map<string, string | undefined>()
const tempDirs: string[] = []

function setEnv(name: string, value: string | undefined) {
  if (!previousEnv.has(name)) previousEnv.set(name, process.env[name])
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

afterEach(async () => {
  vi.unstubAllGlobals()
  for (const [name, value] of previousEnv) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  previousEnv.clear()
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('createConfiguredModelRuntime', () => {
  it('preserves and prefers an existing Pi auth.json credential over environment auth', async () => {
    const home = await mkdtemp(join(tmpdir(), 'boring-model-runtime-home-'))
    tempDirs.push(home)
    setEnv('HOME', home)
    setEnv('ANTHROPIC_API_KEY', 'env-secret')
    const agentDir = join(home, '.pi', 'agent')
    await mkdir(agentDir, { recursive: true })
    const authPath = join(agentDir, 'auth.json')
    const bytes = JSON.stringify({ anthropic: { type: 'api_key', key: 'file-secret' } }, null, 2)
    await writeFile(authPath, bytes)
    const fetchSpy = vi.fn(() => { throw new Error('unexpected network access') })
    vi.stubGlobal('fetch', fetchSpy)

    const { modelRuntime } = await createConfiguredModelRuntime({
      authPath,
      modelsPath: null,
    })

    expect(modelRuntime.getAvailableSnapshot().some((model) => model.provider === 'anthropic')).toBe(true)
    await expect(modelRuntime.getAuth('anthropic')).resolves.toMatchObject({
      auth: { apiKey: 'file-secret' },
    })
    expect(await readFile(authPath, 'utf8')).toBe(bytes)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('settles Infomaniak and custom env providers in the offline snapshot', async () => {
    const home = await mkdtemp(join(tmpdir(), 'boring-model-runtime-env-home-'))
    tempDirs.push(home)
    setEnv('HOME', home)
    setEnv('BORING_AGENT_INFOMANIAK_PRODUCT_ID', '108321')
    setEnv('INFOMANIAK_API_TOKEN', 'infomaniak-secret')
    setEnv('BORING_AGENT_CUSTOM_MODEL_PROVIDER', 'custom')
    setEnv('BORING_AGENT_CUSTOM_MODEL_ID', 'custom-model')
    setEnv('BORING_AGENT_CUSTOM_MODEL_BASE_URL', 'https://models.example.test/v1')
    setEnv('BORING_AGENT_CUSTOM_MODEL_API_KEY', 'custom-secret')
    const fetchSpy = vi.fn(() => { throw new Error('unexpected network access') })
    vi.stubGlobal('fetch', fetchSpy)

    const { modelRuntime } = await createConfiguredModelRuntime({
      authPath: join(home, '.pi', 'agent', 'auth.json'),
      modelsPath: null,
    })

    const custom = modelRuntime.getModel('custom', 'custom-model')
    expect(custom).toBeDefined()
    expect(modelRuntime.getAvailableSnapshot()).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'infomaniak' }),
      expect.objectContaining({ provider: 'custom', id: 'custom-model' }),
    ]))
    await expect(modelRuntime.getAuth(custom!)).resolves.toMatchObject({ auth: { apiKey: 'custom-secret' } })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

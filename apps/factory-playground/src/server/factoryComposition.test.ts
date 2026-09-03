import { spawnSync } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createFactoryPlayground } from './app'
import { loadNativeFactoryFleet, FACTORY_ORCHESTRATOR_AGENT_TYPE_ID } from './factoryFleet'
import { createFactoryLoopPlugin } from './loopPlugin'
import { createFactorySandboxPlugin, FACTORY_WORKER_AGENT_TYPE_ID } from './sandboxComposition'
import { simulateFactoryFeature } from './simulateFeature'

const appRoot = resolve(import.meta.dirname, '../..')
const repositoryRoot = resolve(appRoot, '../..')
const temporaryRoots: string[] = []
const brAvailable = spawnSync('br', ['--version'], { stdio: 'ignore' }).status === 0

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(async (root) => await rm(root, { recursive: true, force: true })))
})

describe('native Factory composition', () => {
  it('loads canonical repo profiles and grants loop and sandbox to different seats', async () => {
    const fleet = await loadNativeFactoryFleet(repositoryRoot, {
      orchestrator: 'openai-codex:gpt-5.6-sol',
      worker: 'anthropic:claude-sonnet-4-6',
      epicKey: 'live-farewell',
    })
    expect(fleet.map((agent) => agent.agentTypeId)).toEqual([
      FACTORY_ORCHESTRATOR_AGENT_TYPE_ID,
      FACTORY_WORKER_AGENT_TYPE_ID,
    ])
    const orchestrator = fleet[0]!
    const worker = fleet[1]!
    expect(orchestrator.plugins?.map((plugin) => plugin.name)).toEqual(['factory-loop', 'boring-automation'])
    expect(orchestrator.model?.preferred).toBe('openai-codex:gpt-5.6-sol')
    expect(worker.plugins?.map((plugin) => plugin.name)).toEqual(['sandbox'])
    expect(worker.model?.preferred).toBe('anthropic:claude-sonnet-4-6')
    expect(orchestrator.definition.instructions).toContain('boring-skill:start name=plan')
    expect(worker.definition.instructions).toContain('boring-skill:start name=exec')
    expect(worker.definition.instructions).not.toContain('boring-skill:start name=plan')
    expect(orchestrator.definition.instructions).toContain('epic:live-farewell')
    expect(worker.definition.instructions).toContain('epic:live-farewell')
    expect(worker.definition.instructions).toContain('br ready --label epic:live-farewell --unassigned')

    const loop = createFactoryLoopPlugin()
    expect(loop.extensionPaths).toEqual([expect.stringMatching(/pi-mono-loop\/index\.ts$/)])

    const root = await mkdtemp(resolve(tmpdir(), 'factory-sandbox-composition-'))
    temporaryRoots.push(root)
    const sandbox = createFactorySandboxPlugin(root, root, {})
    expect(sandbox.agentToolFactory?.({ agentTypeId: FACTORY_WORKER_AGENT_TYPE_ID }).map((tool) => tool.name))
      .toEqual(['sandbox', 'sandbox_bash'])
    expect(() => sandbox.agentToolFactory?.({ agentTypeId: FACTORY_ORCHESTRATOR_AGENT_TYPE_ID }))
      .toThrow('sandbox host grant denied')
    expect(() => sandbox.agentToolFactory?.({ agentTypeId: 'ordinary-agent' }))
      .toThrow('sandbox host grant denied')
  })

  it('boots the native app with /loop only on the Orchestrator and sandbox only on the Worker', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'factory-native-app-'))
    temporaryRoots.push(root)
    const app = await createFactoryPlayground({
      appRoot,
      repositoryRoot,
      workspaceRoot: repositoryRoot,
      logger: false,
      env: {
        BORING_AGENT_SESSION_ROOT: resolve(root, 'sessions'),
        BORING_FACTORY_STATE_ROOT: resolve(root, 'state'),
      },
    })
    try {
      const meta = await app.inject({ method: 'GET', url: '/api/v1/workspace/meta' })
      expect(meta.statusCode).toBe(200)
      const metaBody = meta.json<{ epicKey: string }>()
      expect(typeof metaBody.epicKey).toBe('string')
      expect(metaBody.epicKey.length).toBeGreaterThan(0)

      const header = { 'x-boring-workspace-id': 'factory-playground' }
      const createSession = async (agentTypeId: string) => {
        const response = await app.inject({
          method: 'POST',
          url: `/api/v1/agents/${agentTypeId}/sessions`,
          headers: header,
          payload: { requestId: `create-${agentTypeId}-${crypto.randomUUID()}` },
        })
        expect(response.statusCode, response.body).toBe(201)
        return response.json<{ sessionId: string }>().sessionId
      }
      const workerSessionId = await createSession(FACTORY_WORKER_AGENT_TYPE_ID)
      const orchestratorSessionId = await createSession(FACTORY_ORCHESTRATOR_AGENT_TYPE_ID)
      const commandsFor = async (agentTypeId: string, sessionId: string) => {
        const response = await app.inject({
          method: 'GET',
          url: `/api/v1/agents/${agentTypeId}/commands?sessionId=${sessionId}`,
          headers: header,
        })
        expect(response.statusCode).toBe(200)
        return response.json<{ commands: Array<{ name: string }> }>().commands.map(({ name }) => name)
      }
      expect(await commandsFor(FACTORY_WORKER_AGENT_TYPE_ID, workerSessionId)).toEqual([])
      expect(await commandsFor(FACTORY_ORCHESTRATOR_AGENT_TYPE_ID, orchestratorSessionId)).toEqual(['loop'])

      const loopList = await app.inject({
        method: 'POST',
        url: `/api/v1/agents/${FACTORY_ORCHESTRATOR_AGENT_TYPE_ID}/commands/execute`,
        headers: header,
        payload: { requestId: `loop-list-${crypto.randomUUID()}`, sessionId: orchestratorSessionId, name: 'loop', args: 'list' },
      })
      expect(loopList.statusCode).toBe(200)
      expect(loopList.json()).toMatchObject({ ok: true, name: 'loop' })

      const workerTools = await app.inject({ method: 'GET', url: `/api/v1/agents/${FACTORY_WORKER_AGENT_TYPE_ID}/tools`, headers: header })
      const orchestratorTools = await app.inject({ method: 'GET', url: `/api/v1/agents/${FACTORY_ORCHESTRATOR_AGENT_TYPE_ID}/tools`, headers: header })
      const names = (response: typeof workerTools) => response.json<{ tools: Array<{ name: string }> }>().tools.map(({ name }) => name)
      expect(names(workerTools)).toEqual(expect.arrayContaining(['sandbox', 'sandbox_bash']))
      expect(names(workerTools)).not.toContain('boring_automation')
      expect(names(orchestratorTools)).toContain('boring_automation')
      expect(names(orchestratorTools)).not.toContain('sandbox')
    } finally {
      await app.close()
    }
  }, 30_000)

  it.runIf(brAvailable)('executes and cleans a two-Worker feature simulation through real sandbox tools', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'factory-feature-simulation-'))
    temporaryRoots.push(root)
    const events: string[] = []
    const receipt = await simulateFactoryFeature({
      seedRoot: resolve(appRoot, 'src/fixtures/demo-repo'),
      leaseRoot: resolve(root, 'leases'),
      outputPath: resolve(root, 'receipt.json'),
      delayMs: 0,
      onEvent: (event) => { events.push(event.stage) },
    })

    expect(receipt.loopCommand).toBe('/loop')
    expect(receipt.sharedEpicWorktree).toBe(true)
    expect(receipt.workers).toHaveLength(2)
    expect(new Set(receipt.workers.map((worker) => worker.sandbox)).size).toBe(2)
    expect(receipt.workers.every((worker) => worker.hostValidation === 'clean' && worker.released)).toBe(true)
    expect(receipt.workers.every((worker) => /^[a-f0-9]{40}$/.test(worker.sha))).toBe(true)
    expect(receipt.workers.every((worker) => worker.sandboxSourceSha === worker.sha)).toBe(true)
    expect(receipt.integratedFeatureSha).toBe(receipt.workers.at(-1)?.sha)
    expect(receipt.integratedTestExitCode).toBe(0)
    expect(receipt.cleanupDebt).toBe(0)
    expect(receipt.merged).toBe(false)
    expect(events).toEqual(expect.arrayContaining(['intake', 'plan-gate', 'loop', 'claim', 'commit', 'sandbox', 'validation', 'settled', 'integration', 'complete']))
    await expect(readdir(resolve(root, 'leases'))).resolves.toEqual([])
  }, 30_000)
})

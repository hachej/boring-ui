import { spawnSync } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createFactoryPlayground } from './app'
import { loadNativeFactoryFleet, FACTORY_ORCHESTRATOR_AGENT_TYPE_ID, FACTORY_REVIEWER_AGENT_TYPE_ID } from './factoryFleet'
import { createFactoryDelegatePlugin } from './delegatePlugin'
import { createFactorySandboxPlugin, FACTORY_WORKER_AGENT_TYPE_ID } from './sandboxComposition'
import { simulateFactoryFeature } from './simulateFeature'

const DELEGATE_OPTIONS = {
  workspaceScopeId: 'factory-playground',
  epicKey: 'live-farewell',
  featureName: 'Farewell API',
  workspaceRoot: process.cwd(),
  demoControl: { listDemos: async () => ({}), stopDemo: async () => 'stopped' as const },
  supervisionControl: { stopSupervision: async () => {} },
}

const appRoot = resolve(import.meta.dirname, '../..')
const repositoryRoot = resolve(appRoot, '../..')
const temporaryRoots: string[] = []
const brAvailable = spawnSync('br', ['--version'], { stdio: 'ignore' }).status === 0

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(async (root) => await rm(root, { recursive: true, force: true })))
})

describe('native Factory composition', () => {
  it('loads canonical repo profiles and grants supervision and sandbox to different seats', async () => {
    const fleet = await loadNativeFactoryFleet(repositoryRoot, {
      orchestrator: 'openai-codex:gpt-5.6-sol',
      worker: 'anthropic:claude-sonnet-4-6',
      reviewer: 'openai-codex:gpt-5.4',
      epicKey: 'live-farewell',
      featureName: 'Farewell API',
    })
    expect(fleet.map((agent) => agent.agentTypeId)).toEqual([
      FACTORY_ORCHESTRATOR_AGENT_TYPE_ID,
      FACTORY_WORKER_AGENT_TYPE_ID,
      FACTORY_REVIEWER_AGENT_TYPE_ID,
    ])
    const orchestrator = fleet[0]!
    const worker = fleet[1]!
    const reviewer = fleet[2]!
    expect(orchestrator.plugins?.map((plugin) => plugin.name)).toEqual(['factory-supervision', 'factory-demo', 'boring-automation', 'factory-delegate'])
    expect(orchestrator.model?.preferred).toBe('openai-codex:gpt-5.6-sol')
    expect(worker.plugins?.map((plugin) => plugin.name)).toEqual(['sandbox', 'factory-delegate'])
    expect(worker.model?.preferred).toBe('anthropic:claude-sonnet-4-6')
    expect(reviewer.plugins ?? []).toEqual([])
    expect(reviewer.model?.preferred).toBe('openai-codex:gpt-5.4')
    expect(reviewer.definition.instructions).toContain('boring-skill:start name=fresh-eyes')
    expect(reviewer.definition.instructions).toContain('epic:live-farewell')
    expect(reviewer.definition.instructions).toContain('You review only Beads labelled `epic:live-farewell`; report, never edit.')
    expect(orchestrator.definition.instructions).toContain('boring-skill:start name=plan')
    expect(worker.definition.instructions).toContain('boring-skill:start name=exec')
    expect(worker.definition.instructions).not.toContain('boring-skill:start name=plan')
    expect(orchestrator.definition.instructions).toContain('epic:live-farewell')
    expect(worker.definition.instructions).toContain('epic:live-farewell')
    expect(worker.definition.instructions).toContain('br ready --label epic:live-farewell --unassigned')

    // owner-gate is no longer part of the Worker's canonical skill set; only the Orchestrator keeps it.
    expect(worker.definition.instructions).not.toContain('boring-skill:start name=owner-gate')
    expect(orchestrator.definition.instructions).toContain('boring-skill:start name=owner-gate')

    // show-me is attached to the Orchestrator seat only (owner ruling: mandatory at both gates).
    expect(orchestrator.definition.instructions).toContain('boring-skill:start name=show-me')
    expect(worker.definition.instructions).not.toContain('boring-skill:start name=show-me')
    expect(orchestrator.definition.instructions).toContain('The `show-me` skill above is mandatory, not optional, at both gates')

    // Recovery rule (epic-binding appendix, orchestrator).
    expect(orchestrator.definition.instructions).toContain('Recovery: run `factory_status` on every supervision tick.')
    expect(orchestrator.definition.instructions).toContain('br update <id> --assignee "" --status open --actor <your session id>')
    expect(orchestrator.definition.instructions).toContain('Never release a Bead whose assignee session is `exists-busy`.')

    // Uncommitted-changes handoff rule (epic-binding appendix, worker).
    expect(worker.definition.instructions).toContain('If the shared worktree already holds uncommitted changes for your Bead from a previous')
    expect(worker.definition.instructions).toContain('never revert them wholesale.')

    // factory-precedence appendix: now only binds host tool names to steps the canonical
    // exec/plan/owner-gate skill text already describes (that text is reconciled in the
    // .agents/skills sources, not duplicated here).
    expect(worker.definition.instructions).toContain("The `exec` skill above is this seat's full loop")
    expect(worker.definition.instructions).toContain('The host tool that runs your adversarial review is `fresh_review`')
    expect(orchestrator.definition.instructions).toContain("The `plan` and `owner-gate` skills above are this seat's full loop")
    expect(orchestrator.definition.instructions).toContain('`dispatch_worker`')
    expect(orchestrator.definition.instructions).toContain('`factory_status`')
    expect(orchestrator.definition.instructions).toContain('`demo_sandbox`')
    expect(orchestrator.definition.instructions).toContain('After `close_epic` returns `overall: complete`, raise one final `ask_user` acknowledgement')
    expect(orchestrator.definition.instructions).toContain('titled `[Feature Name] Done`')
    expect(orchestrator.definition.instructions).toContain('its context first line must be one plain sentence without IDs')
    expect(orchestrator.definition.instructions).toContain('PR URL, merge SHA, closed/already-closed Bead IDs, cleanup')
    expect(orchestrator.definition.instructions).toContain('the calling session, and involved Worker session IDs')
    expect(orchestrator.definition.instructions).toContain('exactly one required radio field named `acknowledgement` with two options:')
    expect(orchestrator.definition.instructions).toContain('`acknowledge` labelled `Acknowledge — epic is complete`')
    expect(orchestrator.definition.instructions).toContain('`follow_up` labelled `Acknowledge — follow-up needed`')
    expect(orchestrator.definition.instructions).toContain('this is a completion acknowledgement, not merge permission.')
    expect(reviewer.definition.instructions).not.toContain('factory-precedence')

    // Naming convention (docs/procedures/naming-conventions.md): feature name flows into the
    // epic-binding appendix so Beads/sessions the agent creates lead with `[Feature Name]`.
    expect(orchestrator.definition.instructions).toContain('(**Farewell API**)')
    expect(orchestrator.definition.instructions).toContain('titled per docs/procedures/naming-conventions.md, i.e. `[Farewell API] <verb phrase>` (`[Farewell API] Epic`')

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

  it('boots the native app with supervise/factory_status only on the Orchestrator and sandbox only on the Worker', async () => {
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
        let sawReplayUncertain = false
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const response = await app.inject({
            method: 'POST',
            url: `/api/v1/agents/${agentTypeId}/sessions`,
            headers: header,
            payload: { requestId: `create-${agentTypeId}-${crypto.randomUUID()}` },
          })
          if (response.statusCode === 201) return response.json<{ sessionId: string }>().sessionId
          expect(response.statusCode, response.body).toBe(409)
          expect(response.json<{ error?: { code?: string } }>().error?.code, response.body).toBe('AGENT_REQUEST_OUTCOME_UNKNOWN')
          sawReplayUncertain = true
          await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)))
        }
        if (sawReplayUncertain) {
          throw new Error(`failed to create ${agentTypeId} session after replay-uncertain retries`)
        }
        throw new Error(`failed to create ${agentTypeId} session`)
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
      expect(await commandsFor(FACTORY_ORCHESTRATOR_AGENT_TYPE_ID, orchestratorSessionId)).toEqual([])

      const workerTools = await app.inject({ method: 'GET', url: `/api/v1/agents/${FACTORY_WORKER_AGENT_TYPE_ID}/tools`, headers: header })
      const orchestratorTools = await app.inject({ method: 'GET', url: `/api/v1/agents/${FACTORY_ORCHESTRATOR_AGENT_TYPE_ID}/tools`, headers: header })
      const names = (response: typeof workerTools) => response.json<{ tools: Array<{ name: string }> }>().tools.map(({ name }) => name)
      expect(names(workerTools)).toEqual(expect.arrayContaining(['sandbox', 'sandbox_bash']))
      expect(names(workerTools)).not.toContain('boring_automation')
      expect(names(workerTools)).not.toContain('supervise')
      expect(names(workerTools)).not.toContain('factory_status')
      expect(names(orchestratorTools)).toContain('boring_automation')
      expect(names(orchestratorTools)).not.toContain('sandbox')
      expect(names(orchestratorTools)).toEqual(expect.arrayContaining(['supervise', 'factory_status', 'close_epic', 'dispatch_worker', 'demo_sandbox']))
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

describe('factory delegate plugin', () => {
  it('grants dispatch_worker+factory_status to the orchestrator and fresh_review to the worker, and nothing to any other seat', () => {
    const { plugin } = createFactoryDelegatePlugin(DELEGATE_OPTIONS)
    expect(plugin.agentToolFactory?.({ agentTypeId: FACTORY_ORCHESTRATOR_AGENT_TYPE_ID }).map((tool) => tool.name))
      .toEqual(['dispatch_worker', 'factory_status', 'close_epic'])
    expect(plugin.agentToolFactory?.({ agentTypeId: FACTORY_WORKER_AGENT_TYPE_ID }).map((tool) => tool.name))
      .toEqual(['fresh_review'])
    expect(plugin.agentToolFactory?.({ agentTypeId: FACTORY_REVIEWER_AGENT_TYPE_ID })).toEqual([])
    expect(plugin.agentToolFactory?.({ agentTypeId: 'ordinary-agent' })).toEqual([])
  })

  it('returns an isError result instead of throwing when the host has not bound a running app', async () => {
    const { plugin } = createFactoryDelegatePlugin(DELEGATE_OPTIONS)
    const tools = plugin.agentToolFactory?.({ agentTypeId: FACTORY_ORCHESTRATOR_AGENT_TYPE_ID }) ?? []
    const dispatchTool = tools.find((tool) => tool.name === 'dispatch_worker')
    const statusTool = tools.find((tool) => tool.name === 'factory_status')
    expect(dispatchTool).toBeDefined()
    expect(statusTool).toBeDefined()

    const result = await dispatchTool!.execute(
      { brief: 'This brief is definitely long enough to pass validation.' },
      { abortSignal: new AbortController().signal, toolCallId: 'call-1' },
    )
    expect(result.isError).toBe(true)
    expect(result.details).toMatchObject({ code: 'HOST_NOT_BOUND' })

    const statusResult = await statusTool!.execute({}, { abortSignal: new AbortController().signal, toolCallId: 'call-1b' })
    expect(statusResult.isError).toBe(true)
    expect(statusResult.details).toMatchObject({ code: 'HOST_NOT_BOUND' })
  })

  it('rejects a brief that is too short before touching the host', async () => {
    const { plugin } = createFactoryDelegatePlugin(DELEGATE_OPTIONS)
    const [tool] = plugin.agentToolFactory?.({ agentTypeId: FACTORY_WORKER_AGENT_TYPE_ID }) ?? []
    const result = await tool!.execute(
      { brief: 'too short' },
      { abortSignal: new AbortController().signal, toolCallId: 'call-2' },
    )
    expect(result.isError).toBe(true)
    expect(result.details).toMatchObject({ code: 'INVALID_INPUT' })
  })
})

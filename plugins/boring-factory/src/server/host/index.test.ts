import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFactoryHost } from './index'
import { FACTORY_REQUEST_FILE_MAX_BYTES } from './epicRegistry'

const repositoryRoot = resolve(import.meta.dirname, '../../../../..')
const execFileAsync = promisify(execFile)
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(async (root) => await rm(root, { recursive: true, force: true })))
})

describe('factory host composition', () => {
  it('keeps sandbox provider selection separate from seat model preferences', async () => {
    const stateRoot = await mkdtemp(resolve(tmpdir(), 'factory-host-models-'))
    temporaryRoots.push(stateRoot)
    const env = {
      BORING_FACTORY_ORCHESTRATOR_MODEL: 'orchestrator-from-env',
      BORING_FACTORY_WORKER_MODEL: 'worker-from-env',
      BORING_FACTORY_REVIEWER_MODEL: 'reviewer-from-env',
    } as NodeJS.ProcessEnv

    const host = await createFactoryHost({
      repositoryRoot,
      workspaceRoot: repositoryRoot,
      epicKey: 'seat-model-proof',
      featureName: 'Seat Model Proof',
      stateRoot,
      env,
      provider: 'local-simulation',
    })

    try {
      const preferredModels = host.agents.map((agent) => agent.model?.preferred)
      expect(preferredModels).toEqual([
        env.BORING_FACTORY_ORCHESTRATOR_MODEL,
        env.BORING_FACTORY_WORKER_MODEL,
        env.BORING_FACTORY_REVIEWER_MODEL,
      ])
      expect(preferredModels).not.toContain('local-simulation')
    } finally {
      host.close()
    }
  })

  it('registers an epic, creates and binds its Orchestrator, supports adoption, and exposes hub meta', async () => {
    const stateRoot = await mkdtemp(resolve(tmpdir(), 'factory-host-state-'))
    const intakeRepository = await mkdtemp(resolve(tmpdir(), 'factory-host-repository-'))
    temporaryRoots.push(stateRoot, intakeRepository)
    await execFileAsync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: intakeRepository })
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: intakeRepository })
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: intakeRepository })
    await writeFile(resolve(intakeRepository, 'request.md'), 'Build the intake proof.')
    await writeFile(resolve(intakeRepository, '.gitignore'), '.worktrees/\n')
    await execFileAsync('git', ['add', '.'], { cwd: intakeRepository })
    await execFileAsync('git', ['commit', '--quiet', '-m', 'initial'], { cwd: intakeRepository })
    await execFileAsync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: intakeRepository })

    const prompts: Array<{ sessionId: string; payload: Record<string, unknown> }> = []
    const availableSessions = new Set(['existing-orch'])
    const sessionRoot = resolve(stateRoot, 'sessions')
    const hubNamespace = resolve(sessionRoot, `boring-orchestrator--${createHash('sha256').update('factory-hub').digest('hex').slice(0, 20)}`)
    let created = 0
    let failNextCreate = false
    let failNextPrompt = false
    const app = Fastify({ logger: false })
    app.post('/api/v1/agents/boring-orchestrator/sessions', async (_request, reply) => {
      if (failNextCreate) { failNextCreate = false; return reply.code(503).send({ message: 'temporary failure' }) }
      const sessionId = `orch-${++created}`
      availableSessions.add(sessionId)
      return reply.code(201).send({ sessionId })
    })
    app.post('/api/v1/agents/boring-orchestrator/sessions/:sessionId/prompt', async (request, reply) => {
      if (failNextPrompt) { failNextPrompt = false; return reply.code(503).send({ message: 'temporary failure' }) }
      prompts.push({ sessionId: (request.params as { sessionId: string }).sessionId, payload: request.body as Record<string, unknown> })
      return reply.code(202).send({ accepted: true })
    })
    app.get('/api/v1/agents/boring-orchestrator/sessions/:sessionId/state', async (request, reply) => {
      const sessionId = (request.params as { sessionId: string }).sessionId
      const imported = (await readdir(hubNamespace).catch(() => [])).some((file) => file === `${sessionId}.jsonl` || file.endsWith(`_${sessionId}.jsonl`))
      return availableSessions.has(sessionId) || imported
        ? { state: { status: 'idle' } }
        : reply.code(404).send({ message: 'missing' })
    })
    app.post('/api/v1/workspace-bridge/call', async () => ({
      output: { pending: [{ sessionId: 'legacy-orch', questionId: 'gate-1', title: '[Default Path] Plan approval' }] },
    }))

    const host = await createFactoryHost({ repositoryRoot, workspaceRoot: intakeRepository, stateRoot, env: { BORING_AGENT_SESSION_ROOT: sessionRoot }, provider: 'local-simulation' })
    host.bind(app)
    try {
      const intake = await app.inject({
        method: 'POST',
        url: '/api/v1/factory/epics',
        payload: { epicKey: 'intake-proof', featureName: 'Intake Proof', requestFile: 'request.md', start: true },
      })
      expect(intake.statusCode).toBe(201)
      const intakeWorktree = resolve(intakeRepository, '.worktrees', 'epic-intake-proof')
      expect(intake.json()).toMatchObject({
        epicKey: 'intake-proof',
        orchestratorSessionId: 'orch-1',
        repositoryRoot: intakeRepository,
        worktree: intakeWorktree,
        requestFile: resolve(intakeWorktree, 'request.md'),
        kickoff: { status: 'accepted' },
      })
      await expect(host.sessionBindings.get('orch-1')).resolves.toBe('intake-proof')
      expect(prompts[0]).toMatchObject({ sessionId: 'orch-1', payload: { requireIdle: true } })
      expect(prompts[0]?.payload.content).toEqual(expect.stringContaining('Host context: epic intake-proof ([Intake Proof])'))
      expect(prompts[0]?.payload.content).toEqual(expect.stringContaining('Build the intake proof.'))

      await writeFile(resolve(stateRoot, 'supervision.json'), JSON.stringify({ entries: {
        'orch-1': {
          epicKey: 'intake-proof', agentTypeId: 'boring-orchestrator', sessionId: 'orch-1', intervalMs: 45_000,
          prompt: 'preserve this cadence', startedAt: '2026-09-05T01:00:00.000Z', ticks: 3,
        },
      } }))

      const adopt = await app.inject({ method: 'POST', url: '/api/v1/factory/epics/intake-proof/adopt', payload: { orchestratorSessionId: 'existing-orch' } })
      expect(adopt.statusCode).toBe(200)
      expect(adopt.json()).toMatchObject({ orchestratorSessionId: 'existing-orch' })
      await expect(host.sessionBindings.get('orch-1')).resolves.toBeUndefined()
      await expect(host.sessionBindings.get('existing-orch')).resolves.toBe('intake-proof')
      expect(JSON.parse(await readFile(resolve(stateRoot, 'supervision.json'), 'utf8'))).toEqual({ entries: {
        'existing-orch': expect.objectContaining({
          epicKey: 'intake-proof', sessionId: 'existing-orch', intervalMs: 45_000, prompt: 'preserve this cadence', ticks: 3,
        }),
      } })
      const repeatedAdopt = await app.inject({ method: 'POST', url: '/api/v1/factory/epics/intake-proof/adopt', payload: { orchestratorSessionId: 'existing-orch' } })
      expect(repeatedAdopt.statusCode).toBe(200)
      expect(repeatedAdopt.json()).toMatchObject({ orchestratorSessionId: 'existing-orch' })
      await expect(host.sessionBindings.load()).resolves.toMatchObject({ 'existing-orch': 'intake-proof' })
      expect(Object.keys(JSON.parse(await readFile(resolve(stateRoot, 'supervision.json'), 'utf8')).entries)).toEqual(['existing-orch'])

      const defaultIntake = await app.inject({
        method: 'POST',
        url: '/api/v1/factory/epics',
        payload: { epicKey: 'default-path', featureName: 'Default Path', start: false },
      })
      expect(defaultIntake.statusCode).toBe(201)
      expect(defaultIntake.json()).toMatchObject({
        epicKey: 'default-path',
        worktree: resolve(intakeRepository, '.worktrees', 'epic-default-path'),
        branch: 'epic/default-path',
        kickoff: { status: 'not-requested' },
      })

      const collision = await app.inject({ method: 'POST', url: '/api/v1/factory/epics/default-path/adopt', payload: { orchestratorSessionId: 'existing-orch' } })
      expect(collision.statusCode).toBe(409)
      expect(collision.json()).toMatchObject({ code: 'SESSION_ALREADY_BOUND' })
      await expect(host.sessionBindings.get('existing-orch')).resolves.toBe('intake-proof')

      const legacySessionId = 'legacy-orch'
      const legacyDirectory = resolve(stateRoot, 'epics', 'default-path', 'sessions', 'boring-orchestrator--legacy')
      await mkdir(legacyDirectory, { recursive: true })
      const legacyFile = resolve(legacyDirectory, `2026-09-05T00-00-00.000Z_${legacySessionId}.jsonl`)
      await writeFile(legacyFile, `${JSON.stringify({
        type: 'session', version: 3, id: legacySessionId, timestamp: '2026-09-05T00:00:00.000Z',
        cwd: resolve(intakeRepository, '.worktrees', 'epic-default-path'),
        boringSessionCtx: { workspaceId: 'factory-default-path', userId: 'local' },
      })}\n`)
      const legacyAskUserDirectory = resolve(intakeRepository, '.worktrees', 'epic-default-path', '.boring')
      await mkdir(legacyAskUserDirectory, { recursive: true })
      const legacyQuestion = {
        questionId: 'legacy-gate', sessionId: legacySessionId, ownerPrincipalId: 'local-owner', status: 'ready',
        title: '[Default Path] Legacy approval', artifacts: [], answerToken: 'legacy-token',
        createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z',
      }
      await writeFile(resolve(legacyAskUserDirectory, 'ask-user.json'), JSON.stringify({
        questions: { [legacyQuestion.questionId]: legacyQuestion },
        pendingBySession: { [legacySessionId]: legacyQuestion.questionId },
        answers: {}, transcriptsBySession: {},
      }))
      const legacyAdopt = await app.inject({ method: 'POST', url: '/api/v1/factory/epics/default-path/adopt', payload: { orchestratorSessionId: legacySessionId } })
      expect(legacyAdopt.statusCode).toBe(200)
      expect(legacyAdopt.json()).toMatchObject({ orchestratorSessionId: legacySessionId })
      await expect(host.sessionBindings.get(legacySessionId)).resolves.toBe('default-path')
      const importedFile = (await readdir(hubNamespace)).find((file) => file.endsWith(`_${legacySessionId}.jsonl`))
      expect(importedFile).toBeDefined()
      const importedHeader = JSON.parse((await readFile(resolve(hubNamespace, importedFile!), 'utf8')).trim()) as { boringSessionCtx: unknown }
      expect(importedHeader.boringSessionCtx).toEqual({ workspaceId: 'factory-hub' })
      expect(JSON.parse((await readFile(legacyFile, 'utf8')).trim())).toMatchObject({ boringSessionCtx: { workspaceId: 'factory-default-path' } })
      expect(JSON.parse(await readFile(resolve(intakeRepository, '.boring', 'ask-user.json'), 'utf8'))).toMatchObject({
        questions: { 'legacy-gate': { sessionId: legacySessionId, status: 'ready' } },
        pendingBySession: { [legacySessionId]: 'legacy-gate' },
      })

      failNextCreate = true
      const failedCreate = await app.inject({
        method: 'POST', url: '/api/v1/factory/epics',
        payload: { epicKey: 'retryable', featureName: 'Retryable', start: false },
      })
      expect(failedCreate.statusCode).toBe(500)
      await expect(host.registry.get('retryable')).resolves.toBeUndefined()
      const retried = await app.inject({
        method: 'POST', url: '/api/v1/factory/epics',
        payload: { epicKey: 'retryable', featureName: 'Retryable', start: false },
      })
      expect(retried.statusCode).toBe(201)
      await expect(host.sessionBindings.get(retried.json().orchestratorSessionId)).resolves.toBe('retryable')

      failNextPrompt = true
      const failedKickoff = await app.inject({
        method: 'POST', url: '/api/v1/factory/epics',
        payload: { epicKey: 'kickoff-retry', featureName: 'Kickoff Retry', start: true },
      })
      expect(failedKickoff.statusCode).toBe(201)
      expect(failedKickoff.json()).toMatchObject({ kickoff: { status: 'failed', message: 'failed to start Orchestrator session: HTTP 503' } })
      await expect(host.sessionBindings.get(failedKickoff.json().orchestratorSessionId)).resolves.toBe('kickoff-retry')

      const listed = await app.inject({ method: 'GET', url: '/api/v1/factory/epics' })
      expect(listed.statusCode).toBe(200)
      expect(listed.json()).toEqual(expect.arrayContaining([expect.objectContaining({
        epicKey: 'default-path',
        orchestratorStatus: 'idle',
        pendingQuestion: { questionId: 'gate-1', title: '[Default Path] Plan approval' },
        beads: { open: 0, closed: 0 },
        headSha: expect.stringMatching(/^[0-9a-f]{40}$/),
      })]))

      const meta = await app.inject({ method: 'GET', url: '/api/v1/workspace/meta' })
      expect(meta.json()).toMatchObject({
        projectName: 'Boring Factory',
        workspaceId: 'factory-hub',
        workspaceRoot: intakeRepository,
        epics: expect.arrayContaining([expect.objectContaining({ epicKey: 'intake-proof', orchestratorSessionId: 'existing-orch' })]),
      })

      availableSessions.add('race-a')
      availableSessions.add('race-b')
      const race = await Promise.all(['race-a', 'race-b'].map(async (orchestratorSessionId) => await app.inject({
        method: 'POST', url: '/api/v1/factory/epics/default-path/adopt', payload: { orchestratorSessionId },
      })))
      expect(race.map((response) => response.statusCode)).toEqual([200, 200])
      const finalSessionId = (await host.registry.get('default-path'))?.orchestratorSessionId
      expect(['race-a', 'race-b']).toContain(finalSessionId)
      const losingSessionId = finalSessionId === 'race-a' ? 'race-b' : 'race-a'
      await expect(host.sessionBindings.get(finalSessionId!)).resolves.toBe('default-path')
      await expect(host.sessionBindings.get(losingSessionId)).resolves.toBeUndefined()
      await expect(host.sessionBindings.get(legacySessionId)).resolves.toBeUndefined()
    } finally {
      host.close()
      await app.close()
    }
  })

  it('rejects unsafe, non-regular, and oversized request files before creating a session', async () => {
    const stateRoot = await mkdtemp(resolve(tmpdir(), 'factory-request-state-'))
    const intakeRepository = await mkdtemp(resolve(tmpdir(), 'factory-request-repository-'))
    temporaryRoots.push(stateRoot, intakeRepository)
    await execFileAsync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: intakeRepository })
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: intakeRepository })
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: intakeRepository })
    await writeFile(resolve(intakeRepository, 'request.md'), 'outside the epic worktree')
    await writeFile(resolve(intakeRepository, '.gitignore'), '.worktrees/\n')
    await execFileAsync('git', ['add', '.'], { cwd: intakeRepository })
    await execFileAsync('git', ['commit', '--quiet', '-m', 'initial'], { cwd: intakeRepository })
    await execFileAsync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: intakeRepository })

    async function provision(epicKey: string): Promise<string> {
      const worktree = resolve(intakeRepository, '.worktrees', `epic-${epicKey}`)
      await mkdir(resolve(intakeRepository, '.worktrees'), { recursive: true })
      await execFileAsync('git', ['worktree', 'add', '-q', '-b', `epic/${epicKey}`, worktree, 'HEAD'], { cwd: intakeRepository })
      return worktree
    }

    const symlinkWorktree = await provision('symlink-request')
    await symlink(resolve(intakeRepository, 'request.md'), resolve(symlinkWorktree, 'linked-request.md'))
    const directoryWorktree = await provision('directory-request')
    await mkdir(resolve(directoryWorktree, 'request-directory'))
    const oversizedWorktree = await provision('oversized-request')
    await writeFile(resolve(oversizedWorktree, 'oversized.md'), Buffer.alloc(FACTORY_REQUEST_FILE_MAX_BYTES + 1, 0x61))

    let createdSessions = 0
    const app = Fastify({ logger: false })
    app.post('/api/v1/agents/boring-orchestrator/sessions', async (_request, reply) => {
      createdSessions += 1
      return reply.code(201).send({ sessionId: `unexpected-${createdSessions}` })
    })
    const host = await createFactoryHost({ repositoryRoot, workspaceRoot: intakeRepository, stateRoot, env: {}, provider: 'local-simulation' })
    host.bind(app)
    try {
      const cases = [
        { key: 'absolute-request', requestFile: resolve(intakeRepository, 'request.md'), message: 'relative' },
        { key: 'traversal-request', requestFile: '../request.md', message: 'traversal' },
        { key: 'symlink-request', requestFile: 'linked-request.md', message: 'beneath' },
        { key: 'directory-request', requestFile: 'request-directory', message: 'regular file' },
        { key: 'missing-request', requestFile: 'missing.md', message: 'does not exist' },
        { key: 'oversized-request', requestFile: 'oversized.md', message: `${FACTORY_REQUEST_FILE_MAX_BYTES}` },
      ]
      for (const testCase of cases) {
        const response = await app.inject({
          method: 'POST',
          url: '/api/v1/factory/epics',
          payload: { epicKey: testCase.key, featureName: testCase.key, requestFile: testCase.requestFile, start: false },
        })
        expect(response.statusCode, response.body).toBe(400)
        expect(response.json()).toMatchObject({ code: 'INVALID_EPIC', message: expect.stringContaining(testCase.message) })
        await expect(host.registry.get(testCase.key)).resolves.toBeUndefined()
      }
      expect(createdSessions).toBe(0)
    } finally {
      host.close()
      await app.close()
    }
  })

  it('reconciles session bindings from the registry before the host can rearm', async () => {
    const stateRoot = await mkdtemp(resolve(tmpdir(), 'factory-reconcile-state-'))
    const intakeRepository = await mkdtemp(resolve(tmpdir(), 'factory-reconcile-repository-'))
    temporaryRoots.push(stateRoot, intakeRepository)
    await execFileAsync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: intakeRepository })
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: intakeRepository })
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: intakeRepository })
    await writeFile(resolve(intakeRepository, 'tracked.txt'), 'tracked')
    await execFileAsync('git', ['add', '.'], { cwd: intakeRepository })
    await execFileAsync('git', ['commit', '--quiet', '-m', 'initial'], { cwd: intakeRepository })
    await mkdir(resolve(intakeRepository, '.worktrees'), { recursive: true })

    async function addWorktree(key: string): Promise<string> {
      const worktree = resolve(intakeRepository, '.worktrees', key)
      await execFileAsync('git', ['worktree', 'add', '-q', '-b', `epic/${key}`, worktree, 'HEAD'], { cwd: intakeRepository })
      return worktree
    }

    const activeWorktree = await addWorktree('active')
    const closedWorktree = await addWorktree('closed')
    const orphanWorktree = await addWorktree('orphan')
    const createdAt = '2026-09-05T00:00:00.000Z'
    await writeFile(resolve(stateRoot, 'epics.json'), JSON.stringify({ epics: {
      active: {
        epicKey: 'active', featureName: 'Active', repositoryRoot: intakeRepository, worktree: activeWorktree,
        branch: 'epic/active', orchestratorSessionId: 'orch-active', createdAt, status: 'active',
      },
      closed: {
        epicKey: 'closed', featureName: 'Closed', repositoryRoot: intakeRepository, worktree: closedWorktree,
        branch: 'epic/closed', orchestratorSessionId: 'orch-closed', createdAt, status: 'closed',
      },
      orphan: {
        epicKey: 'orphan', featureName: 'Orphan', repositoryRoot: intakeRepository, worktree: orphanWorktree,
        branch: 'epic/orphan', createdAt, status: 'active',
      },
    } }))
    await writeFile(resolve(stateRoot, 'session-bindings.json'), JSON.stringify({ bindings: {
      'orch-active': 'missing',
      'worker-active': 'active',
      'orch-closed': 'closed',
      stale: 'missing',
    } }))

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const host = await createFactoryHost({ repositoryRoot, workspaceRoot: intakeRepository, stateRoot, env: {}, provider: 'local-simulation' })
    try {
      await expect(host.sessionBindings.load()).resolves.toEqual({ 'worker-active': 'active', 'orch-active': 'active' })
      expect(errorSpy.mock.calls.flat().join('\n')).toContain('dropped orphan session binding')
      expect(errorSpy.mock.calls.flat().join('\n')).toContain('active epic orphan is orphaned')
    } finally {
      host.close()
      errorSpy.mockRestore()
    }
  })
})

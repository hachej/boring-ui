import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, resolve } from 'node:path'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import { createNodeWorkspace } from '@hachej/boring-sandbox/providers/node-workspace'
import { createAskUserServerPlugin, FileAskUserStore } from '@hachej/boring-ask-user/server'
import type { AskUserQuestion } from '@hachej/boring-ask-user/shared'
import { createWorkspaceAgentServer } from '@hachej/boring-workspace/app/server'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { createWorkspaceBeadsOperations } from '@hachej/boring-tasks/server'
import { createFactorySandboxPlugin, getFactorySandboxSnapshotInfo, warmUpFactorySandboxSnapshot } from '../sandbox'
import { loadNativeFactoryFleet, deriveFeatureName, FACTORY_ORCHESTRATOR_AGENT_TYPE_ID } from './factoryFleet'
import { createFactoryDelegatePlugin } from './delegatePlugin'
import { createFactorySupervisionPlugin } from './supervisionPlugin'
import { createFactoryDemoPlugin } from './demoPlugin'
import { executeCloseEpic } from './epicClosure'
import { createFactoryEpicRegistry, FactoryEpicRegistryError, validateFactoryEpicEntry, type FactoryEpicEntry, type FactoryEpicModels, type FactoryEpicRegistry } from './epicRegistry'
import { createFactorySessionBindings, FactoryEpicResolutionError, FactorySessionBindingError, resolveFactoryEpic, type FactorySessionBindings } from './sessionBindings'
import { buildEpicKickoffPrompt } from './epicKickoff'

const execFileAsync = promisify(execFile)
const FACTORY_WORKSPACE_SCOPE_ID = 'factory-hub'
const EPIC_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export interface CreateFactoryHostOptions {
  readonly repositoryRoot: string
  readonly workspaceRoot: string
  readonly stateRoot: string
  readonly env?: NodeJS.ProcessEnv
  readonly models?: FactoryEpicModels
  readonly provider?: string
  readonly appRoot?: string
  readonly logger?: boolean
  /** Backwards-compatible one-shot intake, never a host identity. */
  readonly epicKey?: string
  readonly featureName?: string
}

export interface FactoryHostHandle {
  readonly agents: Awaited<ReturnType<typeof loadNativeFactoryFleet>>
  readonly plugins: readonly unknown[]
  readonly registry: FactoryEpicRegistry
  readonly sessionBindings: FactorySessionBindings
  bind(app: FastifyInstance): void
  rearm(): Promise<void>
  close(): void
}

export interface FactoryEpicLiveEntry extends FactoryEpicEntry {
  readonly orchestratorStatus: string | null
  readonly pendingQuestion: { readonly questionId: string; readonly title?: string } | null
  readonly beads: { readonly open: number; readonly closed: number }
  readonly headSha: string | null
  readonly sandboxSnapshot?: Awaited<ReturnType<typeof getFactorySandboxSnapshotInfo>>
}

interface IntakeBody {
  readonly epicKey: string
  readonly featureName: string
  readonly worktree?: string
  readonly branch?: string
  readonly requestFile?: string
  readonly models?: FactoryEpicModels
  readonly start?: boolean
}

interface FactoryEpicIntakeResult extends FactoryEpicEntry {
  readonly kickoff: {
    readonly status: 'not-requested' | 'accepted' | 'failed'
    readonly message?: string
  }
}

interface LegacyPendingGateImport {
  readonly question: AskUserQuestion
}

export function deriveFactoryWorkspaceScopeId(_epicKey?: string): string {
  return FACTORY_WORKSPACE_SCOPE_ID
}

function modelSelection(encoded: string | undefined): { provider: string; id: string } | undefined {
  const separator = encoded?.indexOf(':') ?? -1
  if (!encoded || separator <= 0 || separator === encoded.length - 1) return undefined
  return { provider: encoded.slice(0, separator), id: encoded.slice(separator + 1) }
}

async function pathIsDirectory(path: string): Promise<boolean> {
  try { return (await stat(path)).isDirectory() } catch { return false }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Factory operation failed'
}

function errorStatus(error: unknown): number {
  if (error instanceof FactorySessionBindingError) return 409
  if (error instanceof FactoryEpicRegistryError) {
    if (error.code === 'EPIC_EXISTS') return 409
    if (error.code === 'EPIC_NOT_FOUND') return 404
    return 400
  }
  if (error instanceof FactoryEpicResolutionError) return error.code === 'EPIC_NOT_FOUND' ? 404 : 400
  return error instanceof TypeError ? 400 : 500
}

function parseIntakeBody(value: unknown): IntakeBody {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('request body must be an object')
  const body = value as Record<string, unknown>
  const allowed = new Set(['epicKey', 'featureName', 'worktree', 'branch', 'requestFile', 'models', 'start'])
  const unknown = Object.keys(body).find((key) => !allowed.has(key))
  if (unknown) throw new TypeError(`unknown intake field: ${unknown}`)
  if (typeof body.epicKey !== 'string' || !body.epicKey.trim()) throw new TypeError('epicKey is required')
  if (!EPIC_KEY_PATTERN.test(body.epicKey.trim())) throw new TypeError('epicKey must be a lowercase slug (letters, numbers, and single hyphens)')
  if (typeof body.featureName !== 'string' || !body.featureName.trim()) throw new TypeError('featureName is required')
  for (const field of ['worktree', 'branch', 'requestFile'] as const) {
    if (body[field] !== undefined && (typeof body[field] !== 'string' || !body[field].trim())) {
      throw new TypeError(`${field} must be a non-empty string when provided`)
    }
  }
  if (body.start !== undefined && typeof body.start !== 'boolean') throw new TypeError('start must be a boolean when provided')
  let models: FactoryEpicModels | undefined
  if (body.models !== undefined) {
    if (!body.models || typeof body.models !== 'object' || Array.isArray(body.models)) throw new TypeError('models must be an object')
    const rawModels = body.models as Record<string, unknown>
    const unknownModel = Object.keys(rawModels).find((key) => !['orchestrator', 'worker', 'reviewer'].includes(key))
    if (unknownModel) throw new TypeError(`unknown model seat: ${unknownModel}`)
    for (const [seat, model] of Object.entries(rawModels)) {
      if (typeof model !== 'string' || !model.trim()) throw new TypeError(`models.${seat} must be a non-empty string`)
    }
    models = rawModels as FactoryEpicModels
  }
  return {
    epicKey: body.epicKey.trim(),
    featureName: body.featureName.trim(),
    ...(typeof body.worktree === 'string' ? { worktree: body.worktree.trim() } : {}),
    ...(typeof body.branch === 'string' ? { branch: body.branch.trim() } : {}),
    ...(typeof body.requestFile === 'string' ? { requestFile: body.requestFile.trim() } : {}),
    ...(models ? { models } : {}),
    ...(typeof body.start === 'boolean' ? { start: body.start } : {}),
  }
}

async function gitOutput(cwd: string, args: readonly string[]): Promise<string> {
  return (await execFileAsync('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 })).stdout.trim()
}

async function ensureEpicWorktree(repositoryRoot: string, input: IntakeBody): Promise<{ worktree: string; branch: string }> {
  const branch = input.branch ?? `epic/${input.epicKey}`
  const worktree = input.worktree
    ? resolve(repositoryRoot, input.worktree)
    : resolve(repositoryRoot, '.worktrees', `epic-${input.epicKey}`)
  if (!(await pathIsDirectory(worktree))) {
    await mkdir(resolve(worktree, '..'), { recursive: true })
    try {
      await execFileAsync('git', ['worktree', 'add', '-b', branch, worktree, 'origin/main'], { cwd: repositoryRoot })
    } catch (error) {
      const stderr = String((error as { stderr?: unknown }).stderr ?? '')
      if (!/already exists/i.test(stderr)) throw error
      await execFileAsync('git', ['worktree', 'add', worktree, branch], { cwd: repositoryRoot })
    }
  }
  return { worktree, branch }
}

async function createOrchestratorSession(app: FastifyInstance, entry: FactoryEpicEntry): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/agents/${FACTORY_ORCHESTRATOR_AGENT_TYPE_ID}/sessions`,
    headers: { 'x-boring-workspace-id': FACTORY_WORKSPACE_SCOPE_ID },
    payload: { requestId: randomUUID(), title: `[${entry.featureName}] Orchestrator` },
  })
  if (response.statusCode !== 201) throw new Error(`failed to create Orchestrator session: HTTP ${response.statusCode}`)
  return response.json<{ sessionId: string }>().sessionId
}

async function promptOrchestrator(app: FastifyInstance, entry: FactoryEpicEntry, requestText?: string): Promise<void> {
  const sessionId = entry.orchestratorSessionId
  if (!sessionId) throw new Error(`epic ${entry.epicKey} has no Orchestrator session`)
  const selectedModel = modelSelection(entry.models?.orchestrator)
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/agents/${FACTORY_ORCHESTRATOR_AGENT_TYPE_ID}/sessions/${sessionId}/prompt`,
    headers: { 'x-boring-workspace-id': FACTORY_WORKSPACE_SCOPE_ID },
    payload: {
      requestId: randomUUID(),
      clientNonce: randomUUID(),
      content: buildEpicKickoffPrompt(entry, requestText),
      requireIdle: true,
      ...(selectedModel ? { model: selectedModel } : {}),
    },
  })
  if (response.statusCode !== 202) throw new Error(`failed to start Orchestrator session: HTTP ${response.statusCode}`)
}

function sessionNamespaceDirectory(sessionRoot: string): string {
  const scopeHash = createHash('sha256').update(FACTORY_WORKSPACE_SCOPE_ID).digest('hex').slice(0, 20)
  return resolve(sessionRoot, `${FACTORY_ORCHESTRATOR_AGENT_TYPE_ID}--${scopeHash}`)
}

async function findTranscript(root: string, sessionId: string): Promise<string | undefined> {
  let entries
  try { entries = await readdir(root, { withFileTypes: true }) } catch { return undefined }
  for (const entry of entries) {
    const path = resolve(root, entry.name)
    if (entry.isDirectory()) {
      const nested = await findTranscript(path, sessionId)
      if (nested) return nested
    } else if (entry.isFile() && (entry.name === `${sessionId}.jsonl` || entry.name.endsWith(`_${sessionId}.jsonl`))) {
      return path
    }
  }
  return undefined
}

/** Copy a legacy per-epic native transcript into the shared hub namespace. The source is preserved. */
async function importLegacyOrchestratorSession(
  stateRoot: string,
  sessionRoot: string | undefined,
  epicKey: string,
  sessionId: string,
  transcriptPath?: string,
): Promise<boolean> {
  // Pi's default session root when BORING_AGENT_SESSION_ROOT is unset.
  const effectiveSessionRoot = sessionRoot ?? resolve(homedir(), '.pi/agent/sessions')
  let source: string | undefined
  if (transcriptPath) {
    if (!isAbsolute(transcriptPath) || !transcriptPath.endsWith('.jsonl')) throw new TypeError('transcriptPath must be an absolute .jsonl path')
    if (basename(transcriptPath) !== `${sessionId}.jsonl` && !basename(transcriptPath).endsWith(`_${sessionId}.jsonl`)) {
      throw new TypeError(`transcriptPath does not name session ${sessionId}`)
    }
    source = transcriptPath
  } else {
    source = await findTranscript(resolve(stateRoot, 'epics', epicKey, 'sessions'), sessionId)
  }
  if (!source) return false
  const content = await readFile(source, 'utf8')
  const lines = content.split('\n')
  const parsed = lines.filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>)
  if (parsed.some((entry) => entry.type === 'pi_session_file')) {
    throw new Error(`legacy Orchestrator session ${sessionId} is a linked transcript and cannot be imported safely`)
  }
  const headerIndex = parsed.findIndex((entry) => entry.type === 'session')
  const header = parsed[headerIndex]
  if (!header || header.id !== sessionId) throw new Error(`legacy Orchestrator transcript does not belong to session ${sessionId}`)
  header.boringSessionCtx = { workspaceId: FACTORY_WORKSPACE_SCOPE_ID }
  let parsedIndex = 0
  const migrated = lines.map((line) => line ? JSON.stringify(parsed[parsedIndex++]) : '').join('\n')
  const destinationRoot = sessionNamespaceDirectory(resolve(effectiveSessionRoot))
  await mkdir(destinationRoot, { recursive: true })
  const existingDestination = await findTranscript(destinationRoot, sessionId)
  if (existingDestination) {
    const existing = await readFile(existingDestination, 'utf8')
    if (existing !== migrated) throw new Error(`hub session transcript already exists with different content for ${sessionId}`)
    return true
  }
  const destination = resolve(destinationRoot, basename(source))
  const temporary = `${destination}.${randomUUID()}.tmp`
  await writeFile(temporary, migrated, 'utf8')
  await rename(temporary, destination)
  return true
}

async function prepareLegacyPendingGateImport(
  worktree: string,
  sessionId: string,
  hubStore: FileAskUserStore,
): Promise<LegacyPendingGateImport | undefined> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(resolve(worktree, '.boring', 'ask-user.json'), 'utf8'))
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return undefined
    throw error
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
  const state = parsed as { pendingBySession?: unknown; questions?: unknown }
  if (!state.pendingBySession || typeof state.pendingBySession !== 'object' || Array.isArray(state.pendingBySession)) return undefined
  if (!state.questions || typeof state.questions !== 'object' || Array.isArray(state.questions)) return undefined
  const questionId = (state.pendingBySession as Record<string, unknown>)[sessionId]
  if (typeof questionId !== 'string') return undefined
  const rawQuestion = (state.questions as Record<string, unknown>)[questionId]
  if (!rawQuestion || typeof rawQuestion !== 'object' || Array.isArray(rawQuestion)) {
    throw new Error(`legacy pending question ${questionId} for session ${sessionId} is missing`)
  }
  const question = rawQuestion as Partial<AskUserQuestion>
  if (
    question.questionId !== questionId
    || question.sessionId !== sessionId
    || question.status !== 'ready'
    || typeof question.ownerPrincipalId !== 'string'
    || typeof question.answerToken !== 'string'
    || typeof question.createdAt !== 'string'
    || typeof question.updatedAt !== 'string'
    || !Array.isArray(question.artifacts)
  ) {
    throw new Error(`legacy pending question ${questionId} for session ${sessionId} is invalid`)
  }
  const existingPending = await hubStore.getPending(sessionId)
  if (existingPending && existingPending.questionId !== questionId) {
    throw new Error(`hub Inbox already has pending question ${existingPending.questionId} for session ${sessionId}`)
  }
  const existingQuestion = await hubStore.getByQuestionId(questionId)
  if (existingQuestion && existingQuestion.sessionId !== sessionId) {
    throw new Error(`hub Inbox question ${questionId} belongs to another session`)
  }
  if (existingPending || existingQuestion) return undefined
  return { question: question as AskUserQuestion }
}

async function readPendingQuestions(app: FastifyInstance): Promise<Map<string, { questionId: string; title?: string }>> {
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workspace-bridge/call',
      headers: { 'content-type': 'application/json', 'x-csrf-token': 'factory-hub', 'x-boring-workspace-id': FACTORY_WORKSPACE_SCOPE_ID },
      payload: { op: 'ask-user.v1.pending-all', input: {} },
    })
    if (response.statusCode !== 200) return new Map()
    const body = response.json<{ output?: { pending?: Array<{ sessionId: string; questionId: string; title?: string }> } }>()
    return new Map((body.output?.pending ?? []).map((question) => [question.sessionId, {
      questionId: question.questionId,
      ...(question.title ? { title: question.title } : {}),
    }]))
  } catch {
    return new Map()
  }
}

async function liveEpicEntry(app: FastifyInstance, entry: FactoryEpicEntry, pendingBySession: ReadonlyMap<string, { questionId: string; title?: string }>, stateRoot: string, env: NodeJS.ProcessEnv): Promise<FactoryEpicLiveEntry> {
  const [headSha, beads, orchestratorStatus, sandboxSnapshot] = await Promise.all([
    gitOutput(entry.worktree, ['rev-parse', 'HEAD']).catch(() => null),
    execFileAsync('br', ['list', '--all', '--label', `epic:${entry.epicKey}`, '--json', '--no-auto-flush'], { cwd: entry.worktree, maxBuffer: 16 * 1024 * 1024 }).then(({ stdout }) => {
      const parsed = JSON.parse(stdout) as unknown
      const issues = Array.isArray(parsed) ? parsed : (parsed as { issues?: unknown[] })?.issues ?? []
      return issues.reduce((counts, issue) => {
        if ((issue as { status?: string }).status === 'closed') counts.closed += 1
        else counts.open += 1
        return counts
      }, { open: 0, closed: 0 })
    }).catch(() => ({ open: 0, closed: 0 })),
    entry.orchestratorSessionId
      ? app.inject({ method: 'GET', url: `/api/v1/agents/${FACTORY_ORCHESTRATOR_AGENT_TYPE_ID}/sessions/${entry.orchestratorSessionId}/state`, headers: { 'x-boring-workspace-id': FACTORY_WORKSPACE_SCOPE_ID } })
          .then((response) => response.statusCode === 200 ? response.json<{ state?: { status?: string } }>().state?.status ?? null : null).catch(() => null)
      : Promise.resolve(null),
    getFactorySandboxSnapshotInfo({ stateRoot, epicKey: entry.epicKey, env }).catch(() => undefined),
  ])
  return {
    ...entry,
    orchestratorStatus,
    pendingQuestion: entry.orchestratorSessionId ? pendingBySession.get(entry.orchestratorSessionId) ?? null : null,
    beads,
    headSha,
    ...(sandboxSnapshot ? { sandboxSnapshot } : {}),
  }
}

export async function createFactoryHost(options: CreateFactoryHostOptions): Promise<FactoryHostHandle> {
  const env = options.env ?? process.env
  const workspaceRoot = resolve(options.workspaceRoot)
  const stateRoot = resolve(options.stateRoot)
  const workspaceScopeId = deriveFactoryWorkspaceScopeId()
  await mkdir(stateRoot, { recursive: true })
  const registry = createFactoryEpicRegistry(stateRoot)
  const sessionBindings = createFactorySessionBindings(stateRoot)
  const askUserStore = new FileAskUserStore(resolve(workspaceRoot, '.boring', 'ask-user.json'))
  const askUserPlugin = {
    ...createAskUserServerPlugin({ store: askUserStore }),
    contentDigest: `sha256:${createHash('sha256').update('factory-hub-ask-user.v1.2026-09-05').digest('hex')}`,
  }
  const adoptionTails = new Map<string, Promise<void>>()
  await Promise.all([registry.load(), sessionBindings.load()])
  const agents = await loadNativeFactoryFleet(options.repositoryRoot, {
    orchestrator: options.models?.orchestrator ?? env.BORING_FACTORY_ORCHESTRATOR_MODEL,
    worker: options.models?.worker ?? env.BORING_FACTORY_WORKER_MODEL,
    reviewer: options.models?.reviewer ?? env.BORING_FACTORY_REVIEWER_MODEL,
  })
  const beadsOperations = createWorkspaceBeadsOperations(createNodeWorkspace(workspaceRoot))
  const delegate = createFactoryDelegatePlugin({ workspaceScopeId, registry, sessionBindings })
  const supervision = createFactorySupervisionPlugin({ stateRoot, workspaceScopeId, registry, sessionBindings })
  const demo = createFactoryDemoPlugin({ stateRoot, env, workspaceScopeId, registry, sessionBindings })
  let appRef: FastifyInstance | undefined

  async function withEpicAdoptionLock<T>(epicKey: string, operation: () => Promise<T>): Promise<T> {
    const previous = adoptionTails.get(epicKey) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolveGate) => { release = resolveGate })
    const tail = previous.then(() => gate)
    adoptionTails.set(epicKey, tail)
    await previous
    try {
      return await operation()
    } finally {
      release()
      if (adoptionTails.get(epicKey) === tail) adoptionTails.delete(epicKey)
    }
  }

  const closeEpicTool = {
    name: 'close_epic',
    description: 'Close an epic after verifying the exact merged PR for its branch and worktree HEAD, then stop demos, invalidate snapshots, close child/epic Beads, stop supervision, and mark its registry entry closed. Never merges or deletes branches/worktrees.',
    parameters: {
      type: 'object',
      properties: {
        epicKey: { type: 'string', description: 'Optional explicit epic override. Normally resolved from this session binding.' },
        prNumber: { type: 'number', description: 'Exact merged GitHub PR number for this epic branch and worktree HEAD.' },
      },
      required: ['prNumber'],
      additionalProperties: false,
    },
    async execute(params: Record<string, unknown>, ctx: import('@hachej/boring-agent/shared').ToolExecContext) {
      try {
        const epic = await resolveFactoryEpic(params, ctx, registry, sessionBindings)
        return await executeCloseEpic(params, ctx, {
          workspaceRoot: epic.worktree,
          stateRoot,
          epicKey: epic.epicKey,
          featureName: epic.featureName,
          getApp: () => appRef,
          workspaceScopeId,
          demoControl: demo.control,
          supervisionControl: supervision.control,
          markRegistryClosed: async (epicKey) => await registry.markClosed(epicKey),
        })
      } catch (error) {
        const code = error instanceof FactoryEpicResolutionError ? error.code : 'EPIC_RESOLUTION_FAILED'
        const details = { code, message: errorMessage(error) }
        return { content: [{ type: 'text' as const, text: JSON.stringify(details) }], details, isError: true }
      }
    },
  }
  const sandboxPlugin = await createFactorySandboxPlugin({ stateRoot, env, workspaceScopeId, registry, sessionBindings })
  const taskPlugin = {
    dir: resolve(options.repositoryRoot, 'plugins/tasks'),
    options: { beadsOperations, config: { providers: [{ provider: 'github', repo: 'auto' }, { provider: 'beads' }] } },
    trust: 'internal' as const,
  }
  const automationPlugin = { dir: resolve(options.repositoryRoot, 'plugins/boring-automation'), trust: 'internal' as const }
  const closeEpicPlugin = {
    id: 'factory-epic-closure',
    label: 'Factory epic closure',
    contentDigest: `sha256:${createHash('sha256').update('factory-epic-closure.v2.2026-09-05').digest('hex')}`,
    agentConfigContract: { keys: [] },
    agentToolFactory({ agentTypeId }: { agentTypeId: string }) { return agentTypeId === FACTORY_ORCHESTRATOR_AGENT_TYPE_ID ? [closeEpicTool] : [] },
  }

  async function intake(input: IntakeBody): Promise<FactoryEpicIntakeResult> {
    const app = appRef
    if (!app) throw new Error('Factory intake is not bound to a running host')
    if (!EPIC_KEY_PATTERN.test(input.epicKey)) throw new TypeError('epicKey must be a lowercase slug (letters, numbers, and single hyphens)')
    const existing = await registry.get(input.epicKey)
    if (existing) {
      throw new FactoryEpicRegistryError('EPIC_EXISTS', `epic ${input.epicKey} is already registered (${existing.status})`)
    }
    const repositoryRoot = workspaceRoot
    const { worktree, branch } = await ensureEpicWorktree(repositoryRoot, input)
    const requestFile = input.requestFile ? (isAbsolute(input.requestFile) ? resolve(input.requestFile) : resolve(worktree, input.requestFile)) : undefined
    const requestText = requestFile && input.start ? await readFile(requestFile, 'utf8') : undefined
    const candidate = await validateFactoryEpicEntry({
      epicKey: input.epicKey,
      featureName: input.featureName,
      worktree,
      branch,
      repositoryRoot,
      ...(requestFile ? { requestFile } : {}),
      ...(input.models ? { models: input.models } : {}),
      createdAt: new Date().toISOString(),
      status: 'active',
    })
    const sessionId = await createOrchestratorSession(app, candidate)
    await sessionBindings.bind(sessionId, candidate.epicKey)
    let entry: FactoryEpicEntry
    try {
      entry = await registry.register({ ...candidate, orchestratorSessionId: sessionId })
    } catch (error) {
      await sessionBindings.unbind(sessionId)
      throw error
    }
    let kickoff: FactoryEpicIntakeResult['kickoff'] = { status: 'not-requested' }
    if (input.start) {
      try {
        await promptOrchestrator(app, entry, requestText)
        kickoff = { status: 'accepted' }
      } catch (error) {
        kickoff = { status: 'failed', message: errorMessage(error) }
      }
    }
    void warmUpFactorySandboxSnapshot({ workspaceRoot: entry.worktree, stateRoot, epicKey: entry.epicKey, env }).catch(() => undefined)
    return { ...entry, kickoff }
  }

  function sendError(reply: FastifyReply, error: unknown) {
    return reply.code(errorStatus(error)).send({ code: (error as { code?: string }).code ?? 'FACTORY_ERROR', message: errorMessage(error) })
  }

  return {
    agents,
    registry,
    sessionBindings,
    plugins: [askUserPlugin, supervision.plugin, demo.plugin, sandboxPlugin, delegate.plugin, closeEpicPlugin, taskPlugin, automationPlugin],
    bind(app) {
      appRef = app
      delegate.bind(app)
      supervision.bind(app)
      app.post('/api/v1/factory/epics', async (request, reply) => {
        try { return reply.code(201).send(await intake(parseIntakeBody(request.body))) } catch (error) { return sendError(reply, error) }
      })
      app.get('/api/v1/factory/epics', async (_request, reply) => {
        try {
          const pending = await readPendingQuestions(app)
          return await Promise.all((await registry.list()).map(async (entry) => await liveEpicEntry(app, entry, pending, stateRoot, env)))
        } catch (error) { return sendError(reply, error) }
      })
      app.post('/api/v1/factory/epics/:key/adopt', async (request, reply) => {
        try {
          const key = (request.params as { key?: unknown }).key
          const sessionId = (request.body as { orchestratorSessionId?: unknown } | undefined)?.orchestratorSessionId
          const transcriptPath = (request.body as { transcriptPath?: unknown } | undefined)?.transcriptPath
          if (transcriptPath !== undefined && typeof transcriptPath !== 'string') throw new TypeError('transcriptPath must be a string')
          if (typeof key !== 'string' || !key.trim()) throw new TypeError('epic key is required')
          if (typeof sessionId !== 'string' || !sessionId.trim()) throw new TypeError('orchestratorSessionId is required')
          return await withEpicAdoptionLock(key, async () => {
            const entry = await registry.get(key)
            if (!entry) throw new FactoryEpicRegistryError('EPIC_NOT_FOUND', `epic ${key} is not registered`)
            const boundEpic = await sessionBindings.get(sessionId)
            const registryOwner = (await registry.list()).find((candidate) => candidate.epicKey !== key && candidate.orchestratorSessionId === sessionId)
            if ((boundEpic && boundEpic !== key) || registryOwner) {
              throw new FactorySessionBindingError(sessionId, boundEpic ?? registryOwner!.epicKey)
            }
            let stateResponse = await app.inject({ method: 'GET', url: `/api/v1/agents/${FACTORY_ORCHESTRATOR_AGENT_TYPE_ID}/sessions/${sessionId}/state`, headers: { 'x-boring-workspace-id': workspaceScopeId } })
            if (stateResponse.statusCode === 404 && await importLegacyOrchestratorSession(stateRoot, env.BORING_AGENT_SESSION_ROOT, key, sessionId, transcriptPath)) {
              stateResponse = await app.inject({ method: 'GET', url: `/api/v1/agents/${FACTORY_ORCHESTRATOR_AGENT_TYPE_ID}/sessions/${sessionId}/state`, headers: { 'x-boring-workspace-id': workspaceScopeId } })
            }
            if (stateResponse.statusCode !== 200) return reply.code(404).send({ code: 'SESSION_NOT_FOUND', message: `Orchestrator session ${sessionId} was not found` })
            const pendingGate = await prepareLegacyPendingGateImport(entry.worktree, sessionId, askUserStore)
            await sessionBindings.bind(sessionId, key)
            let adopted: FactoryEpicEntry
            try {
              adopted = await registry.setOrchestratorSession(key, sessionId)
            } catch (error) {
              await sessionBindings.unbind(sessionId)
              if (entry.orchestratorSessionId) await sessionBindings.bind(entry.orchestratorSessionId, key)
              throw error
            }
            if (entry.orchestratorSessionId && entry.orchestratorSessionId !== sessionId) await sessionBindings.unbind(entry.orchestratorSessionId)
            if (pendingGate) await askUserStore.createPending(pendingGate.question)
            return adopted
          })
        } catch (error) { return sendError(reply, error) }
      })
      app.post('/api/v1/factory/epics/:key/close', async (request, reply) => {
        try {
          const key = (request.params as { key?: unknown }).key
          if (typeof key !== 'string' || !key.trim()) throw new TypeError('epic key is required')
          return await registry.markClosed(key)
        } catch (error) { return sendError(reply, error) }
      })
      app.get('/api/v1/workspace/meta', async () => ({
        projectName: 'Boring Factory',
        workspaceId: workspaceScopeId,
        workspaceRoot,
        workspaceLabel: basename(workspaceRoot),
        epics: await registry.list(),
        defaultAgentTypeId: FACTORY_ORCHESTRATOR_AGENT_TYPE_ID,
        agentTypeIds: agents.map((agent) => agent.agentTypeId),
        sandboxProvider: (options.provider ?? env.BORING_FACTORY_SANDBOX_PROVIDER) === 'vercel' ? 'vercel' : 'local-simulation',
      }))
    },
    async rearm() {
      if (options.epicKey && !(await registry.get(options.epicKey))) {
        console.error(`[factory-hub] BORING_FACTORY_EPIC_KEY is a backwards-compatible one-shot intake for epic ${options.epicKey}`)
        const oneShotModels = Object.fromEntries(
          Object.entries(options.models ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0),
        ) as FactoryEpicModels
        const result = await intake({
          epicKey: options.epicKey,
          featureName: options.featureName ?? deriveFeatureName(options.epicKey, env),
          ...(Object.keys(oneShotModels).length > 0 ? { models: oneShotModels } : {}),
          start: true,
        })
        if (result.kickoff.status === 'failed') {
          console.error(`[factory-hub] one-shot intake registered epic ${result.epicKey}, but kickoff was not accepted: ${result.kickoff.message}`)
        }
      }
      await supervision.rearm()
      await demo.rearm()
      for (const entry of (await registry.list()).filter((candidate) => candidate.status === 'active')) {
        void warmUpFactorySandboxSnapshot({ workspaceRoot: entry.worktree, stateRoot, epicKey: entry.epicKey, env })
      }
    },
    close() { supervision.close(); demo.close() },
  }
}

export async function createFactoryHostedApp(options: CreateFactoryHostOptions): Promise<FastifyInstance> {
  const env = options.env ?? process.env
  const workspaceRoot = resolve(options.workspaceRoot)
  const host = await createFactoryHost(options)
  const app = await createWorkspaceAgentServer({
    workspaceRoot,
    appRoot: options.appRoot ?? options.repositoryRoot,
    sessionId: deriveFactoryWorkspaceScopeId(),
    sessionRoot: env.BORING_AGENT_SESSION_ROOT,
    requestLedgerPath: resolve(options.stateRoot, 'request-ledger.sqlite'),
    mode: 'direct',
    logger: options.logger ?? true,
    readonlyWorkspacePaths: ['.agents'],
    agents: host.agents,
    defaultAgentTypeId: FACTORY_ORCHESTRATOR_AGENT_TYPE_ID,
    externalPlugins: false,
    pi: { noContextFiles: true, noExtensions: true, noAmbientPackages: true, noSkills: true },
    workspaceScopedDefaultPluginAgentContributions: true,
    plugins: host.plugins as never,
    defaultPluginPackages: [],
    workspaceBridge: { allowInsecureLocalCliBrowserAuth: true },
  })
  host.bind(app)
  await host.rearm()
  return app
}

import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { defineServerPlugin } from '@hachej/boring-workspace/server'
import type { AgentTool, ToolExecContext, ToolResult } from '@hachej/boring-agent/shared'
import {
  buildFetchBootstrapFiles,
  FACTORY_BOOTSTRAP_SCRIPT,
  resolveEpicSnapshot,
} from '../sandbox'

export const FACTORY_DEMO_PLUGIN_ID = 'factory-demo'

/** Bump when this file's demo behavior changes; hashed into the plugin's contentDigest. */
const DEMO_PLUGIN_VERSION = 'factory-demo.v1.2026-09-03'

/** The only seat allowed to open a live demo: the owner-facing seat that raises Gate 2. */
const DEMO_AGENT_TYPE_ID = 'factory-orchestrator'

const DEFAULT_TTL_MINUTES = 40
/** Vercel hobby-plan sandbox lifetime cap. Real hard cap is host-configurable via `BORING_FACTORY_DEMO_MAX_MINUTES`. */
const HOBBY_TTL_CAP_MINUTES = 45
const MIN_PORT = 1024
const MAX_PORT = 65535
const READY_POLL_TIMEOUT_MS = 120_000
const READY_POLL_INTERVAL_MS = 2_000

const execFileAsync = promisify(execFile)

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function jsonResult(details: unknown, isError = false): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(details) }], details, isError }
}

function invalidInputResult(message: string): ToolResult {
  return jsonResult({ code: 'INVALID_INPUT', message }, true)
}

function providerNotConfiguredResult(): ToolResult {
  return jsonResult({ code: 'PROVIDER_NOT_CONFIGURED', message: 'demo_sandbox requires the vercel provider' }, true)
}

/**
 * Minimal shape this plugin needs from a live `@vercel/sandbox` `Sandbox`
 * instance (both `Sandbox.create` and `Sandbox.get` resolve to something
 * structurally compatible with this). Kept narrow and injectable so tests
 * never touch a real sandbox.
 */
export interface DemoSandboxHandle {
  readonly name: string
  writeFiles(files: { path: string; content: string }[]): Promise<void>
  runCommand(params: {
    cmd: string
    args?: string[]
    detached?: boolean
  }): Promise<{ exitCode: number } | unknown>
  domain(port: number): string
  stop(): Promise<unknown>
}

export interface DemoSandboxCreateParams {
  readonly name: string
  readonly snapshotId: string
  readonly port: number
  readonly timeoutMs: number
  readonly teamId?: string
  readonly projectId?: string
  readonly token?: string
}

export interface DemoSandboxGetParams {
  readonly name: string
  readonly teamId?: string
  readonly projectId?: string
  readonly token?: string
}

/** Injectable sandbox factory. Defaults to the real `@vercel/sandbox` SDK; tests inject a fake. */
export interface DemoSandboxFactory {
  create(params: DemoSandboxCreateParams): Promise<DemoSandboxHandle>
  get(params: DemoSandboxGetParams): Promise<DemoSandboxHandle>
}

interface VercelCredentials {
  readonly token?: string
  readonly teamId?: string
  readonly projectId?: string
}

function resolveVercelCredentials(env: NodeJS.ProcessEnv): VercelCredentials {
  const token = env.VERCEL_OIDC_TOKEN?.trim() || env.VERCEL_ACCESS_TOKEN?.trim() || env.VERCEL_TOKEN?.trim() || undefined
  const teamId = env.VERCEL_TEAM_ID?.trim() || undefined
  const projectId = env.VERCEL_PROJECT_ID?.trim() || undefined
  return { token, teamId, projectId }
}

async function createDefaultSandboxFactory(): Promise<DemoSandboxFactory> {
  const { Sandbox } = await import('@vercel/sandbox')
  return {
    async create(params) {
      const sandbox = await Sandbox.create({
        name: params.name,
        source: { type: 'snapshot', snapshotId: params.snapshotId },
        ports: [params.port],
        timeout: params.timeoutMs,
        ...(params.teamId ? { teamId: params.teamId } : {}),
        ...(params.projectId ? { projectId: params.projectId } : {}),
        ...(params.token ? { token: params.token } : {}),
      } as never)
      return sandbox as unknown as DemoSandboxHandle
    },
    async get(params) {
      const sandbox = await Sandbox.get({
        name: params.name,
        ...(params.teamId ? { teamId: params.teamId } : {}),
        ...(params.projectId ? { projectId: params.projectId } : {}),
        ...(params.token ? { token: params.token } : {}),
      } as never)
      return sandbox as unknown as DemoSandboxHandle
    },
  }
}

export interface DemoEntry {
  readonly sandboxId: string
  readonly url: string
  readonly sha: string
  readonly port: number
  readonly command: string
  readonly startedAt: string
  readonly expiresAt: string
  readonly sessionId?: string
}

interface DemoState {
  readonly demos: Record<string, DemoEntry>
}

async function readState(statePath: string): Promise<DemoState> {
  try {
    const raw = await readFile(statePath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<DemoState>
    if (parsed && typeof parsed === 'object' && parsed.demos && typeof parsed.demos === 'object') {
      return { demos: { ...parsed.demos } }
    }
  } catch {
    // Missing or corrupt state file: start from an empty demo table.
  }
  return { demos: {} }
}

async function writeStateAtomic(statePath: string, state: DemoState): Promise<void> {
  const tmpPath = `${statePath}.tmp-${randomUUID()}`
  await writeFile(tmpPath, JSON.stringify(state, null, 2), 'utf8')
  await rename(tmpPath, statePath)
}

export interface CreateFactoryDemoPluginOptions {
  /** Directory holding `demos.json`. Created if missing. */
  readonly stateRoot: string
  /** Shared epic worktree root; default `sha` and bootstrap files come from here. */
  readonly workspaceRoot: string
  /** Epic label this Factory instance is bound to (unused today; kept for parity/future filtering). */
  readonly epicKey: string
  /** Host-owned workspace identity paired with this epic. */
  readonly workspaceScopeId: string
  readonly env: NodeJS.ProcessEnv
  /** Injected for tests. Defaults to the real `@vercel/sandbox` SDK. */
  readonly sandboxFactory?: DemoSandboxFactory
  /** Injected for tests. Defaults to global `fetch`. */
  readonly fetchImpl?: typeof fetch
}

export interface FactoryDemoPluginControl {
  listDemos(): Promise<Record<string, DemoEntry>>
  stopDemo(id: string): Promise<'stopped' | 'already-stopped'>
  listDemosForSession(sessionId: string): Promise<Record<string, DemoEntry>>
}

export interface FactoryDemoPluginHandle {
  readonly plugin: ReturnType<typeof defineServerPlugin>
  /** Best-effort cleanup of persisted entries already past `expiresAt`. Returns the count removed. */
  rearm(): Promise<number>
  /** Host-only control surface for epic closure. */
  readonly control: FactoryDemoPluginControl
  /** No recurring timers are owned by this plugin; provided for symmetry with the other host plugins. */
  close(): void
}

function isProviderConfigured(env: NodeJS.ProcessEnv): boolean {
  if (env.BORING_FACTORY_SANDBOX_PROVIDER !== 'vercel') return false
  if (env.BORING_FACTORY_VERCEL_SNAPSHOT_ID?.trim()) return true
  // No fixed snapshot id: the per-epic registry can still resolve one, as
  // long as credentials are present to build it if it's not cached yet.
  const credentials = resolveVercelCredentials(env)
  return Boolean(credentials.token && credentials.teamId && credentials.projectId)
}

/**
 * Resolves the snapshot id a demo boots from: the fixed
 * `BORING_FACTORY_VERCEL_SNAPSHOT_ID` when set, else the same per-epic
 * snapshot registry `sandboxComposition.ts`'s lazy provider uses (so a demo
 * always runs from a snapshot whose `baseSha` is close to the epic branch,
 * never a stale `main` snapshot).
 */
async function resolveDemoSnapshotId(
  env: NodeJS.ProcessEnv,
  workspaceRoot: string,
  stateRoot: string,
  epicKey: string,
): Promise<string> {
  const fixed = env.BORING_FACTORY_VERCEL_SNAPSHOT_ID?.trim()
  if (fixed) return fixed
  const credentials = resolveVercelCredentials(env)
  if (!credentials.token || !credentials.teamId || !credentials.projectId) {
    throw new Error('VERCEL_TOKEN/VERCEL_TEAM_ID/VERCEL_PROJECT_ID are required to build a per-epic Factory snapshot')
  }
  const resolved = await resolveEpicSnapshot({
    epicKey,
    workspaceRoot,
    stateRoot,
    auth: { token: credentials.token, teamId: credentials.teamId, projectId: credentials.projectId },
  })
  return resolved.snapshotId
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

async function gitRevParseHead(workspaceRoot: string): Promise<string> {
  return (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: workspaceRoot })).stdout.trim()
}

function parseOp(value: unknown): 'start' | 'stop' | 'status' | 'list' | undefined {
  return value === 'start' || value === 'stop' || value === 'status' || value === 'list' ? value : undefined
}

async function pollReady(
  url: string,
  readyPath: string,
  fetchImpl: typeof fetch,
): Promise<{ ready: boolean; lastStatus?: number }> {
  const deadline = Date.now() + READY_POLL_TIMEOUT_MS
  let lastStatus: number | undefined
  const target = `${url}${readyPath.startsWith('/') ? readyPath : `/${readyPath}`}`
  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(target, { method: 'GET' })
      lastStatus = response.status
      if (response.status < 500) return { ready: true, lastStatus }
    } catch {
      // Connection refused / not up yet: keep polling until the deadline.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, READY_POLL_INTERVAL_MS))
  }
  return { ready: false, ...(lastStatus !== undefined ? { lastStatus } : {}) }
}

export function createFactoryDemoPlugin(options: CreateFactoryDemoPluginOptions): FactoryDemoPluginHandle {
  if (!options.stateRoot.trim()) throw new TypeError('factory-demo stateRoot is required')
  if (!options.workspaceRoot.trim()) throw new TypeError('factory-demo workspaceRoot is required')
  if (!options.epicKey.trim()) throw new TypeError('factory-demo epicKey is required')

  const stateRoot = options.stateRoot
  const workspaceRoot = options.workspaceRoot
  const epicKey = options.epicKey
  const env = options.env
  const statePath = resolve(stateRoot, 'demos.json')
  const fetchImpl = options.fetchImpl ?? fetch
  let sandboxFactoryPromise: Promise<DemoSandboxFactory> | undefined
  const getSandboxFactory = (): Promise<DemoSandboxFactory> => {
    if (options.sandboxFactory) return Promise.resolve(options.sandboxFactory)
    if (!sandboxFactoryPromise) sandboxFactoryPromise = createDefaultSandboxFactory()
    return sandboxFactoryPromise
  }

  async function mutateState(mutator: (current: DemoState) => DemoState): Promise<DemoState> {
    await mkdir(stateRoot, { recursive: true })
    const current = await readState(statePath)
    const next = mutator(current)
    await writeStateAtomic(statePath, next)
    return next
  }

  async function rearm(): Promise<number> {
    const state = await readState(statePath)
    const now = Date.now()
    const expired = Object.entries(state.demos).filter(([, entry]) => new Date(entry.expiresAt).getTime() <= now)
    if (expired.length === 0) return 0
    const credentials = resolveVercelCredentials(env)
    if (isProviderConfigured(env)) {
      const factory = await getSandboxFactory()
      await Promise.all(expired.map(async ([, entry]) => {
        try {
          const sandbox = await factory.get({ name: entry.sandboxId, ...credentials })
          await sandbox.stop()
        } catch {
          // Best-effort: the sandbox may already be gone (Vercel's own timeout fired first).
        }
      }))
    }
    await mutateState((currentState) => {
      const rest = { ...currentState.demos }
      for (const [id] of expired) delete rest[id]
      return { demos: rest }
    })
    return expired.length
  }

  async function stopDemo(id: string): Promise<'stopped' | 'already-stopped'> {
    const state = await readState(statePath)
    const entry = state.demos[id]
    if (!entry) return 'already-stopped'
    if (isProviderConfigured(env)) {
      const credentials = resolveVercelCredentials(env)
      const factory = await getSandboxFactory()
      try {
        const sandbox = await factory.get({ name: entry.sandboxId, ...credentials })
        await sandbox.stop()
      } catch (error) {
        const message = error instanceof Error ? error.message : 'failed to stop sandbox'
        if (!/not found|no fake sandbox named/i.test(message)) throw error
      }
    }
    await mutateState((current) => {
      const rest = { ...current.demos }
      delete rest[id]
      return { demos: rest }
    })
    return 'stopped'
  }

  async function listDemos(): Promise<Record<string, DemoEntry>> {
    return (await readState(statePath)).demos
  }

  async function listDemosForSession(sessionId: string): Promise<Record<string, DemoEntry>> {
    const demos = await listDemos()
    return Object.fromEntries(Object.entries(demos).filter(([, entry]) => entry.sessionId === sessionId))
  }

  function close(): void {
    // No recurring timers owned by this plugin: expiry is enforced by the sandbox provider's
    // own `timeout`, and stale entries are swept by `rearm()` on the next boot.
  }

  const demoTool: AgentTool = {
    name: 'demo_sandbox',
    description:
      'Start, stop, or check a live demo of this epic at an exact SHA, served from a Vercel sandbox and reachable ' +
      'at a public URL for the duration of its TTL (default 40 minutes, hard-capped by the host). Requires the ' +
      'vercel Factory sandbox provider. Use this only to back Gate 2 (merge approval) with a real running demo ' +
      'the owner can click through; it never affects the epic branch or git state.',
    parameters: {
      type: 'object',
      properties: {
        op: {
          type: 'string',
          enum: ['start', 'stop', 'status', 'list'],
          description: '"start" boots a demo; "stop" tears one down by id; "status"/"list" (alias) report every live demo.',
        },
        command: {
          type: 'string',
          description: 'Only used with op="start". Shell command that serves the demo (run detached, e.g. a dev server).',
        },
        port: {
          type: 'number',
          minimum: MIN_PORT,
          maximum: MAX_PORT,
          description: 'Only used with op="start". Port the command listens on; exposed as the sandbox\'s public URL.',
        },
        sha: {
          type: 'string',
          description: 'Only used with op="start". Exact commit SHA to serve. Defaults to the workspace\'s current HEAD.',
        },
        ttlMinutes: {
          type: 'number',
          description: `Only used with op="start". Demo lifetime in minutes (default ${DEFAULT_TTL_MINUTES}, capped by BORING_FACTORY_DEMO_MAX_MINUTES).`,
        },
        install: {
          type: 'string',
          description: 'Only used with op="start". Optional shell command run before `command` (e.g. installing dependencies).',
        },
        readyPath: {
          type: 'string',
          description: 'Only used with op="start". HTTP path polled for readiness after `command` starts. Default "/".',
        },
        id: {
          type: 'string',
          description: 'Only used with op="stop". The demo id returned by a prior "start".',
        },
      },
      required: ['op'],
      additionalProperties: false,
    },
    async execute(params: Record<string, unknown>, ctx: ToolExecContext): Promise<ToolResult> {
      if (!isProviderConfigured(env)) return providerNotConfiguredResult()

      const op = parseOp(params.op)
      if (!op) return invalidInputResult('op must be one of "start", "stop", "status", "list"')

      if (op === 'status' || op === 'list') {
        const state = await readState(statePath)
        const now = Date.now()
        const demos = Object.entries(state.demos).map(([id, entry]) => ({
          id,
          ...entry,
          expired: new Date(entry.expiresAt).getTime() <= now,
        }))
        return jsonResult({ demos })
      }

      if (op === 'stop') {
        const id = params.id
        if (typeof id !== 'string' || id.length === 0) return invalidInputResult('id is required for op="stop"')
        const state = await readState(statePath)
        const entry = state.demos[id]
        if (!entry) return jsonResult({ code: 'NOT_FOUND', message: `no demo with id ${id}` }, true)
        try {
          await stopDemo(id)
        } catch (error) {
          const message = error instanceof Error ? error.message : 'failed to stop sandbox'
          return jsonResult({ code: 'STOP_FAILED', message }, true)
        }
        return jsonResult({ id, stopped: true })
      }

      // op === 'start'
      const command = params.command
      if (typeof command !== 'string' || command.trim().length === 0) {
        return invalidInputResult('command must be a non-empty string')
      }
      const port = params.port
      if (typeof port !== 'number' || !Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
        return invalidInputResult(`port must be an integer between ${MIN_PORT} and ${MAX_PORT}`)
      }
      if (params.sha !== undefined && typeof params.sha !== 'string') {
        return invalidInputResult('sha must be a string when provided')
      }
      const maxTtlMinutes = positiveInteger(env.BORING_FACTORY_DEMO_MAX_MINUTES, DEFAULT_TTL_MINUTES)
      let ttlMinutes = maxTtlMinutes
      if (params.ttlMinutes !== undefined) {
        if (typeof params.ttlMinutes !== 'number' || !Number.isFinite(params.ttlMinutes) || params.ttlMinutes <= 0) {
          return invalidInputResult('ttlMinutes must be a positive number when provided')
        }
        ttlMinutes = params.ttlMinutes
      }
      if (ttlMinutes > maxTtlMinutes) {
        return invalidInputResult(`ttlMinutes must be at most ${maxTtlMinutes} (Vercel hobby cap is ${HOBBY_TTL_CAP_MINUTES} minutes)`)
      }
      if (params.install !== undefined && typeof params.install !== 'string') {
        return invalidInputResult('install must be a string when provided')
      }
      if (params.readyPath !== undefined && typeof params.readyPath !== 'string') {
        return invalidInputResult('readyPath must be a string when provided')
      }
      const readyPath = (params.readyPath as string | undefined) ?? '/'

      const sha = typeof params.sha === 'string' && params.sha.length > 0
        ? params.sha
        : await gitRevParseHead(workspaceRoot)

      let snapshotId: string
      try {
        snapshotId = await resolveDemoSnapshotId(env, workspaceRoot, stateRoot, epicKey)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'failed to resolve a Factory snapshot for this demo'
        return jsonResult({ code: 'SNAPSHOT_UNAVAILABLE', message }, true)
      }
      const credentials = resolveVercelCredentials(env)
      const id = randomUUID()
      const sandboxName = `factory-demo-${id}`
      const startedAt = new Date().toISOString()
      const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString()

      let sandbox: DemoSandboxHandle
      try {
        const factory = await getSandboxFactory()
        sandbox = await factory.create({
          name: sandboxName,
          snapshotId,
          port,
          timeoutMs: ttlMinutes * 60_000,
          ...credentials,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'failed to create sandbox'
        return jsonResult({ code: 'CREATE_FAILED', message }, true)
      }

      try {
        const files = await buildFetchBootstrapFiles(workspaceRoot, sha)
        await sandbox.writeFiles(files.map((file) => ({ path: file.path, content: file.content })))

        const bootstrapResult = await sandbox.runCommand({ cmd: 'sh', args: ['-c', FACTORY_BOOTSTRAP_SCRIPT] }) as { exitCode: number }
        if (bootstrapResult.exitCode !== 0) {
          await sandbox.stop().catch(() => {})
          return jsonResult({ code: 'BOOTSTRAP_FAILED', message: `factory-bootstrap failed: push the epic branch so ${sha} is reachable on origin` }, true)
        }

        if (typeof params.install === 'string' && params.install.trim().length > 0) {
          const installResult = await sandbox.runCommand({ cmd: 'sh', args: ['-c', params.install] }) as { exitCode: number }
          if (installResult.exitCode !== 0) {
            await sandbox.stop().catch(() => {})
            return jsonResult({ code: 'INSTALL_FAILED', message: `install command exited ${installResult.exitCode}` }, true)
          }
        }

        await sandbox.runCommand({ cmd: 'sh', args: ['-c', command], detached: true })

        const url = sandbox.domain(port)
        const { ready, lastStatus } = await pollReady(url, readyPath, fetchImpl)

        await mutateState((current) => ({
          demos: {
            ...current.demos,
            [id]: {
              sandboxId: sandboxName,
              url,
              sha,
              port,
              command,
              startedAt,
              expiresAt,
              ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
            },
          },
        }))

        return jsonResult({ id, url, sha, port, expiresAt, ready, ...(lastStatus !== undefined ? { lastStatus } : {}) })
      } catch (error) {
        await sandbox.stop().catch(() => {})
        const message = error instanceof Error ? error.message : 'failed to start demo'
        return jsonResult({ code: 'START_FAILED', message }, true)
      }
    },
  }

  const plugin = defineServerPlugin({
    id: FACTORY_DEMO_PLUGIN_ID,
    label: 'Factory demo sandboxes',
    contentDigest: sha256(DEMO_PLUGIN_VERSION),
    agentConfigContract: { keys: [] },
    agentToolFactory({ agentTypeId }) {
      if (agentTypeId !== DEMO_AGENT_TYPE_ID) return []
      return [demoTool]
    },
  })

  return { plugin, rearm, control: { listDemos, stopDemo, listDemosForSession }, close }
}

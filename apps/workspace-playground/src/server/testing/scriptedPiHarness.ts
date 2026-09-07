import { randomUUID } from 'node:crypto'
import { mkdir, appendFile, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'
import type { AgentSessionEvent } from '@mariozechner/pi-coding-agent'
import { CURRENT_SESSION_VERSION } from '@mariozechner/pi-coding-agent'
import type { AgentCoreHarnessFactory, AgentHarness, RunContext, AgentSendInput } from '@hachej/boring-agent/shared'
import type { SessionCtx, SessionDetail, SessionStore, SessionSummary } from '@hachej/boring-agent/shared'

type RequiredAgentHarnessFactoryInput = Parameters<AgentCoreHarnessFactory>[0]
type AgentHarnessFactoryInput = Omit<RequiredAgentHarnessFactoryInput, 'tools'> & {
  tools?: RequiredAgentHarnessFactoryInput['tools']
}


type ScriptedMessage = Record<string, unknown>

interface ScriptedFollowUp {
  text: string
  clientNonce?: string
  clientSeq?: number
}

interface ScriptedRun {
  cancelled: boolean
}

type ScriptedSessionRecord = SessionSummary & { workspaceId?: string }

const SESSION_ROOT_ENV = 'BORING_AGENT_SESSION_ROOT'
const DEFAULT_SESSION_ID = 'scripted-main'
const DEFAULT_TIME = '2026-06-04T12:00:00.000Z'
const DEFAULT_TICK_MS = 5
const MAX_SESSION_ID_LENGTH = 128
const SAFE_NATIVE_SESSION_ID = /^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/
interface SessionListOptions { includeId?: string; includeEmpty?: boolean }

const persistedHarnesses = new Map<string, ScriptedPiHarness>()

// Scripted session ids ('scripted-main', 'scripted-1', ...) are unique only
// WITHIN one namespaced ScriptedSessionStore — each agent type gets its own
// sessionDir and independently allocates the same short ids (gh-1458 review
// round 4: 'alpha--<hash>/scripted-main' and 'beta--<hash>/scripted-main'
// are different sessions that happen to share a bare id). Both this
// response-marker text and the showcase provenance registry key below need
// to identify "which agent type", so both derive it the same way: the
// namespace's leading segment before the first '--' is always the raw
// agentTypeId verbatim (see sessionNamespaceForAgent in
// packages/agent/src/server/agent-host/sessionInventory.ts — the namespace
// is built as `[agentTypeId, hash(workspaceScopeId), ns].join('--')` for
// every agent type this app ever configures, none of which use the
// DEFAULT_AGENT_TYPE_ID short-circuit).
export function sessionNamespaceAgentKey(sessionNamespace?: string): string {
  const agentTypeId = sessionNamespace?.split('--')[0]?.trim()
  return agentTypeId || '(unscoped)'
}

function scriptedResponseMarker(sessionNamespace?: string): string {
  const agentTypeId = sessionNamespace?.split('--')[0]?.trim()
  return agentTypeId ? `PI_NATIVE_ASSISTANT_DONE:${agentTypeId}` : 'PI_NATIVE_ASSISTANT_DONE'
}

export function createPersistedScriptedPiHarness(input: AgentHarnessFactoryInput): ScriptedPiHarness {
  const key = JSON.stringify([
    input.sessionRoot ?? '',
    input.sessionNamespace ?? '',
    input.sessionDir ?? '',
    input.cwd,
  ])
  let harness = persistedHarnesses.get(key)
  if (!harness) {
    harness = createScriptedPiHarness(input)
    persistedHarnesses.set(key, harness)
  }
  return harness
}

interface PiAgentSessionSnapshot {
  state: unknown
  messages: readonly unknown[]
  isStreaming: boolean
  isRetrying: boolean
  retryAttempt: number
  pendingMessageCount: number
  steeringMessages: readonly string[]
  followUpMessages: readonly string[]
  followUpMode: 'all' | 'one-at-a-time'
  sessionId: string
  sessionName?: string
}

type PiAgentPromptInput = string | { text: string }

interface PiAgentSessionAdapter {
  readSnapshot(): PiAgentSessionSnapshot
  subscribe(listener: (event: AgentSessionEvent) => void): () => void
  prompt(input: PiAgentPromptInput): Promise<void>
  followUp(text: string): Promise<void>
  clearFollowUp(): void
  abort(): Promise<void>
}

type ScriptedPiHarness = AgentHarness & {
  getPiSessionAdapter(input: AgentSendInput, ctx: RunContext): Promise<PiAgentSessionAdapter>
}

export function createScriptedPiHarness(input: AgentHarnessFactoryInput): ScriptedPiHarness {
  const sessions = new ScriptedSessionStore(input)
  const adapters = new Map<string, ScriptedPiSessionAdapter>()
  const tickMs = readTickMs()
  const toolDelayTicks = readToolDelayTicks()
  const reasoningPartCount = readReasoningPartCount()
  const responseMarker = scriptedResponseMarker(input.sessionNamespace)
  const capabilityToolName = input.tools?.find((tool) => tool.name.endsWith('_capability'))?.name

  const getAdapter = async (sessionId: string, sessionCtx: SessionCtx): Promise<ScriptedPiSessionAdapter> => {
    let adapter = adapters.get(sessionId)
    if (!adapter) {
      adapter = new ScriptedPiSessionAdapter(
        sessionId,
        tickMs,
        toolDelayTicks,
        reasoningPartCount,
        responseMarker,
        capabilityToolName,
        await sessions.loadMessages(sessionCtx, sessionId),
        (messages) => sessions.persistMessages(sessionCtx, sessionId, messages),
      )
      adapters.set(sessionId, adapter)
    }
    return adapter
  }

  return {
    id: 'scripted-pi-e2e',
    placement: 'server',
    sessions,
    async getPiSessionAdapter({ sessionId, ctx: sessionCtx }: AgentSendInput) {
      if (!sessionId) throw new Error('sessionId is required')
      const resolvedSessionCtx = sessionCtx ?? {}
      await sessions.ensure(sessionId, resolvedSessionCtx)
      return await getAdapter(sessionId, resolvedSessionCtx)
    },
    async reloadSession() {
      return true
    },
    getSystemPrompt() {
      return `Scripted Pi e2e harness for ${input.cwd}`
    },
  }
}

class ScriptedSessionStore implements SessionStore {
  private readonly records = new Map<string, ScriptedSessionRecord>()
  private createCount = 0
  private readonly sessionDir: string
  private readonly explicitSessionRoot: string | undefined
  private readonly provenanceAgentKey: string
  private hydration: Promise<void> | undefined

  constructor(input: AgentHarnessFactoryInput) {
    this.sessionDir = input.sessionDir ?? (input.sessionNamespace
      ? join(sessionBaseDir(input.sessionRoot), input.sessionNamespace)
      : defaultSessionDir(input.cwd, input.sessionRoot))
    this.explicitSessionRoot = input.sessionRoot
    this.provenanceAgentKey = sessionNamespaceAgentKey(input.sessionNamespace)
  }

  async ensure(sessionId: string, ctx: SessionCtx): Promise<SessionSummary> {
    await this.ensureHydrated()
    const existing = this.records.get(sessionId)
    if (existing) {
      this.assertVisible(existing, ctx, sessionId)
      return toSummary(existing)
    }
    throw new Error(`Session not found: ${sessionId}`)
  }

  async list(ctx: SessionCtx, options: SessionListOptions = {}): Promise<SessionSummary[]> {
    await this.ensureHydrated()
    return [...this.records.values()]
      .filter((record) => this.belongsTo(record, ctx))
      .filter((record) => options.includeEmpty || record.turnCount > 0 || record.id === options.includeId)
      .map(toSummary)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async create(_ctx: SessionCtx, init?: { title?: string }): Promise<SessionSummary> {
    await this.ensureHydrated()
    const id = this.takeNextSessionId()
    const record = this.createRecord(id, init?.title ?? 'Scripted baseline', _ctx.workspaceId)
    this.records.set(record.id, record)
    await this.writeSessionFile(record, _ctx)
    return toSummary(record)
  }

  async load(_ctx: SessionCtx, sessionId: string): Promise<SessionDetail> {
    await this.ensureHydrated()
    const record = this.records.get(sessionId)
    if (!record) throw new Error(`Session not found: ${sessionId}`)
    this.assertVisible(record, _ctx, sessionId)
    return toSummary(record)
  }

  async delete(_ctx: SessionCtx, sessionId: string): Promise<void> {
    await this.ensureHydrated()
    const record = this.records.get(sessionId)
    if (!record) return
    this.assertVisible(record, _ctx, sessionId)
    this.records.delete(sessionId)
    try {
      await unlink(await this.sessionFilePath(sessionId))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    // Deletion is the actual "no longer needs tracking" event for the
    // showcase provenance registry — not just a future boot's sweep. This
    // is what closes the id-reuse hole: the pagehide cleanup path deletes a
    // session through this exact method (via the ordinary DELETE route), so
    // by the time its numeric id could ever be reused by an unrelated
    // ordinary session, the registry no longer references it at all.
    await unmarkPlaygroundShowcaseSession(this.explicitSessionRoot, this.provenanceAgentKey, record.workspaceId ?? '', sessionId)
  }

  async rename(_ctx: SessionCtx, sessionId: string, title: string): Promise<SessionSummary> {
    await this.ensureHydrated()
    const record = this.records.get(sessionId)
    if (!record) throw new Error(`Session not found: ${sessionId}`)
    this.assertVisible(record, _ctx, sessionId)
    const renamed = { ...record, title, updatedAt: new Date().toISOString() }
    this.records.set(sessionId, renamed)
    await this.appendSessionInfo(renamed)
    return toSummary(renamed)
  }

  async loadMessages(ctx: SessionCtx, sessionId: string): Promise<ScriptedMessage[]> {
    await this.ensureHydrated()
    const record = this.records.get(sessionId)
    if (!record) throw new Error(`Session not found: ${sessionId}`)
    this.assertVisible(record, ctx, sessionId)
    const file = await this.sessionFilePath(sessionId)
    const entries = await readJsonl(file)
    return entries
      .filter((entry) => entry.type === 'message' && entry.message && typeof entry.message === 'object')
      .map((entry) => entry.message as ScriptedMessage)
  }

  async persistMessages(ctx: SessionCtx, sessionId: string, messages: readonly ScriptedMessage[]): Promise<void> {
    await this.ensureHydrated()
    const record = this.records.get(sessionId)
    if (!record) throw new Error(`Session not found: ${sessionId}`)
    this.assertVisible(record, ctx, sessionId)
    const file = await this.sessionFilePath(sessionId)
    const entries = await readJsonl(file)
    const metadata = entries.filter((entry) => entry.type !== 'message')
    const updatedAt = new Date().toISOString()
    const messageEntries = messages.map((message) => ({
      type: 'message',
      id: randomUUID(),
      parentId: null,
      timestamp: updatedAt,
      message,
    }))
    await writeFile(file, `${[...metadata, ...messageEntries].map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf8')
    this.records.set(sessionId, {
      ...record,
      updatedAt,
      turnCount: messages.filter((message) => message.role === 'user').length,
      nativeSessionId: sessionId,
      hasAssistantReply: messages.some((message) => message.role === 'assistant'),
    })
  }

  private async writeSessionFile(record: ScriptedSessionRecord, ctx: SessionCtx): Promise<void> {
    await mkdir(this.sessionDir, { recursive: true })
    const now = record.createdAt
    const header = {
      type: 'session',
      version: CURRENT_SESSION_VERSION,
      id: record.id,
      timestamp: now,
      cwd: '',
      boringSessionCtx: {
        ...(ctx.workspaceId ? { workspaceId: ctx.workspaceId } : {}),
      },
    }
    const info = this.sessionInfo(record, now)
    const filename = `${now.replace(/[:.]/g, '-')}_${record.id}.jsonl`
    await writeFile(join(this.sessionDir, filename), `${JSON.stringify(header)}\n${JSON.stringify(info)}\n`, 'utf8')
  }

  private ensureHydrated(): Promise<void> {
    return this.hydration ??= this.hydrate()
  }

  private async hydrate(): Promise<void> {
    await mkdir(this.sessionDir, { recursive: true })
    const names = await readdir(this.sessionDir)
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue
      const entries = await readJsonl(join(this.sessionDir, name))
      const header = entries[0]
      const id = typeof header?.id === 'string' ? header.id : undefined
      const filenameMatchesId = id
        ? name === `${id}.jsonl` || name.endsWith(`_${id}.jsonl`)
        : false
      if (header?.type !== 'session' || !id || id.length > MAX_SESSION_ID_LENGTH || !SAFE_NATIVE_SESSION_ID.test(id) || !filenameMatchesId || this.records.has(id)) continue
      const infos = entries.filter((entry) => entry.type === 'session_info')
      const latestInfo = infos.at(-1)
      const timestamps = entries.map((entry) => entry.timestamp).filter((value): value is string => typeof value === 'string')
      const createdAt = typeof header?.timestamp === 'string' ? header.timestamp : DEFAULT_TIME
      const boringSessionCtx = header.boringSessionCtx && typeof header.boringSessionCtx === 'object'
        ? header.boringSessionCtx as Record<string, unknown>
        : undefined
      if (!boringSessionCtx || typeof boringSessionCtx.workspaceId !== 'string' || !boringSessionCtx.workspaceId.trim()) continue
      this.records.set(id, {
        id,
        title: typeof latestInfo?.name === 'string' ? latestInfo.name : 'Scripted baseline',
        createdAt,
        updatedAt: timestamps.sort().at(-1) ?? createdAt,
        turnCount: entries.filter((entry) => entry.type === 'message' && (entry.message as { role?: unknown } | undefined)?.role === 'user').length,
        nativeSessionId: id,
        hasAssistantReply: entries.some((entry) => entry.type === 'message' && (entry.message as { role?: unknown } | undefined)?.role === 'assistant'),
        workspaceId: boringSessionCtx.workspaceId,
      })
    }
    this.createCount = 0
    // Boot-time retention sweep: everything just loaded above came from
    // *before* this process started (this method only ever runs once per
    // store, memoized by `ensureHydrated`/`this.hydration`), and the
    // provenance registry (below) is read before this boot ever appends to
    // it — so this only ever sweeps sessions the showcase route created on
    // a *prior* boot and never sent a turn to. Delete those — there is
    // nothing to lose — instead of letting `?showcase=1` visits (one
    // durable session per boot/tab/e2e context) accumulate on disk
    // indefinitely. Anything not in the registry (ordinary sessions, no
    // matter what their title says) and anything created during *this*
    // boot are untouched.
    await this.sweepStaleShowcaseSessions()
  }

  private sweepStaleShowcaseSessions(): Promise<void> {
    // The whole read-modify-write goes through the same queue mark/unmark
    // use, as ONE task — not a read followed by a separately-queued write —
    // so a mark/unmark landing between this sweep's read and its write
    // can't be silently overwritten by the sweep's own (now stale) copy of
    // the registry.
    return queueShowcaseRegistry(async () => {
      const registry = await readShowcaseRegistryUnsafe(this.explicitSessionRoot)
      if (registry.size === 0) return
      let registryChanged = false
      for (const entry of registry) {
        const decoded = decodeShowcaseRegistryEntry(entry)
        // Bare session ids collide across namespaces — 'alpha--hashA' and
        // 'alpha--hashB' (same agent type, different workspace scope) each
        // independently allocate their own 'scripted-main', exactly like
        // two different agent types do. The agent key AND workspace id are
        // both explicit in every entry now, so this is a definitive
        // ownership check, not a guess: an entry for a different agent key
        // is never this store's business, full stop — leave it untouched
        // for whichever store owns that key.
        if (!decoded || decoded.agentKey !== this.provenanceAgentKey) continue
        const { workspaceId, sessionId } = decoded
        const record = this.records.get(sessionId)
        // A record must exist under this exact id AND workspace id before
        // this store treats the entry as its own. Critically, an entry that
        // doesn't resolve here is left ALONE (never pruned) — it might
        // belong to a *different* store that happens to share this agent
        // key but a different workspace-scope hash (round 5's exact bug:
        // 'alpha--hashA' and 'alpha--hashB' are different stores, and
        // hashB's sweep must never guess about hashA's entries just
        // because it also has a same-id record, or has none at all). The
        // owning store's own `delete()` is what unmarks an entry once it's
        // actually gone — sweep-time pruning here would risk deleting a
        // still-valid mark for a store this one has no visibility into.
        if (!record || record.workspaceId !== workspaceId) continue
        if (record.turnCount !== 0) {
          // Got a real turn since being marked — it's an ordinary session now
          // (kept like any other) and no longer needs tracking.
          registry.delete(entry)
          registryChanged = true
          continue
        }
        this.records.delete(sessionId)
        registry.delete(entry)
        registryChanged = true
        try {
          const names = await readdir(this.sessionDir)
          const match = names.find((name) => name === `${sessionId}.jsonl` || name.endsWith(`_${sessionId}.jsonl`))
          if (match) await unlink(join(this.sessionDir, match))
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
      if (registryChanged) await writeShowcaseRegistryUnsafe(this.explicitSessionRoot, registry)
    })
  }

  private takeNextSessionId(): string {
    for (;;) {
      if (!Number.isSafeInteger(this.createCount) || this.createCount < 0) {
        throw new Error('scripted session id space exhausted')
      }
      const id = this.createCount === 0 ? DEFAULT_SESSION_ID : `scripted-${this.createCount}`
      this.createCount += 1
      if (id.length > MAX_SESSION_ID_LENGTH) throw new Error('scripted session id space exhausted')
      if (!this.records.has(id)) return id
    }
  }

  private belongsTo(record: ScriptedSessionRecord, ctx: SessionCtx): boolean {
    return record.workspaceId === ctx.workspaceId
  }

  private assertVisible(record: ScriptedSessionRecord, ctx: SessionCtx, sessionId: string): void {
    if (!this.belongsTo(record, ctx)) throw new Error(`Session not found: ${sessionId}`)
  }

  private async sessionFilePath(sessionId: string): Promise<string> {
    const names = await readdir(this.sessionDir)
    const match = names.find((name) => name === `${sessionId}.jsonl` || name.endsWith(`_${sessionId}.jsonl`))
    if (!match) throw new Error(`Session not found: ${sessionId}`)
    return join(this.sessionDir, match)
  }

  private async appendSessionInfo(record: ScriptedSessionRecord): Promise<void> {
    await mkdir(this.sessionDir, { recursive: true })
    await appendFile(await this.sessionFilePath(record.id), `${JSON.stringify(this.sessionInfo(record, record.updatedAt))}\n`, 'utf8')
  }

  private sessionInfo(record: ScriptedSessionRecord, timestamp: string): Record<string, unknown> {
    return { type: 'session_info', id: randomUUID(), parentId: null, timestamp, name: record.title }
  }

  private createRecord(id: string, title: string, workspaceId?: string): ScriptedSessionRecord {
    return {
      id,
      title,
      createdAt: DEFAULT_TIME,
      updatedAt: DEFAULT_TIME,
      turnCount: 0,
      nativeSessionId: id,
      hasAssistantReply: false,
      workspaceId,
    }
  }
}

async function readJsonl(file: string): Promise<Array<Record<string, unknown>>> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const entries: Array<Record<string, unknown>> = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) entries.push(parsed as Record<string, unknown>)
    } catch {
      // Retain the valid prefix only; an incomplete final append is invisible.
      break
    }
  }
  return entries
}

function sessionBaseDir(explicitRoot?: string): string {
  const explicit = explicitRoot?.trim()
  if (explicit) return resolve(explicit)
  const configured = process.env[SESSION_ROOT_ENV]?.trim()
  return configured ? resolve(configured) : join(homedir(), '.pi', 'agent', 'sessions')
}

function defaultSessionDir(cwd: string, explicitRoot?: string): string {
  if (explicitRoot && cwd.trim().length === 0) return sessionBaseDir(explicitRoot)
  const safePath = `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`
  return join(sessionBaseDir(explicitRoot), safePath)
}

// --- Showcase session provenance registry -----------------------------
//
// The playground's `?showcase=1` route needs a boot-time sweep of stale,
// still-empty sessions it created (gh-1452 PR #1458 review). An earlier
// version of this marked provenance with a fixed title prefix
// (`SHOWCASE_SESSION_TITLE_TAG`) — but the create/rename HTTP schemas
// accept any nonempty title up to 200 chars and forward it unchanged, so
// an ordinary session a developer happened to title starting with that
// exact prefix would be swept too. Title text is user-controlled data,
// not durable provenance.
//
// Provenance now lives in a sidecar registry file instead: a plain JSON
// array of entries, written ONLY by the dev-only wrapper route
// (`POST /api/v1/playground/showcase-sessions` in dev.ts) that the
// showcase route's own session-creation calls go through — no title
// content is ever inspected, so nothing an ordinary session's title says
// can cause it to be swept. The file lives at a fixed, well-known path
// derived the same way `sessionBaseDir` resolves the session root, so
// both dev.ts (writer) and this store (reader/pruner) agree on its
// location without needing to share a live object reference across the
// HTTP boundary.
//
// Each entry is keyed by (agent key, workspace id, session id), NOT bare
// session id — round 4 review: scripted session ids ('scripted-main',
// 'scripted-1', ...) are only unique WITHIN one namespaced store; two
// different agent types each allocate their own 'scripted-main'
// independently, so a bare-id registry let a mark for one agent's session
// be read as provenance for an unrelated session of the same id under a
// different agent. Agent-key scoping alone still wasn't enough (round 5):
// the store is scoped by the FULL storage namespace
// `<agentTypeId>--<hash(workspaceScopeId)>--...`
// (sessionNamespaceForAgent in packages/agent/.../sessionInventory.ts), so
// the SAME agent type under two different workspace scopes
// ('alpha--hashA' vs 'alpha--hashB') is still two independent stores that
// each allocate their own 'scripted-main'. Reproducing that hash here
// would require duplicating a private algorithm from a different package
// (sha256 of an internal workspaceScopeId this store never even sees) —
// fragile coupling for no real benefit. Instead, the workspace id
// dimension is carried by the plain, unhashed id both sides already have
// firsthand: this store receives it per-call as `SessionCtx.workspaceId`
// (the same field `belongsTo` already scopes ordinary session visibility
// by), and the dev-only wrapper route already has the raw
// `x-boring-workspace-id` header it forwards on every request. Two
// different raw workspace ids always land in two different registry
// entries, exactly tracking whichever partition the real (hashed)
// namespace would have produced — without ever needing to know the hash.
const SHOWCASE_REGISTRY_FILENAME = '.playground-showcase-session-ids.json'
// Neither an agent type id, a raw workspace id, nor a scripted session id
// can ever contain this character (session ids match SAFE_NATIVE_SESSION_ID;
// agent type ids and workspace ids are restricted identifier charsets
// upstream), so it is a collision-proof separator for the composite key.
const SHOWCASE_REGISTRY_KEY_SEPARATOR = ''

function encodeShowcaseRegistryEntry(agentKey: string, workspaceId: string, sessionId: string): string {
  return `${agentKey}${SHOWCASE_REGISTRY_KEY_SEPARATOR}${workspaceId}${SHOWCASE_REGISTRY_KEY_SEPARATOR}${sessionId}`
}

function decodeShowcaseRegistryEntry(entry: string): { agentKey: string; workspaceId: string; sessionId: string } | undefined {
  const firstSeparator = entry.indexOf(SHOWCASE_REGISTRY_KEY_SEPARATOR)
  if (firstSeparator < 0) return undefined
  const secondSeparator = entry.indexOf(SHOWCASE_REGISTRY_KEY_SEPARATOR, firstSeparator + 1)
  if (secondSeparator < 0) return undefined
  return {
    agentKey: entry.slice(0, firstSeparator),
    workspaceId: entry.slice(firstSeparator + 1, secondSeparator),
    sessionId: entry.slice(secondSeparator + 1),
  }
}

function showcaseRegistryPath(explicitRoot?: string): string {
  return join(sessionBaseDir(explicitRoot), SHOWCASE_REGISTRY_FILENAME)
}

async function readShowcaseRegistryUnsafe(explicitRoot?: string): Promise<Set<string>> {
  try {
    const text = await readFile(showcaseRegistryPath(explicitRoot), 'utf8')
    const parsed: unknown = JSON.parse(text)
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [])
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Set()
    // A corrupt registry file must never crash session hydration — treat
    // it as empty and let the next successful write repair it.
    return new Set()
  }
}

async function writeShowcaseRegistryUnsafe(explicitRoot: string | undefined, entries: ReadonlySet<string>): Promise<void> {
  const path = showcaseRegistryPath(explicitRoot)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify([...entries].sort()), 'utf8')
}

// Every read-modify-write of the registry file — mark, unmark, and the
// boot-time sweep's own read+prune — is chained through this single
// process-wide queue. `markPlaygroundShowcaseSession` is called from the
// dev-only HTTP route handler (dev.ts), where two POSTs can genuinely
// overlap (two tabs booting at once, a retry racing the original attempt);
// an unlocked read-modify-write of the JSON file would let the second
// write silently clobber the first write's addition. Node is
// single-threaded, so serializing every access through one promise chain
// is sufficient — no OS-level file lock needed for a same-process,
// dev-only sidecar file.
let showcaseRegistryQueue: Promise<unknown> = Promise.resolve()

function queueShowcaseRegistry<T>(task: () => Promise<T>): Promise<T> {
  const result = showcaseRegistryQueue.then(task, task)
  // Never let one failed task poison the queue for later, unrelated calls.
  showcaseRegistryQueue = result.catch(() => undefined)
  return result
}

/**
 * Records that `sessionId` (under `agentKey`, e.g. the requested
 * `agentTypeId`, and `workspaceId`, the raw `x-boring-workspace-id`) was
 * created by the showcase route. Called only from the dev-only wrapper
 * route, never reachable from the ordinary session-creation UI — that is
 * what makes this provenance (as opposed to the old title tag) immune to
 * collision with a normal session. Keyed by (agentKey, workspaceId,
 * sessionId), not bare sessionId — see the registry comment above for why
 * bare ids collide across agent/workspace-scope namespaces.
 */
export function markPlaygroundShowcaseSession(explicitRoot: string | undefined, agentKey: string, workspaceId: string, sessionId: string): Promise<void> {
  return queueShowcaseRegistry(async () => {
    const entries = await readShowcaseRegistryUnsafe(explicitRoot)
    const entry = encodeShowcaseRegistryEntry(agentKey, workspaceId, sessionId)
    if (entries.has(entry)) return
    entries.add(entry)
    await writeShowcaseRegistryUnsafe(explicitRoot, entries)
  })
}

/**
 * Removes the (agentKey, workspaceId, sessionId) entry from the registry,
 * if present. Called by `ScriptedSessionStore.delete` for every deletion
 * (showcase-originated or not — a no-op if the entry was never registered)
 * so a session no longer needs tracking the moment it stops existing,
 * instead of waiting for a future boot's sweep to notice. This is what
 * prevents a stale registry entry from surviving long enough for its
 * numeric id to be recycled by an unrelated ordinary session (in the same,
 * or without this scoping, even a different agent/workspace namespace).
 */
export function unmarkPlaygroundShowcaseSession(explicitRoot: string | undefined, agentKey: string, workspaceId: string, sessionId: string): Promise<void> {
  return queueShowcaseRegistry(async () => {
    const entries = await readShowcaseRegistryUnsafe(explicitRoot)
    const entry = encodeShowcaseRegistryEntry(agentKey, workspaceId, sessionId)
    if (!entries.has(entry)) return
    entries.delete(entry)
    await writeShowcaseRegistryUnsafe(explicitRoot, entries)
  })
}

/**
 * True only if (agentKey, workspaceId, sessionId) was previously marked by
 * `markPlaygroundShowcaseSession` and hasn't since been unmarked. Used by
 * the dev-only wrapper route to validate a client-supplied
 * `resumeSessionId` before ever forwarding it to the real create-session
 * endpoint, scoped to the REQUESTED `agentTypeId` and the raw
 * `x-boring-workspace-id` of the current request: `resumeSessionId`
 * travels through writable `sessionStorage` (App.tsx), so a stale or
 * manipulated value could otherwise name an ordinary session (or a
 * showcase session belonging to a *different* agent type or workspace
 * scope) the wrapper never created for this exact request. Refusing to
 * honor (and thus never marking) an unrecognized (agentKey, workspaceId,
 * id) triple closes that off — the wrapper can only ever resume an id it
 * already vouched for itself, for that exact agent type and workspace.
 */
export function isPlaygroundShowcaseSession(explicitRoot: string | undefined, agentKey: string, workspaceId: string, sessionId: string): Promise<boolean> {
  return queueShowcaseRegistry(async () => (await readShowcaseRegistryUnsafe(explicitRoot)).has(encodeShowcaseRegistryEntry(agentKey, workspaceId, sessionId)))
}

/** Test-only: the registry's current on-disk (agentKey, workspaceId, sessionId) entries, for asserting boundedness/scoping directly. */
export function readPlaygroundShowcaseRegistryForTest(explicitRoot?: string): Promise<Set<string>> {
  return queueShowcaseRegistry(() => readShowcaseRegistryUnsafe(explicitRoot))
}

class ScriptedPiSessionAdapter implements PiAgentSessionAdapter {
  private readonly subscribers = new Set<(event: AgentSessionEvent) => void>()
  private readonly messages: ScriptedMessage[]
  private readonly followUps: ScriptedFollowUp[] = []
  private streaming = false
  private turn = 0
  private activeRun: ScriptedRun | undefined

  constructor(
    private readonly sessionId: string,
    private readonly tickMs: number,
    private readonly toolDelayTicks: number,
    private readonly reasoningPartCount: number,
    private readonly responseMarker: string,
    private readonly capabilityToolName: string | undefined,
    initialMessages: ScriptedMessage[],
    private readonly persistMessages: (messages: readonly ScriptedMessage[]) => Promise<void>,
  ) {
    this.messages = [...initialMessages]
    this.turn = this.messages.filter((message) => message.role === 'user').length
  }

  readSnapshot(): PiAgentSessionSnapshot {
    return {
      state: {},
      messages: [...this.messages],
      isStreaming: this.streaming,
      isRetrying: false,
      retryAttempt: 0,
      pendingMessageCount: this.followUps.length,
      steeringMessages: [],
      followUpMessages: this.followUps.map((followUp) => followUp.text),
      followUpMode: 'one-at-a-time',
      sessionId: this.sessionId,
      sessionName: 'Scripted baseline',
    }
  }

  subscribe(listener: (event: AgentSessionEvent) => void): () => void {
    this.subscribers.add(listener)
    return () => {
      this.subscribers.delete(listener)
    }
  }

  async prompt(input: PiAgentPromptInput): Promise<void> {
    const text = typeof input === 'string' ? input : input.text
    await this.runScriptedTurn(text)
  }

  async followUp(text: string, options?: { clientNonce?: string; clientSeq?: number }): Promise<void> {
    this.followUps.push({
      text,
      clientNonce: options?.clientNonce,
      clientSeq: options?.clientSeq,
    })
    this.emit({
      type: 'queue_update',
      followUp: this.followUpTexts(),
    })
  }

  clearQueue(): { steering: string[]; followUp: string[] } {
    const cleared = this.followUpTexts()
    this.followUps.splice(0)
    this.emit({
      type: 'queue_update',
      followUp: [],
    })
    return { steering: [], followUp: cleared }
  }

  clearFollowUp(options?: { clientNonce?: string; clientSeq?: number }): void {
    if (!options || (options.clientNonce === undefined && options.clientSeq === undefined)) {
      this.clearQueue()
      return
    }
    const index = this.findFollowUpIndex(options)
    if (index >= 0) this.followUps.splice(index, 1)
    this.emit({
      type: 'queue_update',
      followUp: this.followUpTexts(),
    })
  }

  async abort(): Promise<void> {
    if (!this.streaming) return
    if (this.activeRun) this.activeRun.cancelled = true
    this.activeRun = undefined
    this.streaming = false
    this.emit({
      type: 'agent_end',
      status: 'aborted',
      messages: [{ role: 'assistant', stopReason: 'aborted' }],
      willRetry: false,
    })
  }

  async continueQueuedFollowUp(): Promise<void> {
    await this.startNextQueuedFollowUp()
  }

  private async runScriptedTurn(text: string, followUp?: ScriptedFollowUp): Promise<void> {
    this.turn += 1
    const suffix = this.turn === 1 ? '' : `-${this.turn}`
    const turnId = `turn${suffix || '-1'}`
    const userId = `u${this.turn}`
    const assistantId = `a${this.turn}`
    const toolCallId = `tool-${this.turn}`
    const reasoningTexts = ['Reasoning visible', 'Second reasoning visible', 'Third reasoning visible'].slice(0, this.reasoningPartCount)
    const finalText = this.responseMarker
    const toolName = this.capabilityToolName ?? 'grep'
    const toolOutput = this.capabilityToolName ?? 'TOOL_E2E_OUTPUT'
    const run: ScriptedRun = { cancelled: false }

    const userMessage = {
      id: userId,
      role: 'user',
      content: [{ type: 'text', text }],
      ...(followUp?.clientNonce ? { clientNonce: followUp.clientNonce } : {}),
      ...(followUp?.clientSeq !== undefined ? { clientSeq: followUp.clientSeq } : {}),
      timestamp: Date.now(),
    }
    const assistantContent: Array<Record<string, unknown>> = []
    const assistantMessage = {
      id: assistantId,
      role: 'assistant',
      content: assistantContent,
      stopReason: 'stop',
      timestamp: Date.now(),
    }
    const toolResult = {
      role: 'toolResult',
      toolCallId,
      content: toolOutput,
      details: {
        exitCode: 0,
        stdout: toolOutput,
        stderr: '',
      },
    }

    this.streaming = true
    this.activeRun = run
    this.emit({ type: 'agent_start', turnId })
    if (!(await this.tick(run))) return
    this.messages.push(userMessage)
    this.emit({ type: 'message_start', message: userMessage })
    if (followUp) this.emit({ type: 'queue_update', followUp: this.followUpTexts() })
    if (!(await this.tick(run))) return
    this.messages.push(assistantMessage)
    this.emit({ type: 'message_start', message: assistantMessage })
    if (!(await this.tick(run))) return
    for (const [index, reasoningText] of reasoningTexts.entries()) {
      assistantContent.push({ type: 'reasoning', id: `r${index + 1}`, text: reasoningText })
      this.emit({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', contentIndex: index, delta: reasoningText, partial: { id: assistantId } } })
      if (!(await this.tick(run))) return
      this.emit({ type: 'message_update', assistantMessageEvent: { type: 'thinking_end', contentIndex: index, content: reasoningText, partial: { id: assistantId } } })
      if (!(await this.tick(run))) return
    }
    const toolPart = {
      type: 'toolCall',
      id: toolCallId,
      name: toolName,
      arguments: this.capabilityToolName ? {} : { pattern: 'baseline' },
      state: 'input-available',
    }
    assistantContent.push(toolPart)
    const toolContentIndex = assistantContent.length - 1
    this.emit({
      type: 'message_update',
      assistantMessageEvent: {
        type: 'toolcall_end',
        contentIndex: toolContentIndex,
        partial: { id: assistantId },
        toolCall: {
          id: toolCallId,
          name: toolName,
          arguments: this.capabilityToolName ? {} : { pattern: 'baseline' },
        },
      },
    })
    for (let i = 0; i < this.toolDelayTicks; i += 1) {
      if (!(await this.tick(run))) return
    }
    toolPart.state = 'output-available'
    Object.assign(toolPart, { output: toolOutput })
    this.messages.push(toolResult)
    this.emit({ type: 'tool_execution_end', toolCallId, result: toolResult })
    if (!(await this.tick(run))) return
    const textPart = { type: 'text', text: finalText }
    assistantContent.push(textPart)
    const textContentIndex = assistantContent.length - 1
    this.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: textContentIndex, delta: finalText, partial: { id: assistantId } } })
    if (!(await this.tick(run))) return
    this.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_end', contentIndex: textContentIndex, content: finalText, partial: { id: assistantId } } })
    if (!(await this.tick(run))) return
    await this.persistMessages(this.messages)
    this.emit({ type: 'message_end', message: assistantMessage })
    if (!(await this.tick(run))) return
    if (this.activeRun !== run || run.cancelled) return
    this.streaming = false
    this.activeRun = undefined
    this.emit({ type: 'agent_end', status: 'ok', messages: this.messages, willRetry: false })
    void this.startNextQueuedFollowUp()
  }

  private async tick(run: ScriptedRun): Promise<boolean> {
    await sleep(this.tickMs)
    return this.activeRun === run && !run.cancelled
  }

  private async startNextQueuedFollowUp(): Promise<void> {
    if (this.streaming) return
    const next = this.followUps.shift()
    if (!next) return
    await this.runScriptedTurn(next.text, next)
  }

  private followUpTexts(): string[] {
    return this.followUps.map((followUp) => followUp.text)
  }

  private findFollowUpIndex(options: { clientNonce?: string; clientSeq?: number }): number {
    if (options.clientNonce) return this.followUps.findIndex((followUp) => followUp.clientNonce === options.clientNonce)
    if (options.clientSeq !== undefined) return this.followUps.findIndex((followUp) => followUp.clientSeq === options.clientSeq)
    return -1
  }

  private emit(event: Record<string, unknown>): void {
    for (const subscriber of this.subscribers) {
      subscriber(event as AgentSessionEvent)
    }
  }
}

function readTickMs(): number {
  const parsed = Number.parseInt(process.env.BORING_AGENT_E2E_SCRIPTED_PI_TICK_MS ?? '', 10)
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_TICK_MS
  return Math.min(parsed, 1_000)
}

function readToolDelayTicks(): number {
  const parsed = Number.parseInt(process.env.BORING_AGENT_E2E_SCRIPTED_PI_TOOL_DELAY_TICKS ?? '', 10)
  if (!Number.isFinite(parsed) || parsed < 1) return 1
  return Math.min(parsed, 20)
}

function readReasoningPartCount(): number {
  const parsed = Number.parseInt(process.env.BORING_AGENT_E2E_SCRIPTED_PI_REASONING_PARTS ?? '', 10)
  if (!Number.isFinite(parsed) || parsed < 1) return 1
  return Math.min(parsed, 3)
}

function toSummary(record: ScriptedSessionRecord): SessionSummary {
  return {
    id: record.id,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    turnCount: record.turnCount,
    nativeSessionId: record.nativeSessionId ?? record.id,
    hasAssistantReply: record.hasAssistantReply === true,
  }
}

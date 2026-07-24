import { randomUUID } from 'node:crypto'
import { mkdir, appendFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'
import type { AgentSessionEvent } from '@mariozechner/pi-coding-agent'
import { CURRENT_SESSION_VERSION } from '@mariozechner/pi-coding-agent'
import type { AgentHarness, RunContext, AgentSendInput } from '@hachej/boring-agent/shared'
import type { SessionCtx, SessionDetail, SessionStore, SessionSummary } from '@hachej/boring-agent/shared'

interface AgentHarnessFactoryInput {
  cwd: string
  runtimeCwd?: string
  systemPromptAppend?: string
  sessionNamespace?: string
  sessionRoot?: string
  sessionDir?: string
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

let persistedHarness: ScriptedPiHarness | undefined

export function createPersistedScriptedPiHarness(input: AgentHarnessFactoryInput): ScriptedPiHarness {
  persistedHarness ??= createScriptedPiHarness(input)
  return persistedHarness
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

  const getAdapter = (sessionId: string): ScriptedPiSessionAdapter => {
    let adapter = adapters.get(sessionId)
    if (!adapter) {
      adapter = new ScriptedPiSessionAdapter(sessionId, tickMs, toolDelayTicks, reasoningPartCount, (message) => sessions.appendMessage(sessionId, message))
      adapters.set(sessionId, adapter)
    }
    return adapter
  }

  return {
    id: 'scripted-pi-e2e',
    placement: 'server',
    sessions,
    async getPiSessionAdapter({ sessionId }: AgentSendInput) {
      if (!sessionId) throw new Error('sessionId is required')
      await sessions.ensure(sessionId)
      return getAdapter(sessionId)
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

  constructor(input: AgentHarnessFactoryInput) {
    this.sessionDir = input.sessionDir ?? (input.sessionNamespace
      ? join(sessionBaseDir(input.sessionRoot), input.sessionNamespace)
      : defaultSessionDir(input.cwd, input.sessionRoot))
  }

  async ensure(sessionId: string): Promise<SessionSummary> {
    const existing = this.records.get(sessionId)
    if (existing) return toSummary(existing)
    const record = this.createRecord(sessionId, 'Scripted baseline')
    this.records.set(record.id, record)
    await this.writeSessionFile(record, {})
    return toSummary(record)
  }

  async list(_ctx: SessionCtx): Promise<SessionSummary[]> {
    return [...this.records.values()]
      .map(toSummary)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async create(_ctx: SessionCtx, init?: { title?: string }): Promise<SessionSummary> {
    const id = this.createCount === 0 ? DEFAULT_SESSION_ID : `scripted-${this.createCount}`
    this.createCount += 1
    const existing = this.records.get(id)
    if (existing) return toSummary(existing)
    const record = this.createRecord(id, init?.title ?? 'Scripted baseline', _ctx.workspaceId)
    this.records.set(record.id, record)
    await this.writeSessionFile(record, _ctx)
    return toSummary(record)
  }

  async load(_ctx: SessionCtx, sessionId: string): Promise<SessionDetail> {
    const record = this.records.get(sessionId)
    if (!record) throw new Error(`Session not found: ${sessionId}`)
    return toSummary(record)
  }

  async delete(_ctx: SessionCtx, sessionId: string): Promise<void> {
    this.records.delete(sessionId)
  }

  async rename(_ctx: SessionCtx, sessionId: string, title: string): Promise<SessionSummary> {
    const record = this.records.get(sessionId)
    if (!record) throw new Error(`Session not found: ${sessionId}`)
    const renamed = { ...record, title, updatedAt: new Date().toISOString() }
    this.records.set(sessionId, renamed)
    void this.appendSessionInfo(renamed)
    return toSummary(renamed)
  }

  appendMessage(sessionId: string, message: ScriptedMessage): void {
    const record = this.records.get(sessionId)
    if (!record) return
    const touched = { ...record, updatedAt: new Date().toISOString(), turnCount: message.role === 'user' ? record.turnCount + 1 : record.turnCount }
    this.records.set(sessionId, touched)
    const entry = { type: 'message', id: randomUUID(), parentId: null, timestamp: touched.updatedAt, message }
    void appendFile(join(this.sessionDir, `${sessionId}.jsonl`), `${JSON.stringify(entry)}\n`, 'utf8')
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
      boringSessionCtx: ctx.workspaceId ? { workspaceId: ctx.workspaceId } : {},
    }
    const info = this.sessionInfo(record, now)
    await writeFile(join(this.sessionDir, `${record.id}.jsonl`), `${JSON.stringify(header)}\n${JSON.stringify(info)}\n`, 'utf8')
  }

  private async appendSessionInfo(record: ScriptedSessionRecord): Promise<void> {
    await mkdir(this.sessionDir, { recursive: true })
    await appendFile(join(this.sessionDir, `${record.id}.jsonl`), `${JSON.stringify(this.sessionInfo(record, record.updatedAt))}\n`, 'utf8')
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
      workspaceId,
    }
  }
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

class ScriptedPiSessionAdapter implements PiAgentSessionAdapter {
  private readonly subscribers = new Set<(event: AgentSessionEvent) => void>()
  private readonly messages: ScriptedMessage[] = []
  private readonly followUps: ScriptedFollowUp[] = []
  private streaming = false
  private turn = 0
  private activeRun: ScriptedRun | undefined

  constructor(
    private readonly sessionId: string,
    private readonly tickMs: number,
    private readonly toolDelayTicks: number,
    private readonly reasoningPartCount: number,
    private readonly appendMessage: (message: ScriptedMessage) => void,
  ) {}

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
    const finalText = 'PI_NATIVE_ASSISTANT_DONE'
    const toolOutput = 'TOOL_E2E_OUTPUT'
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
    this.appendMessage(userMessage)
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
      name: 'grep',
      arguments: { pattern: 'baseline' },
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
          name: 'grep',
          arguments: { pattern: 'baseline' },
        },
      },
    })
    for (let i = 0; i < this.toolDelayTicks; i += 1) {
      if (!(await this.tick(run))) return
    }
    toolPart.state = 'output-available'
    Object.assign(toolPart, { output: toolOutput })
    this.messages.push(toolResult)
    this.appendMessage(toolResult)
    this.emit({ type: 'tool_execution_end', toolCallId, result: toolResult })
    if (!(await this.tick(run))) return
    const textPart = { type: 'text', text: finalText }
    assistantContent.push(textPart)
    const textContentIndex = assistantContent.length - 1
    this.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: textContentIndex, delta: finalText, partial: { id: assistantId } } })
    if (!(await this.tick(run))) return
    this.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_end', contentIndex: textContentIndex, content: finalText, partial: { id: assistantId } } })
    if (!(await this.tick(run))) return
    this.appendMessage(assistantMessage)
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
  }
}

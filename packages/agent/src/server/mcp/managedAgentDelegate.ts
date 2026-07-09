import { randomUUID } from 'node:crypto'

import type { Agent, AgentActor, AgentEvent } from '../../shared/events'
import { ErrorCode, type ErrorCode as StableErrorCode } from '../../shared/error-codes'
import type { BoringChatMessage, BoringChatPart } from '../../shared/chat'
import type { SessionCtx } from '../../shared/session'

export const MANAGED_AGENT_MCP_ORIGIN_SURFACE = 'mcp-managed-agent'
export const MANAGED_AGENT_MCP_DELIVERY_RULE =
  'M1-pr1 DELIVERY v0: delegate_task returns final assistant text and artifact file references only; share-link delivery is gated on PR #424.'

export type ManagedAgentDelegationStatus = 'running' | 'completed' | 'error'
export type ManagedAgentDelegateStatus = ManagedAgentDelegationStatus

export interface ManagedAgentArtifactRef {
  path: string
  mediaType?: string
  title?: string
  content?: string
  truncated?: boolean
}

export interface ManagedAgentDelegateProgress {
  at: string
  eventIndex: number
  kind: string
  message: string
}

export interface ManagedAgentDelegateResult {
  delegationId: string
  status: 'completed'
  finalAssistantText: string
  artifacts: ManagedAgentArtifactRef[]
  deliveryRule: typeof MANAGED_AGENT_MCP_DELIVERY_RULE
}

export interface ManagedAgentDelegateStatusResult {
  delegationId: string
  status: ManagedAgentDelegationStatus
  progress: ManagedAgentDelegateProgress[]
  lastEventIndex?: number
  eventCount: number
  result?: ManagedAgentDelegateResult
  error?: ManagedAgentSafeError
}

export interface ManagedAgentSafeError {
  code: StableErrorCode
  message: string
}

export interface ManagedAgentDelegateRequestContext {
  sessionId?: string
  authInfo?: unknown
}

export interface ManagedAgentDelegateInput {
  brief: string
  request?: ManagedAgentDelegateRequestContext
  onDelegationCreated?: (status: ManagedAgentDelegateStatusResult) => void | Promise<void>
  onProgress?: (progress: ManagedAgentDelegateProgress) => void | Promise<void>
  signal?: AbortSignal
}

export interface ManagedAgentCollectArtifactsInput {
  delegationId: string
  sessionId: string
  ctx: SessionCtx
  finalAssistantText: string
  events: readonly AgentEvent[]
}

export interface ManagedAgentMcpDelegateOptions {
  agent: Agent
  resolveSessionCtx(input: { brief: string; request: ManagedAgentDelegateRequestContext }): SessionCtx | Promise<SessionCtx>
  resolveActor?(input: { brief: string; ctx: SessionCtx; request: ManagedAgentDelegateRequestContext }): AgentActor | Promise<AgentActor>
  collectArtifacts?(input: ManagedAgentCollectArtifactsInput): ManagedAgentArtifactRef[] | Promise<ManagedAgentArtifactRef[]>
  createDelegationId?: () => string
  now?: () => Date
  maxBriefChars?: number
  maxInlineArtifactContentChars?: number
  terminalRetentionMs?: number
  maxDelegations?: number
  redactionCanaries?: readonly string[]
}

interface DelegationRecord {
  delegationId: string
  status: ManagedAgentDelegationStatus
  createdAt: string
  updatedAt: string
  progress: ManagedAgentDelegateProgress[]
  eventCount: number
  ownerCtx?: SessionCtx
  expiresAtMs?: number
  lastEventIndex?: number
  result?: ManagedAgentDelegateResult
  error?: ManagedAgentSafeError
}

type AgentEndEvent = AgentEvent & { chunk: Extract<AgentEvent['chunk'], { type: 'agent-end' }> }

const DEFAULT_MAX_BRIEF_CHARS = 12_000
const DEFAULT_MAX_INLINE_ARTIFACT_CONTENT_CHARS = 8_000
const DEFAULT_TERMINAL_RETENTION_MS = 15 * 60_000
const DEFAULT_MAX_DELEGATIONS = 100
const MAX_RETAINED_PROGRESS = 100

export class ManagedAgentMcpError extends Error {
  readonly code: StableErrorCode

  constructor(code: StableErrorCode, message: string) {
    super(message)
    this.name = 'ManagedAgentMcpError'
    this.code = code
  }
}

export class ManagedAgentMcpDelegateController {
  private readonly delegations = new Map<string, DelegationRecord>()
  private readonly createDelegationId: () => string
  private readonly now: () => Date
  private readonly maxBriefChars: number
  private readonly maxInlineArtifactContentChars: number
  private readonly terminalRetentionMs: number
  private readonly maxDelegations: number
  private readonly redactionCanaries: readonly string[]

  constructor(private readonly options: ManagedAgentMcpDelegateOptions) {
    this.createDelegationId = options.createDelegationId ?? randomUUID
    this.now = options.now ?? (() => new Date())
    this.maxBriefChars = options.maxBriefChars ?? DEFAULT_MAX_BRIEF_CHARS
    this.maxInlineArtifactContentChars =
      options.maxInlineArtifactContentChars ?? DEFAULT_MAX_INLINE_ARTIFACT_CONTENT_CHARS
    this.terminalRetentionMs = Math.max(0, options.terminalRetentionMs ?? DEFAULT_TERMINAL_RETENTION_MS)
    this.maxDelegations = Math.max(1, Math.floor(options.maxDelegations ?? DEFAULT_MAX_DELEGATIONS))
    this.redactionCanaries = options.redactionCanaries ?? []
  }

  async delegateTask(input: ManagedAgentDelegateInput): Promise<ManagedAgentDelegateResult> {
    const brief = this.parseBrief(input.brief)
    const request = input.request ?? {}
    let record: DelegationRecord | undefined

    try {
      this.assertNotAborted(input.signal)
      const ctx = await this.resolveSessionCtx(brief, request)
      this.assertNotAborted(input.signal)
      const delegationId = this.createDelegationId()
      record = this.createRecord(delegationId)
      record.ownerCtx = ctx
      this.delegations.set(delegationId, record)
      this.pruneDelegations()
      await input.onDelegationCreated?.(this.getStatus(delegationId, ctx))
      this.assertNotAborted(input.signal)
      const actor = await this.resolveActor(brief, ctx, request)
      const receipt = await this.options.agent.start({
        content: brief,
        actor,
        ctx,
        originSurface: MANAGED_AGENT_MCP_ORIGIN_SURFACE,
      })
      if (input.signal?.aborted) {
        await this.stopDelegatedSession(receipt.sessionId, ctx)
        throw new ManagedAgentMcpError(ErrorCode.enum.ABORTED, 'delegation was cancelled')
      }
      let abortStopPromise: Promise<void> | undefined
      const abortListener = () => {
        abortStopPromise ??= this.stopDelegatedSession(receipt.sessionId, ctx)
      }
      input.signal?.addEventListener('abort', abortListener, { once: true })
      await this.pushProgress(record, 'agent-started', 'Agent session accepted for delegated task.', input.onProgress)

      const events: AgentEvent[] = []
      let terminal = false
      let terminalStatus: 'ok' | 'aborted' | 'error' | undefined
      try {
        for await (const event of this.options.agent.stream(receipt.sessionId, { startIndex: receipt.startIndex, ctx })) {
          if (input.signal?.aborted) {
            await abortStopPromise
            throw new ManagedAgentMcpError(ErrorCode.enum.ABORTED, 'delegation was cancelled')
          }
          events.push(event)
          await this.observeEvent(record, event, input.onProgress)
          if (isTerminalAgentEvent(event)) {
            terminal = true
            terminalStatus = event.chunk.status
            break
          }
        }
      } finally {
        input.signal?.removeEventListener('abort', abortListener)
      }

      if (input.signal?.aborted) {
        await abortStopPromise
        throw new ManagedAgentMcpError(ErrorCode.enum.ABORTED, 'delegation was cancelled')
      }
      if (!terminal) {
        throw new ManagedAgentMcpError(ErrorCode.enum.INTERNAL_ERROR, 'agent stream ended before task completion')
      }
      if (terminalStatus !== 'ok') {
        throw terminalError(terminalStatus, events)
      }

      const finalAssistantText = extractFinalAssistantText(events)
      const artifacts = await this.collectArtifacts({
        delegationId,
        sessionId: receipt.sessionId,
        ctx,
        finalAssistantText,
        events,
      })
      const result: ManagedAgentDelegateResult = {
        delegationId,
        status: 'completed',
        finalAssistantText,
        artifacts,
        deliveryRule: MANAGED_AGENT_MCP_DELIVERY_RULE,
      }
      this.assertPublicPayloadSafe(result)
      record.result = result
      this.markTerminal(record, 'completed')
      return result
    } catch (error) {
      const safe = this.toSafeError(error)
      if (record) {
        record.error = safe
        this.markTerminal(record, 'error')
      }
      throw new ManagedAgentMcpError(safe.code, safe.message)
    }
  }

  async getStatusForRequest(
    delegationId: string,
    request: ManagedAgentDelegateRequestContext,
  ): Promise<ManagedAgentDelegateStatusResult> {
    try {
      const ctx = await this.resolveSessionCtx('', request)
      return this.getStatus(delegationId, ctx)
    } catch (error) {
      const safe = this.toSafeError(error)
      throw new ManagedAgentMcpError(safe.code, safe.message)
    }
  }

  getStatus(delegationId: string, ctx: SessionCtx): ManagedAgentDelegateStatusResult {
    this.pruneDelegations()
    const record = this.delegations.get(parseDelegationId(delegationId))
    if (!record) throw new ManagedAgentMcpError(ErrorCode.enum.SESSION_NOT_FOUND, 'delegation not found')
    if (!record.ownerCtx || !sameSessionCtx(record.ownerCtx, ctx)) {
      throw new ManagedAgentMcpError(ErrorCode.enum.SESSION_NOT_FOUND, 'delegation not found')
    }
    const result: ManagedAgentDelegateStatusResult = {
      delegationId: record.delegationId,
      status: record.status,
      progress: [...record.progress],
      lastEventIndex: record.lastEventIndex,
      eventCount: record.eventCount,
      result: record.result,
      error: record.error,
    }
    this.assertPublicPayloadSafe(result)
    return result
  }

  private createRecord(delegationId: string): DelegationRecord {
    this.pruneDelegations()
    const runningCount = [...this.delegations.values()].filter((record) => record.status === 'running').length
    if (runningCount >= this.maxDelegations) {
      throw new ManagedAgentMcpError(ErrorCode.enum.TOOL_EXECUTION_ERROR, 'too many running delegated tasks')
    }
    const now = this.timestamp()
    return {
      delegationId,
      status: 'running',
      createdAt: now,
      updatedAt: now,
      progress: [],
      eventCount: 0,
    }
  }

  private markTerminal(record: DelegationRecord, status: 'completed' | 'error'): void {
    record.status = status
    record.updatedAt = this.timestamp()
    record.expiresAtMs = this.now().getTime() + this.terminalRetentionMs
    this.pruneDelegations()
  }

  private pruneDelegations(): void {
    const nowMs = this.now().getTime()
    for (const [delegationId, record] of this.delegations) {
      if (record.expiresAtMs !== undefined && record.expiresAtMs <= nowMs) {
        this.delegations.delete(delegationId)
      }
    }
    while (this.delegations.size > this.maxDelegations) {
      const terminal = [...this.delegations].find(([, record]) => record.status !== 'running')
      if (!terminal) return
      this.delegations.delete(terminal[0])
    }
  }

  private parseBrief(value: string): string {
    if (typeof value !== 'string') throw new ManagedAgentMcpError(ErrorCode.enum.TOOL_INVALID_INPUT, 'brief must be a string')
    const brief = value.trim()
    if (!brief) throw new ManagedAgentMcpError(ErrorCode.enum.TOOL_INVALID_INPUT, 'brief is required')
    if (brief.length > this.maxBriefChars) {
      throw new ManagedAgentMcpError(ErrorCode.enum.TOOL_INVALID_INPUT, `brief must be ${this.maxBriefChars} characters or fewer`)
    }
    return brief
  }

  private async resolveSessionCtx(brief: string, request: ManagedAgentDelegateRequestContext): Promise<SessionCtx> {
    const ctx = await this.options.resolveSessionCtx({ brief, request })
    if (!ctx || typeof ctx.workspaceId !== 'string' || !ctx.workspaceId.trim()) {
      throw new ManagedAgentMcpError(ErrorCode.enum.CONFIG_INVALID, 'MCP delegate requires a host-resolved SessionCtx with a real workspaceId')
    }
    if (ctx.userId !== undefined && (typeof ctx.userId !== 'string' || !ctx.userId.trim())) {
      throw new ManagedAgentMcpError(ErrorCode.enum.CONFIG_INVALID, 'MCP delegate SessionCtx userId must be a non-empty string when provided')
    }
    return { workspaceId: ctx.workspaceId, userId: ctx.userId }
  }

  private assertNotAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted) throw new ManagedAgentMcpError(ErrorCode.enum.ABORTED, 'delegation was cancelled')
  }

  private async stopDelegatedSession(sessionId: string, ctx: SessionCtx): Promise<void> {
    await this.options.agent.stop(sessionId, ctx).catch(() => undefined)
  }

  private async resolveActor(
    brief: string,
    ctx: SessionCtx,
    request: ManagedAgentDelegateRequestContext,
  ): Promise<AgentActor> {
    const actor = await this.options.resolveActor?.({ brief, ctx, request })
    return actor ?? { id: 'mcp-managed-agent', name: 'MCP managed agent' }
  }

  private async observeEvent(
    record: DelegationRecord,
    event: AgentEvent,
    onProgress: ManagedAgentDelegateInput['onProgress'],
  ): Promise<void> {
    record.eventCount += 1
    record.lastEventIndex = event.eventIndex
    const message = progressMessageForEvent(event)
    if (message) await this.pushProgress(record, event.chunk.type, message, onProgress, event.eventIndex)
  }

  private async pushProgress(
    record: DelegationRecord,
    kind: string,
    message: string,
    onProgress: ManagedAgentDelegateInput['onProgress'],
    eventIndex = record.lastEventIndex ?? -1,
  ): Promise<void> {
    const safeMessage = this.containsSecret(message) ? 'Agent progress updated.' : message
    const progress: ManagedAgentDelegateProgress = {
      at: this.timestamp(),
      eventIndex,
      kind,
      message: safeMessage,
    }
    record.progress.push(progress)
    if (record.progress.length > MAX_RETAINED_PROGRESS) record.progress.shift()
    record.updatedAt = progress.at
    try {
      await onProgress?.(progress)
    } catch {
      // MCP progress notifications are best-effort; polling remains the fallback.
    }
  }

  private async collectArtifacts(input: ManagedAgentCollectArtifactsInput): Promise<ManagedAgentArtifactRef[]> {
    const supplied = await this.options.collectArtifacts?.(input)
    const artifacts = (supplied ?? extractArtifactRefs(input.events)).map((artifact) =>
      normalizeArtifactRef(artifact, this.maxInlineArtifactContentChars),
    )
    this.assertPublicPayloadSafe(artifacts)
    return artifacts
  }

  private toSafeError(error: unknown): ManagedAgentSafeError {
    if (error instanceof ManagedAgentMcpError) {
      return {
        code: error.code,
        message: this.containsSecret(error.message) ? 'MCP delegate task failed' : error.message,
      }
    }
    return { code: parseStableErrorCode(error), message: 'MCP delegate task failed' }
  }

  private assertPublicPayloadSafe(payload: unknown): void {
    const serialized = JSON.stringify(payload)
    if (this.containsSecret(serialized)) {
      throw new ManagedAgentMcpError(ErrorCode.enum.INTERNAL_ERROR, 'MCP delegate payload failed secret redaction guard')
    }
  }

  private containsSecret(value: string): boolean {
    return this.redactionCanaries.some((canary) => canary.length > 0 && value.includes(canary))
  }

  private timestamp(): string {
    return this.now().toISOString()
  }
}

export function createManagedAgentMcpDelegateController(
  options: ManagedAgentMcpDelegateOptions,
): ManagedAgentMcpDelegateController {
  return new ManagedAgentMcpDelegateController(options)
}

function parseDelegationId(value: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ManagedAgentMcpError(ErrorCode.enum.TOOL_INVALID_INPUT, 'delegationId is required')
  }
  return value.trim()
}

function parseStableErrorCode(error: unknown): StableErrorCode {
  const parsed = ErrorCode.safeParse((error as { code?: unknown } | undefined)?.code)
  return parsed.success ? parsed.data : ErrorCode.enum.INTERNAL_ERROR
}

function isTerminalAgentEvent(event: AgentEvent): event is AgentEndEvent {
  return event.chunk.type === 'agent-end' && event.chunk.willRetry !== true
}

function terminalError(
  terminalStatus: 'aborted' | 'error' | undefined,
  events: readonly AgentEvent[],
): ManagedAgentMcpError {
  if (terminalStatus === 'aborted') return new ManagedAgentMcpError(ErrorCode.enum.ABORTED, 'agent turn was aborted')
  const errorEvent = [...events].reverse().find((event) => event.chunk.type === 'error')
  if (errorEvent?.chunk.type === 'error') {
    const parsed = ErrorCode.safeParse(errorEvent.chunk.error.code)
    return new ManagedAgentMcpError(parsed.success ? parsed.data : ErrorCode.enum.INTERNAL_ERROR, 'agent turn failed')
  }
  return new ManagedAgentMcpError(ErrorCode.enum.INTERNAL_ERROR, 'agent turn failed')
}

function progressMessageForEvent(event: AgentEvent): string | undefined {
  switch (event.chunk.type) {
    case 'agent-start':
      return 'Agent turn started.'
    case 'message-start':
      return event.chunk.role === 'assistant' ? 'Assistant response started.' : 'Delegated brief was recorded.'
    case 'message-delta':
    case 'message-part-end':
      return event.chunk.kind === 'text' ? 'Assistant text updated.' : 'Assistant reasoning updated.'
    case 'tool-call':
      return `Tool call started: ${event.chunk.toolName}.`
    case 'tool-result':
      return 'Tool call finished.'
    case 'agent-end':
      return event.chunk.status === 'ok' ? 'Agent turn completed.' : `Agent turn ended with status ${event.chunk.status}.`
    case 'error':
      return 'Agent stream reported an error.'
    default:
      return undefined
  }
}

function extractFinalAssistantText(events: readonly AgentEvent[]): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const chunk = events[index]?.chunk
    if (chunk?.type !== 'message-end' || chunk.final.role !== 'assistant') continue
    const text = textFromMessage(chunk.final)
    if (text) return text
  }
  const endedText = events
    .filter((event) => event.chunk.type === 'message-part-end' && event.chunk.kind === 'text')
    .map((event) => event.chunk.type === 'message-part-end' ? event.chunk.text : '')
    .filter(Boolean)
  if (endedText.length) return endedText.at(-1) ?? ''
  return ''
}

function textFromMessage(message: BoringChatMessage): string {
  return message.parts
    .filter((part): part is Extract<BoringChatPart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .filter(Boolean)
    .join('\n')
}

function extractArtifactRefs(events: readonly AgentEvent[]): ManagedAgentArtifactRef[] {
  const artifacts: ManagedAgentArtifactRef[] = []
  const seen = new Set<string>()
  for (const event of events) {
    if (event.chunk.type !== 'message-end') continue
    for (const part of event.chunk.final.parts) {
      if (part.type !== 'file' || !part.path) continue
      const key = `${part.filesystem ?? ''}:${part.path}`
      if (seen.has(key)) continue
      seen.add(key)
      artifacts.push({
        path: part.path,
        mediaType: part.mediaType,
        title: part.filename,
      })
    }
  }
  return artifacts
}

function normalizeArtifactRef(
  artifact: ManagedAgentArtifactRef,
  maxInlineArtifactContentChars: number,
): ManagedAgentArtifactRef {
  const path = normalizeArtifactPath(artifact.path)
  const normalized: ManagedAgentArtifactRef = {
    path,
    mediaType: optionalNonEmptyString(artifact.mediaType),
    title: optionalNonEmptyString(artifact.title),
  }
  if (artifact.content !== undefined) {
    if (typeof artifact.content !== 'string') {
      throw new ManagedAgentMcpError(ErrorCode.enum.INTERNAL_ERROR, 'artifact content must be text')
    }
    if (artifact.content.length <= maxInlineArtifactContentChars) {
      normalized.content = artifact.content
    } else {
      normalized.truncated = true
    }
  }
  if (artifact.truncated === true) normalized.truncated = true
  return normalized
}

function normalizeArtifactPath(path: string): string {
  if (typeof path !== 'string') throw new ManagedAgentMcpError(ErrorCode.enum.INTERNAL_ERROR, 'artifact path must be a string')
  const trimmed = path.trim()
  if (!trimmed) throw new ManagedAgentMcpError(ErrorCode.enum.INTERNAL_ERROR, 'artifact path is required')
  if (trimmed.includes('\0')) throw new ManagedAgentMcpError(ErrorCode.enum.INTERNAL_ERROR, 'artifact path is invalid')
  if (trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed)) {
    throw new ManagedAgentMcpError(ErrorCode.enum.INTERNAL_ERROR, 'artifact path must be workspace-relative')
  }
  const parts = trimmed.split(/[\\/]+/)
  if (parts.some((part) => part === '..')) {
    throw new ManagedAgentMcpError(ErrorCode.enum.INTERNAL_ERROR, 'artifact path must stay within the workspace')
  }
  return parts.filter((part) => part && part !== '.').join('/')
}

function optionalNonEmptyString(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function sameSessionCtx(a: SessionCtx, b: SessionCtx): boolean {
  return (a.workspaceId ?? '') === (b.workspaceId ?? '') && (a.userId ?? '') === (b.userId ?? '')
}

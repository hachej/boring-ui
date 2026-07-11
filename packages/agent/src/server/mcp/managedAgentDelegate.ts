import { createHash, randomUUID } from 'node:crypto'

import type { Agent, AgentActor, AgentEvent } from '../../shared/events'
import { ErrorCode, type ErrorCode as StableErrorCode } from '../../shared/error-codes'
import type { BoringChatMessage, BoringChatPart } from '../../shared/chat'
import type { SessionCtx } from '../../shared/session'
import type { Stat, Workspace } from '../../shared/workspace'

export const MANAGED_AGENT_MCP_ORIGIN_SURFACE = 'mcp-managed-agent'
export const MANAGED_AGENT_MCP_DELIVERY_RULE =
  'M1 DELIVERY v0: delegate_task returns bounded final assistant text and at most one complete authorized inline Markdown artifact; no artifact paths, truncation, or share-link delivery.'

const MAX_FINAL_ASSISTANT_TEXT_BYTES = 96 * 1024
const MAX_ARTIFACT_BYTES = 256 * 1024
const MAX_SERIALIZED_RESULT_BYTES = 384 * 1024
const MARKDOWN_MEDIA_TYPE = 'text/markdown'

export type ManagedAgentDelegationStatus = 'running' | 'completed' | 'error'
export type ManagedAgentDelegateStatus = ManagedAgentDelegationStatus

export interface ManagedAgentArtifactCandidate {
  path: string
  mediaType?: string
  title?: string
  content?: unknown
  truncated?: unknown
}

/** @deprecated Use ManagedAgentArtifactCandidate for internal artifact path candidates. */
export type ManagedAgentArtifactRef = ManagedAgentArtifactCandidate

export interface ManagedAgentArtifact {
  content: string
  sha256: `sha256:${string}`
  byteSize: number
  mediaType?: string
  title?: string
}

export interface ManagedAgentWorkspaceResolutionInput {
  brief: string
  ctx: SessionCtx
  request: ManagedAgentDelegateRequestContext
}

export interface ManagedAgentDelegateRunInput {
  brief: string
  ctx: SessionCtx
  request: ManagedAgentDelegateRequestContext
  actor: AgentActor
  signal?: AbortSignal
  onSessionStarted?: (sessionId: string) => void
}

export interface ManagedAgentDelegateRunner {
  run(input: ManagedAgentDelegateRunInput): AsyncIterable<AgentEvent>
  stop?(sessionId: string, ctx: SessionCtx): Promise<void> | void
}

export interface ManagedAgentBoundRunnerWorkspace {
  runner: ManagedAgentDelegateRunner
  workspace: Workspace
}

interface ResolvedArtifactBytes {
  content: string
  bytes: Uint8Array
  byteSize: number
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
  artifact?: ManagedAgentArtifact
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
  request: ManagedAgentDelegateRequestContext
  finalAssistantText: string
  events: readonly AgentEvent[]
}

export interface ManagedAgentMcpDelegateOptions {
  agent?: Agent
  resolveSessionCtx(input: { brief: string; request: ManagedAgentDelegateRequestContext }): SessionCtx | Promise<SessionCtx>
  resolveWorkspace?(input: ManagedAgentWorkspaceResolutionInput): Workspace | Promise<Workspace>
  resolveRunnerWorkspace?(input: ManagedAgentWorkspaceResolutionInput & {
    actor: AgentActor
  }): ManagedAgentBoundRunnerWorkspace | Promise<ManagedAgentBoundRunnerWorkspace>
  resolveActor?(input: { brief: string; ctx: SessionCtx; request: ManagedAgentDelegateRequestContext }): AgentActor | Promise<AgentActor>
  collectArtifacts?(input: ManagedAgentCollectArtifactsInput): ManagedAgentArtifactCandidate[] | Promise<ManagedAgentArtifactCandidate[]>
  createDelegationId?: () => string
  now?: () => Date
  maxBriefBytes?: number
  /** Optional additional character cap retained for host compatibility. */
  maxBriefChars?: number
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

const DEFAULT_MAX_BRIEF_BYTES = 32 * 1024
const DEFAULT_TERMINAL_RETENTION_MS = 15 * 60_000
const DEFAULT_MAX_DELEGATIONS = 100
const MAX_RETAINED_PROGRESS = 100
const utf8Encoder = new TextEncoder()
const strictUtf8Decoder = new TextDecoder('utf-8', { fatal: true })

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
  private readonly maxBriefBytes: number
  private readonly maxBriefChars?: number
  private readonly terminalRetentionMs: number
  private readonly maxDelegations: number
  private readonly redactionCanaries: readonly string[]

  constructor(private readonly options: ManagedAgentMcpDelegateOptions) {
    this.createDelegationId = options.createDelegationId ?? randomUUID
    this.now = options.now ?? (() => new Date())
    this.maxBriefBytes = options.maxBriefBytes ?? DEFAULT_MAX_BRIEF_BYTES
    this.maxBriefChars = options.maxBriefChars
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
      const bound = await this.resolveRunnerWorkspace(brief, ctx, request, actor)
      this.assertNotAborted(input.signal)
      let activeSessionId: string | undefined
      let abortStopPromise: Promise<void> | undefined
      const abortListener = () => {
        if (!activeSessionId) return
        abortStopPromise ??= this.stopDelegatedSession(bound.runner, activeSessionId, ctx)
      }
      input.signal?.addEventListener('abort', abortListener, { once: true })
      await this.pushProgress(record, 'agent-started', 'Agent session accepted for delegated task.', input.onProgress)

      const events: AgentEvent[] = []
      let terminal = false
      let terminalStatus: 'ok' | 'aborted' | 'error' | undefined
      try {
        for await (const event of bound.runner.run({
          brief,
          ctx,
          request,
          actor,
          signal: input.signal,
          onSessionStarted: (sessionId) => {
            activeSessionId = sessionId
          },
        })) {
          if (input.signal?.aborted) {
            await abortStopPromise
            throw new ManagedAgentMcpError(ErrorCode.enum.ABORTED, 'delegation was cancelled')
          }
          activeSessionId = event.sessionId
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

      const finalAssistantText = this.validateFinalAssistantText(extractFinalAssistantText(events))
      const artifacts = await this.collectArtifacts({
        delegationId,
        sessionId: activeSessionId ?? '',
        ctx,
        request,
        finalAssistantText,
        events,
      }, bound.workspace)
      const result: ManagedAgentDelegateResult = {
        delegationId,
        status: 'completed',
        finalAssistantText,
        deliveryRule: MANAGED_AGENT_MCP_DELIVERY_RULE,
        ...(artifacts[0] ? { artifact: artifacts[0] } : {}),
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
    if (this.maxBriefChars !== undefined && brief.length > this.maxBriefChars) {
      throw new ManagedAgentMcpError(ErrorCode.enum.TOOL_INVALID_INPUT, `brief must be ${this.maxBriefChars} characters or fewer`)
    }
    if (utf8ByteLength(brief) > this.maxBriefBytes) {
      throw new ManagedAgentMcpError(ErrorCode.enum.TOOL_INVALID_INPUT, `brief must be ${this.maxBriefBytes} UTF-8 bytes or fewer`)
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

  private async resolveWorkspace(
    brief: string,
    ctx: SessionCtx,
    request: ManagedAgentDelegateRequestContext,
  ): Promise<Workspace> {
    const resolveWorkspace = this.options.resolveWorkspace
    if (!resolveWorkspace) {
      throw new ManagedAgentMcpError(ErrorCode.enum.CONFIG_INVALID, 'MCP delegate requires a host-resolved Workspace')
    }
    const workspace = await resolveWorkspace({ brief, ctx, request })
    if (!workspace || typeof workspace.stat !== 'function' || typeof workspace.readFile !== 'function') {
      throw new ManagedAgentMcpError(ErrorCode.enum.CONFIG_INVALID, 'MCP delegate requires a host-resolved Workspace')
    }
    return workspace
  }

  private async resolveRunnerWorkspace(
    brief: string,
    ctx: SessionCtx,
    request: ManagedAgentDelegateRequestContext,
    actor: AgentActor,
  ): Promise<ManagedAgentBoundRunnerWorkspace> {
    const resolved = this.options.resolveRunnerWorkspace
      ? await this.options.resolveRunnerWorkspace({ brief, ctx, request, actor })
      : {
          runner: this.createAgentDelegateRunner(),
          workspace: await this.resolveWorkspace(brief, ctx, request),
        }
    if (!resolved || !resolved.runner || typeof resolved.runner.run !== 'function') {
      throw new ManagedAgentMcpError(ErrorCode.enum.CONFIG_INVALID, 'MCP delegate requires a host-resolved runner')
    }
    if (!resolved.workspace || typeof resolved.workspace.stat !== 'function' || typeof resolved.workspace.readFile !== 'function') {
      throw new ManagedAgentMcpError(ErrorCode.enum.CONFIG_INVALID, 'MCP delegate requires a host-resolved Workspace')
    }
    return resolved
  }

  private createAgentDelegateRunner(): ManagedAgentDelegateRunner {
    const agent = this.options.agent
    if (!agent) {
      throw new ManagedAgentMcpError(ErrorCode.enum.CONFIG_INVALID, 'MCP delegate requires a host-resolved runner')
    }
    return {
      async *run(input) {
        const receipt = await agent.start({
          content: input.brief,
          actor: input.actor,
          ctx: input.ctx,
          originSurface: MANAGED_AGENT_MCP_ORIGIN_SURFACE,
        })
        input.onSessionStarted?.(receipt.sessionId)
        yield* agent.stream(receipt.sessionId, { startIndex: receipt.startIndex, ctx: input.ctx })
      },
      async stop(sessionId, ctx) {
        await agent.stop(sessionId, ctx)
      },
    }
  }

  private assertNotAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted) throw new ManagedAgentMcpError(ErrorCode.enum.ABORTED, 'delegation was cancelled')
  }

  private async stopDelegatedSession(
    runner: ManagedAgentDelegateRunner,
    sessionId: string,
    ctx: SessionCtx,
  ): Promise<void> {
    await Promise.resolve(runner.stop?.(sessionId, ctx)).catch(() => undefined)
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

  private validateFinalAssistantText(value: string): string {
    const byteSize = utf8ByteLength(value)
    if (byteSize > MAX_FINAL_ASSISTANT_TEXT_BYTES) {
      throw new ManagedAgentMcpError(
        ErrorCode.enum.MCP_AGENT_ARTIFACT_TOO_LARGE,
        `final assistant text must be ${MAX_FINAL_ASSISTANT_TEXT_BYTES} bytes or fewer`,
      )
    }
    if (looksLikeSinglePath(value)) {
      throw new ManagedAgentMcpError(
        ErrorCode.enum.MCP_AGENT_ARTIFACT_INVALID,
        'final assistant text must not be only an artifact path',
      )
    }
    return value
  }

  private async collectArtifacts(
    input: ManagedAgentCollectArtifactsInput,
    workspace: Workspace,
  ): Promise<ManagedAgentArtifact[]> {
    const supplied = await this.options.collectArtifacts?.(input)
    const rawCandidates = supplied ?? extractArtifactRefs(input.events)
    if (!Array.isArray(rawCandidates)) {
      throw new ManagedAgentMcpError(ErrorCode.enum.MCP_AGENT_ARTIFACT_INVALID, 'artifact references must be an array')
    }
    const candidates = rawCandidates.map((artifact: unknown) => normalizeArtifactCandidate(artifact))
    this.assertPublicPayloadSafe(candidates)
    if (candidates.length === 0) return []
    if (candidates.length > 1) {
      throw new ManagedAgentMcpError(
        ErrorCode.enum.MCP_AGENT_ARTIFACT_INVALID,
        'MCP delegate delivery supports at most one artifact',
      )
    }
    const artifact = await resolveMarkdownArtifact(candidates[0]!, workspace)
    this.assertPublicPayloadSafe(artifact)
    return [artifact]
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
    if (utf8ByteLength(serialized) > MAX_SERIALIZED_RESULT_BYTES) {
      throw new ManagedAgentMcpError(
        ErrorCode.enum.MCP_AGENT_ARTIFACT_TOO_LARGE,
        `MCP delegate result must be ${MAX_SERIALIZED_RESULT_BYTES} bytes or fewer`,
      )
    }
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

function extractArtifactRefs(events: readonly AgentEvent[]): ManagedAgentArtifactCandidate[] {
  const artifacts: ManagedAgentArtifactCandidate[] = []
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

function normalizeArtifactCandidate(artifact: unknown): ManagedAgentArtifactCandidate {
  if (!artifact || typeof artifact !== 'object') {
    throw new ManagedAgentMcpError(ErrorCode.enum.MCP_AGENT_ARTIFACT_INVALID, 'artifact reference is invalid')
  }
  const record = artifact as Record<string, unknown>
  if (record.content !== undefined) {
    throw new ManagedAgentMcpError(
      ErrorCode.enum.MCP_AGENT_ARTIFACT_INVALID,
      'artifact content must be resolved through the authorized workspace',
    )
  }
  if (record.truncated !== undefined) {
    throw new ManagedAgentMcpError(
      ErrorCode.enum.MCP_AGENT_ARTIFACT_INVALID,
      'artifact content must be complete and untruncated',
    )
  }
  const path = normalizeArtifactPath(record.path)
  const mediaType = optionalNonEmptyString(record.mediaType)
  if (mediaType !== undefined && mediaType.toLowerCase().split(';', 1)[0]?.trim() !== MARKDOWN_MEDIA_TYPE) {
    throw new ManagedAgentMcpError(ErrorCode.enum.MCP_AGENT_ARTIFACT_INVALID, 'artifact must be Markdown')
  }
  if (mediaType === undefined && !isMarkdownPath(path)) {
    throw new ManagedAgentMcpError(ErrorCode.enum.MCP_AGENT_ARTIFACT_INVALID, 'artifact must be Markdown')
  }
  const candidate: ManagedAgentArtifactCandidate = {
    path,
    mediaType: MARKDOWN_MEDIA_TYPE,
  }
  const title = optionalNonEmptyString(record.title)
  if (title !== undefined) candidate.title = title
  return candidate
}

function normalizeArtifactPath(path: unknown): string {
  if (typeof path !== 'string') throw new ManagedAgentMcpError(ErrorCode.enum.MCP_AGENT_ARTIFACT_INVALID, 'artifact path must be a string')
  const trimmed = path.trim()
  if (!trimmed) throw new ManagedAgentMcpError(ErrorCode.enum.MCP_AGENT_ARTIFACT_INVALID, 'artifact path is required')
  if (trimmed.includes('\0')) throw new ManagedAgentMcpError(ErrorCode.enum.MCP_AGENT_ARTIFACT_INVALID, 'artifact path is invalid')
  const decoded = safeDecodeArtifactPath(trimmed)
  const traversalCandidate = decoded.replace(/\\/g, '/')
  if (
    trimmed.startsWith('/') ||
    traversalCandidate.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(trimmed) ||
    /^[A-Za-z]:[\\/]/.test(traversalCandidate) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(trimmed)
  ) {
    throw new ManagedAgentMcpError(ErrorCode.enum.MCP_AGENT_ARTIFACT_INVALID, 'artifact path must be workspace-relative')
  }
  const parts = traversalCandidate.split('/')
  if (
    traversalCandidate.startsWith('~') ||
    traversalCandidate.startsWith('$') ||
    /[\r\n]/.test(traversalCandidate) ||
    parts.some((part) => part === '..' || part.startsWith('..'))
  ) {
    throw new ManagedAgentMcpError(ErrorCode.enum.MCP_AGENT_ARTIFACT_INVALID, 'artifact path must stay within the workspace')
  }
  const normalized = parts.filter((part) => part && part !== '.').join('/')
  if (!normalized) throw new ManagedAgentMcpError(ErrorCode.enum.MCP_AGENT_ARTIFACT_INVALID, 'artifact path is required')
  return normalized
}

async function resolveMarkdownArtifact(
  candidate: ManagedAgentArtifactCandidate,
  workspace: Workspace,
): Promise<ManagedAgentArtifact> {
  const { content, bytes, byteSize } = await readStableArtifact(candidate.path, workspace)
  validateMarkdownContent(content)
  const artifact: ManagedAgentArtifact = {
    content,
    sha256: sha256(bytes),
    byteSize,
    mediaType: MARKDOWN_MEDIA_TYPE,
    ...(candidate.title ? { title: candidate.title } : {}),
  }
  return artifact
}

async function readStableArtifact(path: string, workspace: Workspace): Promise<ResolvedArtifactBytes> {
  const before = await statArtifact(workspace, path)
  assertArtifactStat(before)
  if (before.size > MAX_ARTIFACT_BYTES) {
    throw new ManagedAgentMcpError(
      ErrorCode.enum.MCP_AGENT_ARTIFACT_TOO_LARGE,
      `artifact must be ${MAX_ARTIFACT_BYTES} bytes or fewer`,
    )
  }
  const read = await readArtifactContent(workspace, path)
  const after = await statArtifact(workspace, path)
  assertArtifactStat(after)
  if (!sameStat(before, after) || read.byteSize !== before.size) {
    throw new ManagedAgentMcpError(
      ErrorCode.enum.MCP_AGENT_ARTIFACT_UNAVAILABLE,
      'artifact changed while it was being read',
    )
  }
  if (read.byteSize > MAX_ARTIFACT_BYTES) {
    throw new ManagedAgentMcpError(
      ErrorCode.enum.MCP_AGENT_ARTIFACT_TOO_LARGE,
      `artifact must be ${MAX_ARTIFACT_BYTES} bytes or fewer`,
    )
  }
  return read
}

async function statArtifact(workspace: Workspace, path: string): Promise<Stat> {
  try {
    return await workspace.stat(path)
  } catch (error) {
    throw artifactReadError(error)
  }
}

function assertArtifactStat(stat: Stat): void {
  if (stat.kind !== 'file') {
    throw new ManagedAgentMcpError(ErrorCode.enum.MCP_AGENT_ARTIFACT_INVALID, 'artifact must be a file')
  }
  if (!Number.isFinite(stat.size) || stat.size < 0) {
    throw new ManagedAgentMcpError(ErrorCode.enum.MCP_AGENT_ARTIFACT_INVALID, 'artifact size is invalid')
  }
}

async function readArtifactContent(
  workspace: Workspace,
  path: string,
): Promise<{ content: string; bytes: Uint8Array; byteSize: number }> {
  try {
    if (!workspace.readBinaryFile) {
      throw new ManagedAgentMcpError(
        ErrorCode.enum.MCP_AGENT_ARTIFACT_UNAVAILABLE,
        'artifact bytes are unavailable through the authorized workspace',
      )
    }
    const bytes = await workspace.readBinaryFile(path)
    const content = decodeUtf8(bytes)
    return { content, bytes, byteSize: bytes.byteLength }
  } catch (error) {
    if (error instanceof ManagedAgentMcpError) throw error
    throw artifactReadError(error)
  }
}

function artifactReadError(error: unknown): ManagedAgentMcpError {
  const code = (error as { code?: unknown; reason?: unknown } | undefined)?.code
  const reason = (error as { code?: unknown; reason?: unknown } | undefined)?.reason
  if (
    code === ErrorCode.enum.PATH_ESCAPE ||
    code === ErrorCode.enum.PATH_ABSOLUTE ||
    code === ErrorCode.enum.PATH_NULL_BYTE ||
    code === ErrorCode.enum.PATH_SYMLINK_ESCAPE ||
    reason === 'path-escape' ||
    reason === 'absolute-path' ||
    reason === 'null-byte' ||
    reason === 'symlink-escape'
  ) {
    return new ManagedAgentMcpError(ErrorCode.enum.MCP_AGENT_ARTIFACT_INVALID, 'artifact path is invalid')
  }
  return new ManagedAgentMcpError(ErrorCode.enum.MCP_AGENT_ARTIFACT_UNAVAILABLE, 'artifact is unavailable')
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return strictUtf8Decoder.decode(bytes)
  } catch {
    throw new ManagedAgentMcpError(ErrorCode.enum.MCP_AGENT_ARTIFACT_INVALID, 'artifact must be well-formed UTF-8')
  }
}

function validateMarkdownContent(content: string): void {
  if (!content.trim()) {
    throw new ManagedAgentMcpError(ErrorCode.enum.MCP_AGENT_ARTIFACT_INVALID, 'artifact Markdown must not be empty')
  }
  for (let index = 0; index < content.length; index += 1) {
    const code = content.charCodeAt(index)
    if (code === 0 || (code < 32 && code !== 9 && code !== 10 && code !== 13)) {
      throw new ManagedAgentMcpError(ErrorCode.enum.MCP_AGENT_ARTIFACT_INVALID, 'artifact must be text Markdown')
    }
  }
}

function sameStat(left: Stat, right: Stat): boolean {
  return left.kind === right.kind && left.size === right.size && left.mtimeMs === right.mtimeMs
}

function sha256(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

function safeDecodeArtifactPath(path: string): string {
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

function utf8ByteLength(value: string): number {
  return utf8Encoder.encode(value).byteLength
}

function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path)
}

function looksLikeSinglePath(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed || /\s/.test(trimmed)) return false
  if (!isMarkdownPath(trimmed)) return false
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(trimmed)) return true
  if (trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed)) return true
  return trimmed.includes('/') || trimmed.includes('\\')
}

function optionalNonEmptyString(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function sameSessionCtx(a: SessionCtx, b: SessionCtx): boolean {
  return (a.workspaceId ?? '') === (b.workspaceId ?? '') && (a.userId ?? '') === (b.userId ?? '')
}

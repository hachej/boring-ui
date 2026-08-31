import type { PiChatEvent } from './chat'
import type { ErrorCode } from './error-codes'
import type { AgentCoreHarnessFactory } from './harness'
import type { SessionCtx, SessionStore } from './session'
import type { TelemetrySink } from './telemetry'
import type { AgentTool } from './tool'

export const AGENT_NOT_IMPLEMENTED_UNTIL_T1 = 'ERR_NOT_IMPLEMENTED_UNTIL_T1' as const satisfies ErrorCode

export interface MessageAttachment {
  filename?: string
  mediaType?: string
  /** data: URL or remote URL */
  url: string
}

export interface AgentActor {
  id?: string
  name?: string
}

export interface AgentMessagePart {
  type: string
  text?: string
  [key: string]: unknown
}

export type AgentMessageContent = string | AgentMessagePart[]

export interface AgentSendInput {
  sessionId?: string
  content?: AgentMessageContent
  /** @deprecated Use content. Present for the P1 SendMessageInput rename window. */
  message?: string
  attachments?: MessageAttachment[]
  actor?: AgentActor
  ctx?: SessionCtx
  originSurface?: string
  thinkingLevel?: 'off' | 'low' | 'medium' | 'high'
  model?: {
    provider: string
    id: string
  }
}

export interface AgentStartReceipt {
  sessionId: string
  startIndex: number
}

export interface AgentStreamOptions {
  startIndex: number
  ctx?: SessionCtx
}

export interface AgentEvent {
  v: 1
  eventIndex: number
  timestamp: number
  sessionId: string
  chunk: PiChatEvent
}

export interface SessionStreamIdentity {
  readonly workspaceScopeId: string
  readonly sessionId: string
}

/** Kept here so every durable session path grammar has one source of truth. */
export const SESSION_STREAM_PREFIX = 'sessions/'
const V1_QUARANTINE_STREAM_PREFIX = 'quarantine/v1/'

export function sessionStreamPath(identity: SessionStreamIdentity): string {
  assertIdentitySegment('workspaceScopeId', identity?.workspaceScopeId)
  assertIdentitySegment('sessionId', identity?.sessionId)
  return `${SESSION_STREAM_PREFIX}${encodeIdentitySegment(identity.workspaceScopeId)}/${encodeIdentitySegment(identity.sessionId)}`
}

/** Total parser: malformed or non-canonical paths return null, never throw. */
export function parseSessionStreamPath(path: string): SessionStreamIdentity | null {
  if (typeof path !== 'string' || !path.startsWith(SESSION_STREAM_PREFIX)) return null
  const segments = path.slice(SESSION_STREAM_PREFIX.length).split('/')
  if (segments.length !== 2) return null
  const workspaceScopeId = decodeIdentitySegment(segments[0] ?? '')
  const sessionId = decodeIdentitySegment(segments[1] ?? '')
  if (workspaceScopeId === null || sessionId === null) return null
  return { workspaceScopeId, sessionId }
}

/** Migration-only destination for v1 paths that cannot safely claim a v2 key. */
export function quarantineV1EventStreamPath(oldPath: string): string {
  return `${V1_QUARANTINE_STREAM_PREFIX}${encodeIdentitySegment(oldPath)}`
}

/** Migration-only destination when a legacy SQL path has no encodable text identity. */
export function quarantineV1EventStreamRowidPath(rowid: number): string {
  if (!Number.isSafeInteger(rowid) || rowid <= 0) {
    throw new TypeError('Legacy event stream rowid must be a positive safe integer.')
  }
  return `${V1_QUARANTINE_STREAM_PREFIX}rowid-${rowid}`
}

function assertIdentitySegment(name: keyof SessionStreamIdentity, value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`Session stream ${name} must be a non-empty string.`)
  }
  if (!isWellFormedUnicode(value)) {
    throw new TypeError(`Session stream ${name} must contain well-formed Unicode.`)
  }
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xDC00 && next <= 0xDFFF)) return false
      index += 1
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      return false
    }
  }
  return true
}

function encodeIdentitySegment(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*~]/g, (character) => (
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  ))
}

function decodeIdentitySegment(value: string): string | null {
  if (value.length === 0) return null
  try {
    const decoded = decodeURIComponent(value)
    if (decoded.length === 0 || encodeIdentitySegment(decoded) !== value) return null
    return decoded
  } catch {
    return null
  }
}

export interface AgentResolveInputResponse {
  approved?: boolean
  content?: string
  value?: unknown
}

export interface AgentRuntimeAdapter {
  readonly id: string
  dispose?(): void | Promise<void>
}

export interface AgentReadinessStatus {
  key: string
  ready: boolean
  state?: 'not-started' | 'preparing' | 'ready' | 'failed'
  errorCode?: string
  causeCode?: string
  retryable?: boolean
  workspaceId?: string
  message?: string
}

export interface AgentReadiness {
  requirements: string[]
  status(): Promise<AgentReadinessStatus[]>
}

export interface AgentConfig {
  harnessFactory?: AgentCoreHarnessFactory
  runtime: AgentRuntimeAdapter
  tools?: AgentTool[]
  readiness?: AgentReadiness
  readinessRequirements?: string[]
  sessions?: SessionStore
  systemPromptAppend?: string
  systemPromptDynamic?: () => string | undefined | Promise<string | undefined>
  telemetry?: TelemetrySink
  metering?: unknown
  sessionStorageRoot?: string
  workdir?: string
}

export interface Agent {
  start(input: AgentSendInput): Promise<AgentStartReceipt>
  stream(sessionId: string, options: AgentStreamOptions): AsyncIterable<AgentEvent>
  send(input: AgentSendInput): AsyncIterable<AgentEvent>
  resolveInput(sessionId: string, requestId: string, response: AgentResolveInputResponse): Promise<never>
  interrupt(sessionId: string, ctx?: SessionCtx): Promise<unknown>
  stop(sessionId: string, ctx?: SessionCtx): Promise<unknown>
  sessions: SessionStore
  readiness: AgentReadiness
  dispose(): Promise<void>
}

export class AgentNotImplementedError extends Error {
  readonly code = AGENT_NOT_IMPLEMENTED_UNTIL_T1

  constructor(message = 'This agent capability is not implemented until T1.') {
    super(message)
    this.name = 'AgentNotImplementedError'
  }
}

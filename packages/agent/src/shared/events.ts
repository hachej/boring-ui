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
  /** Used only when creating a new session; otherwise the first prompt becomes its title. */
  sessionTitle?: string
  /** Reject an unavailable explicit model instead of falling back to the Pi default. */
  strictModel?: boolean
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

export function sessionStreamPath(sessionId: string): string {
  return `sessions/${sessionId}`
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

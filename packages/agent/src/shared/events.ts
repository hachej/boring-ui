import type { PiChatEvent } from './chat'
import type { ResolvedEnvironment } from './capabilities'
import type { ErrorCode } from './error-codes'
import type { AgentCoreHarnessFactory } from './harness'
import type { SessionCtx, SessionStore } from './session'
import type { TelemetrySink } from './telemetry'
import type { AgentTool } from './tool'

export const AGENT_NOT_IMPLEMENTED_UNTIL_T1 = 'ERR_NOT_IMPLEMENTED_UNTIL_T1' as const satisfies ErrorCode
export const AGENT_NO_FILESYSTEM_FOR_ATTACHMENTS = 'ERR_NO_FILESYSTEM_FOR_ATTACHMENTS' as const satisfies ErrorCode

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
  message?: string
}

export interface AgentReadiness {
  requirements: string[]
  status(): Promise<AgentReadinessStatus[]>
}

export interface AgentConfig {
  harnessFactory?: AgentCoreHarnessFactory
  runtime: AgentRuntimeAdapter | 'none'
  /**
   * Resolved environment facts used by core behavior checks. runtimeMode is
   * intentionally not part of this core input; it remains diagnostic.
   */
  environments?: readonly ResolvedEnvironment[]
  /** Provider + host-policy fact for direct model input assets. */
  providerDirectInputAssets?: boolean
  tools?: AgentTool[]
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

export class AgentFilesystemRequiredError extends Error {
  readonly code = AGENT_NO_FILESYSTEM_FOR_ATTACHMENTS
  readonly statusCode = 400

  constructor(message = 'Attachments require a filesystem-backed agent runtime.') {
    super(message)
    this.name = 'AgentFilesystemRequiredError'
  }
}

import { WorkspaceBridgeErrorCode, type BridgeActorAttribution, type BridgeCallerClass, type WorkspaceBridgeError } from "../../shared/workspace-bridge-rpc"

export type WorkspaceBridgeAuditOutcome = "success" | "denied" | "failed" | "timeout" | "rate-limited"

export interface WorkspaceBridgeAuditEvent {
  requestId?: string
  op: string
  workspaceId: string
  sessionId?: string
  callerClass: BridgeCallerClass
  actorKind: BridgeActorAttribution["actorKind"]
  performedBy?: { label: string; id?: string }
  onBehalfOf?: { label: string; id?: string }
  pluginId?: string
  runtimeId?: string
  capabilities?: readonly string[]
  capabilityDecision?: "allowed" | "denied"
  rateLimitDecision?: "allowed" | "denied"
  outcome: WorkspaceBridgeAuditOutcome
  error?: WorkspaceBridgeError
  durationMs?: number
  inputBytes?: number
  outputBytes?: number
  details?: Record<string, unknown>
}

export interface WorkspaceBridgeAuditSink {
  emit(event: WorkspaceBridgeAuditEvent): void | Promise<void>
}

export interface RateLimitDecision {
  allowed: boolean
  retryAfterMs?: number
  reason?: string
}

export interface RateLimitPolicy {
  check(input: WorkspaceBridgeRateLimitInput): RateLimitDecision | Promise<RateLimitDecision>
}

export interface WorkspaceBridgeRateLimitInput {
  key: string
  workspaceId: string
  sessionId?: string
  principalId?: string
  pluginId?: string
  runtimeId?: string
  callerClass: BridgeCallerClass
  op: string
}

export class InMemoryWorkspaceBridgeAuditSink implements WorkspaceBridgeAuditSink {
  readonly events: WorkspaceBridgeAuditEvent[] = []
  emit(event: WorkspaceBridgeAuditEvent): void {
    this.events.push(redactWorkspaceBridgeAuditEvent(event))
  }
}

export class SimpleWorkspaceBridgeRateLimitPolicy implements RateLimitPolicy {
  private readonly hits = new Map<string, number[]>()
  constructor(private readonly maxHits: number, private readonly windowMs: number) {}
  check(input: WorkspaceBridgeRateLimitInput): RateLimitDecision {
    const now = Date.now()
    const hits = (this.hits.get(input.key) ?? []).filter((ts) => now - ts < this.windowMs)
    if (hits.length >= this.maxHits) {
      this.hits.set(input.key, hits)
      return { allowed: false, retryAfterMs: this.windowMs - (now - hits[0]), reason: "rate-limit" }
    }
    hits.push(now)
    this.hits.set(input.key, hits)
    return { allowed: true }
  }
}

export function createWorkspaceBridgeRateLimitKey(input: Omit<WorkspaceBridgeRateLimitInput, "key">): string {
  return [
    input.workspaceId,
    input.sessionId ?? "-",
    input.principalId ?? "-",
    input.pluginId ?? "-",
    input.runtimeId ?? "-",
    input.callerClass,
    input.op,
  ].join(":")
}

export function redactWorkspaceBridgeAuditEvent(event: WorkspaceBridgeAuditEvent): WorkspaceBridgeAuditEvent {
  return redactValue(event) as WorkspaceBridgeAuditEvent
}

export function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redactString(value)
  if (Array.isArray(value)) return value.map(redactValue)
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      if (isSensitiveKey(key)) out[key] = "[REDACTED]"
      else out[key] = redactValue(child)
    }
    return out
  }
  return value
}

export function auditOutcomeForError(code: WorkspaceBridgeErrorCode): WorkspaceBridgeAuditOutcome {
  if (code === WorkspaceBridgeErrorCode.RateLimited) return "rate-limited"
  if (code === WorkspaceBridgeErrorCode.Timeout) return "timeout"
  if (
    code === WorkspaceBridgeErrorCode.AuthRequired ||
    code === WorkspaceBridgeErrorCode.CapabilityDenied ||
    code === WorkspaceBridgeErrorCode.CallerNotAllowed ||
    code === WorkspaceBridgeErrorCode.ResourceScopeDenied ||
    code === WorkspaceBridgeErrorCode.InvalidToken ||
    code === WorkspaceBridgeErrorCode.ExpiredToken
  ) return "denied"
  return "failed"
}

function isSensitiveKey(key: string): boolean {
  return /token|authorization|answer|payload|content|stack|secret|password|nonce|hostPath|fileAssetPath|assetPath|rawPath/i.test(key)
}

function redactString(value: string): string {
  return value
    .replace(/Authorization:\s*Bearer\s+[^\s"']+/gi, "Authorization: Bearer [REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~-]{8,}/g, "Bearer [REDACTED]")
    .replace(/\/home\/[A-Za-z0-9._/-]+/g, "[REDACTED_PATH]")
    .replace(/generated\/[A-Za-z0-9._/-]+/g, "[REDACTED_PATH]")
    .replace(/\n\s*at\s+[^\n]+/g, "\n    at [REDACTED_STACK]")
}

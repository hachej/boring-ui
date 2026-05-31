import { createHash } from "node:crypto"
import {
  WorkspaceBridgeErrorCode,
  createWorkspaceBridgeError,
  type BridgeAuthContext,
  type WorkspaceBridgeCallRequest,
  type WorkspaceBridgeCallResponse,
  type WorkspaceBridgeError,
  type WorkspaceBridgeOperationDefinition,
} from "../../shared/workspace-bridge-rpc"

export type IdempotencyRecordStatus = "pending" | "completed"

export interface WorkspaceBridgeIdempotencyRecord<TOutput = unknown> {
  scopeKey: string
  inputHash: string
  status: IdempotencyRecordStatus
  createdAt: string
  updatedAt: string
  expiresAt: string
  response?: WorkspaceBridgeCallResponse<TOutput>
}

export type IdempotencyBeginResult<TOutput = unknown> =
  | { action: "execute"; scopeKey: string; inputHash: string }
  | { action: "replay"; record: WorkspaceBridgeIdempotencyRecord<TOutput> }
  | { action: "reject"; error: WorkspaceBridgeError }

export interface BeginIdempotencyOptions<TInput = unknown> {
  definition: WorkspaceBridgeOperationDefinition<TInput, unknown>
  request: WorkspaceBridgeCallRequest<TInput>
  auth: Pick<BridgeAuthContext, "workspaceId" | "sessionId" | "pluginId" | "tokenId">
  nowMs?: number
  ttlMs?: number
}

export interface CompleteIdempotencyOptions<TOutput = unknown> {
  scopeKey: string
  inputHash: string
  response: WorkspaceBridgeCallResponse<TOutput>
  nowMs?: number
  ttlMs?: number
}

export interface WorkspaceBridgeIdempotencyStore {
  begin<TInput = unknown, TOutput = unknown>(
    options: BeginIdempotencyOptions<TInput>,
  ): Promise<IdempotencyBeginResult<TOutput>>
  complete<TOutput = unknown>(options: CompleteIdempotencyOptions<TOutput>): Promise<void>
  /**
   * Release a pending record so the same key can be retried. Used when a
   * mutation fails transiently: caching the failure would otherwise block
   * legitimate same-key retries until the record's TTL expires.
   */
  release(scopeKey: string, inputHash: string): Promise<void>
  gc(nowMs?: number): Promise<number>
}

export class InMemoryWorkspaceBridgeIdempotencyStore implements WorkspaceBridgeIdempotencyStore {
  private readonly records = new Map<string, WorkspaceBridgeIdempotencyRecord>()

  async begin<TInput, TOutput>(
    options: BeginIdempotencyOptions<TInput>,
  ): Promise<IdempotencyBeginResult<TOutput>> {
    const prepared = prepareIdempotency(options)
    if ("error" in prepared) return { action: "reject", error: prepared.error }
    const nowMs = options.nowMs ?? Date.now()
    const existing = this.records.get(prepared.scopeKey)
    if (existing && Date.parse(existing.expiresAt) > nowMs) {
      if (existing.inputHash !== prepared.inputHash) {
        return { action: "reject", error: replayRejectedError() }
      }
      return { action: "replay", record: existing as WorkspaceBridgeIdempotencyRecord<TOutput> }
    }
    this.records.set(prepared.scopeKey, createPendingRecord(prepared.scopeKey, prepared.inputHash, nowMs, options.ttlMs))
    return { action: "execute", scopeKey: prepared.scopeKey, inputHash: prepared.inputHash }
  }

  async complete<TOutput>(options: CompleteIdempotencyOptions<TOutput>): Promise<void> {
    const existing = this.records.get(options.scopeKey)
    if (!existing || existing.inputHash !== options.inputHash) return
    const nowMs = options.nowMs ?? Date.now()
    this.records.set(options.scopeKey, {
      ...existing,
      // Only successful responses are completed; failures release the key
      // (see runWithWorkspaceBridgeIdempotency), so there is no "failed" record.
      status: "completed",
      response: options.response,
      updatedAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + (options.ttlMs ?? DEFAULT_IDEMPOTENCY_TTL_MS)).toISOString(),
    })
  }

  async release(scopeKey: string, inputHash: string): Promise<void> {
    const existing = this.records.get(scopeKey)
    if (existing && existing.inputHash === inputHash) this.records.delete(scopeKey)
  }

  async gc(nowMs = Date.now()): Promise<number> {
    let removed = 0
    for (const [key, record] of this.records) {
      if (Date.parse(record.expiresAt) <= nowMs) {
        this.records.delete(key)
        removed++
      }
    }
    return removed
  }

}

export async function runWithWorkspaceBridgeIdempotency<TInput, TOutput>(
  store: WorkspaceBridgeIdempotencyStore | undefined,
  options: BeginIdempotencyOptions<TInput>,
  execute: () => Promise<WorkspaceBridgeCallResponse<TOutput>>,
): Promise<WorkspaceBridgeCallResponse<TOutput>> {
  if (options.definition.idempotencyPolicy === "none") return await execute()
  if (!store) {
    return {
      ok: false,
      op: options.definition.op,
      requestId: options.request.requestId,
      error: createWorkspaceBridgeError(
        WorkspaceBridgeErrorCode.UnsupportedRuntime,
        "WorkspaceBridge mutation requires an atomic idempotency store",
      ),
    }
  }
  const begin = await store.begin<TInput, TOutput>(options)
  if (begin.action === "reject") {
    return { ok: false, op: options.definition.op, requestId: options.request.requestId, error: begin.error }
  }
  if (begin.action === "replay") {
    return begin.record.response ?? {
      ok: false,
      op: options.definition.op,
      requestId: options.request.requestId,
      error: createWorkspaceBridgeError(
        WorkspaceBridgeErrorCode.IdempotencyConflict,
        "WorkspaceBridge idempotency key is already pending",
      ),
    }
  }
  const response = await execute()
  if (response.ok) {
    await store.complete({
      scopeKey: begin.scopeKey,
      inputHash: begin.inputHash,
      response,
      nowMs: options.nowMs,
      ttlMs: options.ttlMs,
    })
  } else {
    // Do not memoize failures: release the key so a retry with the same
    // idempotency key can re-execute instead of replaying the cached failure
    // for the record's TTL. A deterministic failure simply fails again.
    await store.release(begin.scopeKey, begin.inputHash)
  }
  return response
}

const DEFAULT_IDEMPOTENCY_TTL_MS = 15 * 60_000

function prepareIdempotency<TInput>(options: BeginIdempotencyOptions<TInput>):
  | { scopeKey: string; inputHash: string }
  | { error: WorkspaceBridgeError } {
  const key = semanticKey(options)
  if (!key) {
    return {
      error: createWorkspaceBridgeError(
        WorkspaceBridgeErrorCode.IdempotencyRequired,
        "WorkspaceBridge operation requires an idempotency key",
      ),
    }
  }
  return {
    scopeKey: stableStringify({
      workspaceId: options.auth.workspaceId,
      sessionId: options.auth.sessionId,
      pluginId: options.auth.pluginId,
      op: options.definition.op,
      key,
    }),
    inputHash: hashNormalizedInput(options.request.input),
  }
}

function semanticKey<TInput>(options: BeginIdempotencyOptions<TInput>): string | undefined {
  if (options.definition.idempotencyPolicy === "none") return "none"
  if (options.definition.idempotencyPolicy === "required") return options.request.idempotencyKey
  if (options.definition.idempotencyPolicy === "request-id") return options.request.requestId ?? options.request.idempotencyKey
  return undefined
}

export function hashNormalizedInput(input: unknown): string {
  return hashString(stableStringify(input))
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(",")}}`
}

function createPendingRecord(
  scopeKey: string,
  inputHash: string,
  nowMs: number,
  ttlMs = DEFAULT_IDEMPOTENCY_TTL_MS,
): WorkspaceBridgeIdempotencyRecord {
  const now = new Date(nowMs).toISOString()
  return {
    scopeKey,
    inputHash,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(nowMs + ttlMs).toISOString(),
  }
}

function replayRejectedError(): WorkspaceBridgeError {
  return createWorkspaceBridgeError(
    WorkspaceBridgeErrorCode.ReplayRejected,
    "WorkspaceBridge idempotency key was reused with a different payload",
  )
}

function hashString(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

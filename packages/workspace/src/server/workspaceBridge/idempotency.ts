import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import {
  WorkspaceBridgeErrorCode,
  createWorkspaceBridgeError,
  type BridgeAuthContext,
  type WorkspaceBridgeCallRequest,
  type WorkspaceBridgeCallResponse,
  type WorkspaceBridgeError,
  type WorkspaceBridgeOperationDefinition,
} from "../../shared/workspace-bridge-rpc"

export type IdempotencyRecordStatus = "pending" | "completed" | "failed"

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
  oneShot?: boolean
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
      status: options.response.ok ? "completed" : "failed",
      response: options.response,
      updatedAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + (options.ttlMs ?? DEFAULT_IDEMPOTENCY_TTL_MS)).toISOString(),
    })
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

  snapshot(): WorkspaceBridgeIdempotencyRecord[] {
    return Array.from(this.records.values())
  }
}

export class FileWorkspaceBridgeIdempotencyStore implements WorkspaceBridgeIdempotencyStore {
  private readonly dir: string
  private readonly locks = new Map<string, Promise<unknown>>()

  constructor(dir: string) {
    this.dir = dir
  }

  async begin<TInput, TOutput>(
    options: BeginIdempotencyOptions<TInput>,
  ): Promise<IdempotencyBeginResult<TOutput>> {
    const prepared = prepareIdempotency(options)
    if ("error" in prepared) return { action: "reject", error: prepared.error }
    return this.withKeyLock(prepared.scopeKey, async () => {
      const nowMs = options.nowMs ?? Date.now()
      const existing = await this.readRecord(prepared.scopeKey)
      if (existing && Date.parse(existing.expiresAt) > nowMs) {
        if (existing.inputHash !== prepared.inputHash) {
          return { action: "reject", error: replayRejectedError() }
        }
        return { action: "replay", record: existing as WorkspaceBridgeIdempotencyRecord<TOutput> }
      }
      await this.writeRecord(createPendingRecord(prepared.scopeKey, prepared.inputHash, nowMs, options.ttlMs))
      return { action: "execute", scopeKey: prepared.scopeKey, inputHash: prepared.inputHash }
    })
  }

  async complete<TOutput>(options: CompleteIdempotencyOptions<TOutput>): Promise<void> {
    await this.withKeyLock(options.scopeKey, async () => {
      const existing = await this.readRecord(options.scopeKey)
      if (!existing || existing.inputHash !== options.inputHash) return
      const nowMs = options.nowMs ?? Date.now()
      await this.writeRecord({
        ...existing,
        status: options.response.ok ? "completed" : "failed",
        response: options.response,
        updatedAt: new Date(nowMs).toISOString(),
        expiresAt: new Date(nowMs + (options.ttlMs ?? DEFAULT_IDEMPOTENCY_TTL_MS)).toISOString(),
      })
    })
  }

  async gc(nowMs = Date.now()): Promise<number> {
    await mkdir(this.dir, { recursive: true })
    const files = await readdir(this.dir)
    let removed = 0
    for (const file of files) {
      if (!file.endsWith(".json")) continue
      const path = join(this.dir, file)
      try {
        const record = JSON.parse(await readFile(path, "utf8")) as WorkspaceBridgeIdempotencyRecord
        if (Date.parse(record.expiresAt) <= nowMs) {
          await unlink(path)
          removed++
        }
      } catch {
        // Ignore corrupt files here; later implementation may quarantine.
      }
    }
    return removed
  }

  private async readRecord(scopeKey: string): Promise<WorkspaceBridgeIdempotencyRecord | null> {
    try {
      return JSON.parse(await readFile(this.recordPath(scopeKey), "utf8")) as WorkspaceBridgeIdempotencyRecord
    } catch {
      return null
    }
  }

  private async writeRecord(record: WorkspaceBridgeIdempotencyRecord): Promise<void> {
    const path = this.recordPath(record.scopeKey)
    await mkdir(dirname(path), { recursive: true })
    const tmp = `${path}.${randomUUID()}.tmp`
    await writeFile(tmp, `${JSON.stringify(record)}\n`, "utf8")
    await rename(tmp, path)
  }

  private recordPath(scopeKey: string): string {
    return join(this.dir, `${hashString(scopeKey)}.json`)
  }

  private async withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve()
    let release!: () => void
    const next = new Promise<void>((resolve) => { release = resolve })
    this.locks.set(key, previous.then(() => next, () => next))
    await previous.catch(() => undefined)
    try {
      return await fn()
    } finally {
      release()
      if (this.locks.get(key) === next) this.locks.delete(key)
    }
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
  await store.complete({
    scopeKey: begin.scopeKey,
    inputHash: begin.inputHash,
    response,
    nowMs: options.nowMs,
    ttlMs: options.ttlMs,
  })
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
  if (options.definition.idempotencyPolicy === "tool-call-id") {
    const input = options.request.input
    return getStringProperty(input, "toolCallId") ?? options.request.idempotencyKey ?? options.request.requestId
  }
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

function getStringProperty(value: unknown, key: string): string | undefined {
  return value && typeof value === "object" && typeof (value as Record<string, unknown>)[key] === "string"
    ? (value as Record<string, string>)[key]
    : undefined
}

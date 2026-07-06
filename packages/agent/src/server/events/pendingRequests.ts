import { join } from 'node:path'
import type { PendingInputRequest } from '../../shared/events'
import type { SessionCtx } from '../../shared/session'
import { openDatabase, type OpenDatabaseResult, type RunTransaction, type SqlStorage } from './sqlStorage'

export interface PendingInputCreate {
  sessionId: string
  requestId: string
  ctx?: SessionCtx
  auth?: PendingInputAuth
  kind: 'approval' | 'input'
  toolName?: string
  toolCallId?: string
  schema?: Record<string, unknown>
  payload?: unknown
  createdAt?: string
}

export interface PendingInputAuth {
  userEmail?: string
  userEmailVerified?: boolean
}

export type PendingInputRecord = PendingInputRequest & {
  ctx?: SessionCtx
  auth?: PendingInputAuth
  payload?: unknown
}

export interface PendingInputStore {
  create(request: PendingInputCreate): Promise<PendingInputRecord>
  list(ctx: SessionCtx, opts?: { sessionId?: string }): Promise<PendingInputRequest[]>
  get(sessionId: string, requestId: string): Promise<PendingInputRecord | undefined>
  resolve(sessionId: string, requestId: string): Promise<PendingInputRecord | undefined>
  clearSession(ctx: SessionCtx, sessionId: string): Promise<number>
  hasPending(ctx: SessionCtx, sessionId: string): Promise<boolean>
}

export interface PendingInputStoreHandle {
  store: PendingInputStore
  close(): void
}

const CREATE_PENDING_REQUESTS_TABLE = `
CREATE TABLE IF NOT EXISTS boring_pending_requests (
  session_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  workspace_id TEXT,
  user_id TEXT,
  user_email TEXT,
  user_email_verified INTEGER,
  kind TEXT NOT NULL,
  tool_call_id TEXT,
  tool_name TEXT,
  schema_json TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (session_id, request_id)
)`

export class MemoryPendingInputStore implements PendingInputStore {
  private readonly rows = new Map<string, PendingInputRecord>()

  async create(request: PendingInputCreate): Promise<PendingInputRecord> {
    const record = normalizeCreate(request)
    this.rows.set(keyFor(record.sessionId, record.requestId), record)
    return cloneRecord(record) as PendingInputRecord
  }

  async list(ctx: SessionCtx, opts: { sessionId?: string } = {}): Promise<PendingInputRequest[]> {
    return [...this.rows.values()]
      .filter((row) => sameCtx(row.ctx, ctx))
      .filter((row) => opts.sessionId === undefined || row.sessionId === opts.sessionId)
      .sort(comparePendingRecords)
      .map(redactedRecord)
  }

  async get(sessionId: string, requestId: string): Promise<PendingInputRecord | undefined> {
    return cloneRecord(this.rows.get(keyFor(sessionId, requestId)))
  }

  async resolve(sessionId: string, requestId: string): Promise<PendingInputRecord | undefined> {
    const key = keyFor(sessionId, requestId)
    const record = this.rows.get(key)
    if (!record) return undefined
    this.rows.delete(key)
    return cloneRecord(record)
  }

  async clearSession(ctx: SessionCtx, sessionId: string): Promise<number> {
    let cleared = 0
    for (const [key, row] of this.rows.entries()) {
      if (row.sessionId !== sessionId || !sameCtx(row.ctx, ctx)) continue
      this.rows.delete(key)
      cleared += 1
    }
    return cleared
  }

  async hasPending(ctx: SessionCtx, sessionId: string): Promise<boolean> {
    return this.list(ctx, { sessionId }).then((rows) => rows.length > 0)
  }
}

export class SqlitePendingInputStore implements PendingInputStore {
  constructor(
    private readonly sql: SqlStorage,
    private readonly runTransaction: RunTransaction,
  ) {
    sql.exec(CREATE_PENDING_REQUESTS_TABLE)
    ensureColumn(sql, 'user_email', 'TEXT')
    ensureColumn(sql, 'user_email_verified', 'INTEGER')
  }

  async create(request: PendingInputCreate): Promise<PendingInputRecord> {
    const record = normalizeCreate(request)
    this.runTransaction(() => {
      this.sql.exec(`
        INSERT INTO boring_pending_requests (
          session_id,
          request_id,
          workspace_id,
          user_id,
          user_email,
          user_email_verified,
          kind,
          tool_call_id,
          tool_name,
          schema_json,
          payload_json,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id, request_id) DO UPDATE SET
          workspace_id = excluded.workspace_id,
          user_id = excluded.user_id,
          user_email = excluded.user_email,
          user_email_verified = excluded.user_email_verified,
          kind = excluded.kind,
          tool_call_id = excluded.tool_call_id,
          tool_name = excluded.tool_name,
          schema_json = excluded.schema_json,
          payload_json = excluded.payload_json,
          created_at = excluded.created_at
      `,
        record.sessionId,
        record.requestId,
        record.ctx?.workspaceId ?? null,
        record.ctx?.userId ?? null,
        record.auth?.userEmail ?? null,
        record.auth?.userEmailVerified === undefined ? null : record.auth.userEmailVerified ? 1 : 0,
        record.kind,
        record.toolCallId ?? null,
        record.toolName ?? null,
        record.schema ? JSON.stringify(record.schema) : null,
        record.payload === undefined ? null : JSON.stringify(record.payload),
        record.createdAt,
      )
    })
    return cloneRecord(record) as PendingInputRecord
  }

  async list(ctx: SessionCtx, opts: { sessionId?: string } = {}): Promise<PendingInputRequest[]> {
    const rows = this.sql.exec(`
      SELECT session_id, request_id, kind, tool_call_id, tool_name, schema_json, created_at
      FROM boring_pending_requests
      WHERE workspace_id IS ? AND user_id IS ?
        AND (? IS NULL OR session_id = ?)
      ORDER BY created_at ASC, request_id ASC
    `,
      ctx.workspaceId ?? null,
      ctx.userId ?? null,
      opts.sessionId ?? null,
      opts.sessionId ?? null,
    ).toArray()
    return rows.map((row) => redactedRecord(rowToRecord(row)))
  }

  async get(sessionId: string, requestId: string): Promise<PendingInputRecord | undefined> {
    const row = this.sql.exec(`
      SELECT *
      FROM boring_pending_requests
      WHERE session_id = ? AND request_id = ?
      LIMIT 1
    `, sessionId, requestId).toArray()[0]
    return row ? rowToRecord(row) : undefined
  }

  async resolve(sessionId: string, requestId: string): Promise<PendingInputRecord | undefined> {
    return this.runTransaction(() => {
      const row = this.sql.exec(`
        SELECT *
        FROM boring_pending_requests
        WHERE session_id = ? AND request_id = ?
        LIMIT 1
      `, sessionId, requestId).toArray()[0]
      if (!row) return undefined
      this.sql.exec(`
        DELETE FROM boring_pending_requests
        WHERE session_id = ? AND request_id = ?
      `, sessionId, requestId)
      return rowToRecord(row)
    })
  }

  async clearSession(ctx: SessionCtx, sessionId: string): Promise<number> {
    return this.runTransaction(() => {
      const row = this.sql.exec(`
        SELECT COUNT(*) AS count
        FROM boring_pending_requests
        WHERE workspace_id IS ? AND user_id IS ? AND session_id = ?
      `, ctx.workspaceId ?? null, ctx.userId ?? null, sessionId).toArray()[0]
      this.sql.exec(`
        DELETE FROM boring_pending_requests
        WHERE workspace_id IS ? AND user_id IS ? AND session_id = ?
      `, ctx.workspaceId ?? null, ctx.userId ?? null, sessionId)
      return typeof row?.count === 'number' ? row.count : Number(row?.count ?? 0)
    })
  }

  async hasPending(ctx: SessionCtx, sessionId: string): Promise<boolean> {
    const row = this.sql.exec(`
      SELECT 1 AS present
      FROM boring_pending_requests
      WHERE workspace_id IS ? AND user_id IS ? AND session_id = ?
      LIMIT 1
    `, ctx.workspaceId ?? null, ctx.userId ?? null, sessionId).toArray()[0]
    return row !== undefined
  }
}

export function openPendingInputStore(rootDir: string): PendingInputStoreHandle {
  return openPendingInputStoreAt(join(rootDir, 'state.db'))
}

export function openPendingInputStoreAt(path: string): PendingInputStoreHandle {
  const database: OpenDatabaseResult = openDatabase(path)
  return {
    store: new SqlitePendingInputStore(database.sql, database.runTransaction),
    close() {
      database.db.close()
    },
  }
}

function normalizeCreate(request: PendingInputCreate): PendingInputRecord {
  return {
    sessionId: request.sessionId,
    requestId: request.requestId,
    kind: request.kind,
    ...(request.toolName ? { toolName: request.toolName } : {}),
    ...(request.toolCallId ? { toolCallId: request.toolCallId } : {}),
    ...(request.schema ? { schema: request.schema } : {}),
    ...(request.payload !== undefined ? { payload: request.payload } : {}),
    ...(request.ctx && !isEmptyCtx(request.ctx) ? { ctx: normalizeCtx(request.ctx) } : {}),
    ...(request.auth && !isEmptyAuth(request.auth) ? { auth: normalizeAuth(request.auth) } : {}),
    createdAt: request.createdAt ?? new Date().toISOString(),
  }
}

function rowToRecord(row: Record<string, unknown>): PendingInputRecord {
  const schema = parseJsonRecord(row.schema_json)
  const payload = parseJson(row.payload_json)
  const ctx = normalizeCtx({
    workspaceId: stringOrUndefined(row.workspace_id),
    userId: stringOrUndefined(row.user_id),
  })
  return {
    sessionId: String(row.session_id),
    requestId: String(row.request_id),
    kind: row.kind === 'input' ? 'input' : 'approval',
    ...(stringOrUndefined(row.tool_name) ? { toolName: stringOrUndefined(row.tool_name) } : {}),
    ...(stringOrUndefined(row.tool_call_id) ? { toolCallId: stringOrUndefined(row.tool_call_id) } : {}),
    ...(schema ? { schema } : {}),
    ...(payload !== undefined ? { payload } : {}),
    ...(ctx ? { ctx } : {}),
    ...authFromRow(row),
    createdAt: String(row.created_at),
  }
}

function ensureColumn(sql: SqlStorage, columnName: string, columnType: string): void {
  const columns = sql.exec('PRAGMA table_info(boring_pending_requests)').toArray()
  if (columns.some((column) => column.name === columnName)) return
  sql.exec(`ALTER TABLE boring_pending_requests ADD COLUMN ${columnName} ${columnType}`)
}

function redactedRecord(record: PendingInputRecord): PendingInputRequest {
  return {
    sessionId: record.sessionId,
    requestId: record.requestId,
    kind: record.kind,
    ...(record.toolName ? { toolName: record.toolName } : {}),
    ...(record.toolCallId ? { toolCallId: record.toolCallId } : {}),
    ...(record.schema ? { schema: record.schema } : {}),
    createdAt: record.createdAt,
  }
}

function cloneRecord(record: PendingInputRecord | undefined): PendingInputRecord | undefined {
  return record ? JSON.parse(JSON.stringify(record)) as PendingInputRecord : undefined
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return undefined
  return JSON.parse(value) as unknown
}

function parseJsonRecord(value: unknown): Record<string, unknown> | undefined {
  const parsed = parseJson(value)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : undefined
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function normalizeCtx(ctx: SessionCtx | undefined): SessionCtx | undefined {
  if (!ctx?.workspaceId && !ctx?.userId) return undefined
  return {
    ...(ctx.workspaceId ? { workspaceId: ctx.workspaceId } : {}),
    ...(ctx.userId ? { userId: ctx.userId } : {}),
  }
}

function isEmptyCtx(ctx: SessionCtx): boolean {
  return !ctx.workspaceId && !ctx.userId
}

function normalizeAuth(auth: PendingInputAuth | undefined): PendingInputAuth | undefined {
  if (!auth?.userEmail && auth?.userEmailVerified === undefined) return undefined
  return {
    ...(auth.userEmail ? { userEmail: auth.userEmail } : {}),
    ...(auth.userEmailVerified === undefined ? {} : { userEmailVerified: auth.userEmailVerified }),
  }
}

function isEmptyAuth(auth: PendingInputAuth): boolean {
  return !auth.userEmail && auth.userEmailVerified === undefined
}

function authFromRow(row: Record<string, unknown>): { auth?: PendingInputAuth } {
  const auth = normalizeAuth({
    userEmail: stringOrUndefined(row.user_email),
    userEmailVerified: booleanOrUndefined(row.user_email_verified),
  })
  return auth ? { auth } : {}
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  return undefined
}

function sameCtx(a: SessionCtx | undefined, b: SessionCtx): boolean {
  return (a?.workspaceId ?? '') === (b.workspaceId ?? '') && (a?.userId ?? '') === (b.userId ?? '')
}

function keyFor(sessionId: string, requestId: string): string {
  return JSON.stringify([sessionId, requestId])
}

function comparePendingRecords(a: PendingInputRecord, b: PendingInputRecord): number {
  return a.createdAt.localeCompare(b.createdAt) || a.requestId.localeCompare(b.requestId)
}

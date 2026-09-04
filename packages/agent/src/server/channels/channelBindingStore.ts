import { randomUUID } from 'node:crypto'
import { ErrorCode } from '../../shared/error-codes'
import type { RunTransaction, SqlStorage } from '../events/sqlStorage'

export const SESSION_CREATE_TIMEOUT = ErrorCode.enum.SESSION_CREATE_TIMEOUT
export const RESERVATION_TTL_MS = 30_000

export type ChannelBindingStatus = 'active' | 'revoked'
export type ChannelInboundStatus = 'pending' | 'processing' | 'processed' | 'parked'

export interface ChannelBinding {
  readonly channel: string
  readonly conversationKey: string
  readonly agentTypeId: string
  readonly workspaceId: string
  readonly authSubjectId: string
  readonly bindingVersion: number
  readonly status: ChannelBindingStatus
  readonly sessionKey?: string
  readonly lastInboundAt?: number
}

export interface ProvisionChannelBindingInput extends Omit<ChannelBinding, 'bindingVersion' | 'status' | 'lastInboundAt'> {
  readonly status?: ChannelBindingStatus
}

export interface InboundChannelMessage {
  readonly channel: string
  readonly conversationKey: string
  readonly providerMessageId: string
  readonly text: string
  readonly receivedAt: number
}

export interface QueuedChannelInbound extends InboundChannelMessage {
  readonly id: number
  readonly agentTypeId: string
  readonly workspaceId: string
  readonly authSubjectId: string
  readonly bindingVersion: number
  readonly attempts: number
  readonly status: ChannelInboundStatus
  readonly errorCode?: string
}

export type EnqueueInboundResult =
  | { readonly disposition: 'enqueued'; readonly binding: ChannelBinding; readonly queueId: number }
  | { readonly disposition: 'duplicate'; readonly binding?: ChannelBinding }
  | { readonly disposition: 'unknown_binding' }

interface CreationRow {
  state: 'creating' | 'admitting'
  owner: string
  expiresAt: number
  sessionKey?: string
}

export interface EnsureSessionOptions {
  readonly reservationTtlMs?: number
  readonly maxReservationCycles?: number
  readonly initialBackoffMs?: number
  readonly allocate: () => Promise<string>
  readonly admit: (sessionKey: string) => Promise<void>
}

export class ChannelSessionCreateTimeoutError extends Error {
  readonly code = SESSION_CREATE_TIMEOUT
  constructor(channel: string, conversationKey: string, agentTypeId: string) {
    super(`Timed out creating channel session for ${channel}/${conversationKey}/${agentTypeId}`)
    this.name = 'ChannelSessionCreateTimeoutError'
  }
}

export class ChannelBindingStore {
  constructor(
    private readonly sql: SqlStorage,
    private readonly runTransaction: RunTransaction,
  ) {
    this.migrate()
  }

  private migrate(): void {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS boring_channel_bindings (
      channel TEXT NOT NULL,
      conversation_key TEXT NOT NULL,
      agent_type_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      auth_subject_id TEXT NOT NULL,
      binding_version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL,
      session_key TEXT,
      create_state TEXT,
      create_owner TEXT,
      create_expires_at INTEGER,
      create_session_key TEXT,
      last_inbound_at INTEGER,
      PRIMARY KEY (channel, conversation_key, agent_type_id)
    )`)
    this.sql.exec(`CREATE TABLE IF NOT EXISTS boring_channel_inbound_dedupe (
      channel TEXT NOT NULL,
      provider_message_id TEXT NOT NULL,
      seen_at INTEGER NOT NULL,
      PRIMARY KEY (channel, provider_message_id)
    )`)
    this.sql.exec(`CREATE TABLE IF NOT EXISTS boring_channel_inbound_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT NOT NULL,
      conversation_key TEXT NOT NULL,
      agent_type_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      auth_subject_id TEXT NOT NULL,
      binding_version INTEGER NOT NULL,
      provider_message_id TEXT NOT NULL,
      text TEXT NOT NULL,
      received_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      error_code TEXT
    )`)
    this.sql.exec(`CREATE INDEX IF NOT EXISTS boring_channel_queue_binding
      ON boring_channel_inbound_queue(channel, conversation_key, agent_type_id, id)`)
    // Databases created by the first channel-core build lack tenant snapshots.
    // Those legacy rows cannot be attributed safely, so fail closed.
    this.ensureColumn('boring_channel_bindings', 'binding_version', 'INTEGER NOT NULL DEFAULT 1')
    this.ensureColumn('boring_channel_inbound_queue', 'workspace_id', 'TEXT')
    this.ensureColumn('boring_channel_inbound_queue', 'auth_subject_id', 'TEXT')
    this.ensureColumn('boring_channel_inbound_queue', 'binding_version', 'INTEGER')
    this.sql.exec(`UPDATE boring_channel_inbound_queue
      SET status='parked', error_code=?
      WHERE workspace_id IS NULL OR auth_subject_id IS NULL OR binding_version IS NULL`, ErrorCode.enum.CHANNEL_BINDING_REVOKED)
    // A process may die after claiming a row. Delivery to the agent is
    // idempotency-keyed by providerMessageId, so restart safely retries it.
    this.sql.exec(`UPDATE boring_channel_inbound_queue SET status='pending' WHERE status='processing'`)
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.sql.exec(`PRAGMA table_info(${table})`).toArray()
    if (!columns.some((entry) => entry.name === column)) {
      this.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    }
  }

  provision(input: ProvisionChannelBindingInput): ChannelBinding {
    this.sql.exec(`INSERT INTO boring_channel_bindings
      (channel, conversation_key, agent_type_id, workspace_id, auth_subject_id, binding_version, status, session_key)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(channel, conversation_key, agent_type_id) DO UPDATE SET
        workspace_id=excluded.workspace_id,
        auth_subject_id=excluded.auth_subject_id,
        binding_version=boring_channel_bindings.binding_version + 1,
        status=excluded.status,
        session_key=excluded.session_key,
        create_state=NULL,
        create_owner=NULL,
        create_expires_at=NULL,
        create_session_key=NULL`,
    input.channel, input.conversationKey, input.agentTypeId, input.workspaceId,
    input.authSubjectId, input.status ?? 'active', input.sessionKey ?? null)
    return this.getBinding(input.channel, input.conversationKey, input.agentTypeId)!
  }

  getBinding(channel: string, conversationKey: string, agentTypeId: string): ChannelBinding | undefined {
    const row = this.sql.exec(`SELECT channel, conversation_key, agent_type_id, workspace_id,
      auth_subject_id, binding_version, status, session_key, last_inbound_at FROM boring_channel_bindings
      WHERE channel=? AND conversation_key=? AND agent_type_id=?`, channel, conversationKey, agentTypeId).toArray()[0]
    return row ? bindingFromRow(row) : undefined
  }

  enqueueInbound(message: InboundChannelMessage, agentTypeId: string): EnqueueInboundResult {
    return this.runTransaction(() => {
      const existing = this.sql.exec(`SELECT 1 FROM boring_channel_inbound_dedupe
        WHERE channel=? AND provider_message_id=?`, message.channel, message.providerMessageId).toArray()[0]
      if (existing) {
        const binding = this.getBinding(message.channel, message.conversationKey, agentTypeId)
        return {
          disposition: 'duplicate',
          ...(binding?.status === 'active' ? { binding } : {}),
        } as const
      }

      const binding = this.getBinding(message.channel, message.conversationKey, agentTypeId)
      this.sql.exec(`INSERT INTO boring_channel_inbound_dedupe(channel, provider_message_id, seen_at)
        VALUES (?, ?, ?)`, message.channel, message.providerMessageId, message.receivedAt)
      if (!binding || binding.status !== 'active') return { disposition: 'unknown_binding' } as const

      const inserted = this.sql.exec(`INSERT INTO boring_channel_inbound_queue
        (channel, conversation_key, agent_type_id, workspace_id, auth_subject_id, binding_version,
          provider_message_id, text, received_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`, message.channel, message.conversationKey,
      agentTypeId, binding.workspaceId, binding.authSubjectId, binding.bindingVersion,
      message.providerMessageId, message.text, message.receivedAt).toArray()[0]
      this.sql.exec(`UPDATE boring_channel_bindings SET last_inbound_at=?
        WHERE channel=? AND conversation_key=? AND agent_type_id=?`, message.receivedAt,
      message.channel, message.conversationKey, agentTypeId)
      return { disposition: 'enqueued', binding: { ...binding, lastInboundAt: message.receivedAt }, queueId: Number(inserted!.id) } as const
    }, 'immediate')
  }

  pendingBindings(): ChannelBinding[] {
    return this.sql.exec(`SELECT DISTINCT b.channel, b.conversation_key, b.agent_type_id,
      b.workspace_id, b.auth_subject_id, b.binding_version, b.status, b.session_key, b.last_inbound_at
      FROM boring_channel_bindings b JOIN boring_channel_inbound_queue q
        ON q.channel=b.channel AND q.conversation_key=b.conversation_key AND q.agent_type_id=b.agent_type_id
      WHERE b.status='active' AND q.status IN ('pending', 'processing')`).toArray().map(bindingFromRow)
  }

  nextPending(channel: string, conversationKey: string, agentTypeId: string): QueuedChannelInbound | undefined {
    const row = this.runTransaction(() => {
      // The oldest unfinished row is a binding-wide database lock. A second
      // process cannot claim a later row while the first is processing it.
      const candidate = this.sql.exec(`SELECT * FROM boring_channel_inbound_queue
        WHERE channel=? AND conversation_key=? AND agent_type_id=? AND status IN ('pending', 'processing')
        ORDER BY id LIMIT 1`, channel, conversationKey, agentTypeId).toArray()[0]
      if (!candidate || candidate.status === 'processing') return undefined
      this.sql.exec(`UPDATE boring_channel_inbound_queue SET status='processing', attempts=attempts+1
        WHERE id=? AND status='pending'`, candidate.id)
      return this.sql.exec(`SELECT * FROM boring_channel_inbound_queue WHERE id=?`, candidate.id).toArray()[0]
    }, 'immediate')
    return row ? inboundFromRow(row) : undefined
  }

  completeInbound(id: number): void {
    this.sql.exec(`UPDATE boring_channel_inbound_queue SET status='processed', error_code=NULL WHERE id=?`, id)
  }

  retryInbound(id: number, errorCode: string): void {
    this.sql.exec(`UPDATE boring_channel_inbound_queue SET status='pending', error_code=? WHERE id=?`, errorCode, id)
  }

  parkInbound(id: number, errorCode: string): void {
    this.sql.exec(`UPDATE boring_channel_inbound_queue SET status='parked', error_code=? WHERE id=?`, errorCode, id)
  }

  getInbound(id: number): QueuedChannelInbound | undefined {
    const row = this.sql.exec(`SELECT * FROM boring_channel_inbound_queue WHERE id=?`, id).toArray()[0]
    return row ? inboundFromRow(row) : undefined
  }

  async ensureSession(binding: ChannelBinding, options: EnsureSessionOptions): Promise<{ sessionKey: string; created: boolean }> {
    if (binding.sessionKey) return { sessionKey: binding.sessionKey, created: false }
    const ttl = options.reservationTtlMs ?? RESERVATION_TTL_MS
    const maxCycles = options.maxReservationCycles ?? 2
    let backoff = options.initialBackoffMs ?? 50
    const owner = randomUUID()
    let cycles = 0

    while (cycles < maxCycles) {
      const currentBinding = this.getBinding(binding.channel, binding.conversationKey, binding.agentTypeId)
      if (!currentBinding || currentBinding.status !== 'active' || currentBinding.bindingVersion !== binding.bindingVersion
        || currentBinding.workspaceId !== binding.workspaceId || currentBinding.authSubjectId !== binding.authSubjectId) {
        throw Object.assign(new Error('Channel binding is revoked.'), { code: ErrorCode.enum.CHANNEL_BINDING_REVOKED })
      }
      if (currentBinding.sessionKey) return { sessionKey: currentBinding.sessionKey, created: false }
      const creation = this.readCreation(binding)
      const now = Date.now()

      if (creation && creation.expiresAt > now) {
        await delay(backoff)
        backoff = Math.min(500, backoff * 2)
        continue
      }
      if (creation?.state === 'admitting' && creation.sessionKey) {
        if (this.recoverAdmitting(binding, creation.owner, creation.sessionKey)) {
          return { sessionKey: creation.sessionKey, created: false }
        }
        continue
      }

      cycles += 1
      const won = this.claimCreation(binding, creation?.owner, owner, now + ttl)
      if (!won) continue
      const sessionKey = await options.allocate()
      if (!this.transitionCreation(binding, owner, 'admitting', now + ttl, sessionKey)) continue
      await options.admit(sessionKey)
      if (this.finishCreation(binding, owner, sessionKey)) return { sessionKey, created: true }
    }

    throw new ChannelSessionCreateTimeoutError(binding.channel, binding.conversationKey, binding.agentTypeId)
  }

  private readCreation(binding: ChannelBinding): CreationRow | undefined {
    const row = this.sql.exec(`SELECT create_state, create_owner, create_expires_at, create_session_key
      FROM boring_channel_bindings WHERE channel=? AND conversation_key=? AND agent_type_id=? AND binding_version=?`,
    binding.channel, binding.conversationKey, binding.agentTypeId, binding.bindingVersion).toArray()[0]
    if (!row?.create_state || !row.create_owner || row.create_expires_at === null) return undefined
    return {
      state: row.create_state as CreationRow['state'],
      owner: String(row.create_owner),
      expiresAt: Number(row.create_expires_at),
      ...(row.create_session_key ? { sessionKey: String(row.create_session_key) } : {}),
    }
  }

  private claimCreation(binding: ChannelBinding, expectedOwner: string | undefined, owner: string, expiresAt: number): boolean {
    const rows = expectedOwner === undefined
      ? this.sql.exec(`UPDATE boring_channel_bindings SET create_state='creating', create_owner=?, create_expires_at=?
          WHERE channel=? AND conversation_key=? AND agent_type_id=? AND binding_version=?
            AND session_key IS NULL AND create_owner IS NULL
          RETURNING channel`, owner, expiresAt, binding.channel, binding.conversationKey, binding.agentTypeId,
        binding.bindingVersion).toArray()
      : this.sql.exec(`UPDATE boring_channel_bindings SET create_state='creating', create_owner=?, create_expires_at=?
          WHERE channel=? AND conversation_key=? AND agent_type_id=? AND binding_version=?
            AND session_key IS NULL AND create_owner=? AND create_expires_at<=?
          RETURNING channel`, owner, expiresAt, binding.channel, binding.conversationKey, binding.agentTypeId,
        binding.bindingVersion, expectedOwner, Date.now()).toArray()
    return rows.length === 1
  }

  private transitionCreation(binding: ChannelBinding, owner: string, state: CreationRow['state'], expiresAt: number, sessionKey: string): boolean {
    return this.sql.exec(`UPDATE boring_channel_bindings SET create_state=?, create_expires_at=?, create_session_key=?
      WHERE channel=? AND conversation_key=? AND agent_type_id=? AND binding_version=?
        AND create_owner=? AND create_state='creating'
      RETURNING channel`, state, expiresAt, sessionKey, binding.channel, binding.conversationKey,
    binding.agentTypeId, binding.bindingVersion, owner).toArray().length === 1
  }

  private finishCreation(binding: ChannelBinding, owner: string, sessionKey: string): boolean {
    return this.sql.exec(`UPDATE boring_channel_bindings SET session_key=?, create_state=NULL, create_owner=NULL, create_expires_at=NULL, create_session_key=NULL
      WHERE channel=? AND conversation_key=? AND agent_type_id=? AND binding_version=?
        AND create_owner=? AND create_state='admitting'
      RETURNING channel`, sessionKey, binding.channel, binding.conversationKey, binding.agentTypeId,
    binding.bindingVersion, owner).toArray().length === 1
  }

  private recoverAdmitting(binding: ChannelBinding, expectedOwner: string, sessionKey: string): boolean {
    return this.sql.exec(`UPDATE boring_channel_bindings SET session_key=?, create_state=NULL, create_owner=NULL, create_expires_at=NULL, create_session_key=NULL
      WHERE channel=? AND conversation_key=? AND agent_type_id=? AND binding_version=?
        AND create_owner=? AND create_state='admitting' AND create_expires_at<=?
      RETURNING channel`, sessionKey, binding.channel, binding.conversationKey, binding.agentTypeId,
    binding.bindingVersion, expectedOwner, Date.now()).toArray().length === 1
  }
}

function bindingFromRow(row: Record<string, unknown>): ChannelBinding {
  return {
    channel: String(row.channel),
    conversationKey: String(row.conversation_key),
    agentTypeId: String(row.agent_type_id),
    workspaceId: String(row.workspace_id),
    authSubjectId: String(row.auth_subject_id),
    bindingVersion: Number(row.binding_version),
    status: row.status as ChannelBindingStatus,
    ...(row.session_key ? { sessionKey: String(row.session_key) } : {}),
    ...(row.last_inbound_at === null || row.last_inbound_at === undefined ? {} : { lastInboundAt: Number(row.last_inbound_at) }),
  }
}

function inboundFromRow(row: Record<string, unknown>): QueuedChannelInbound {
  return {
    id: Number(row.id),
    channel: String(row.channel),
    conversationKey: String(row.conversation_key),
    agentTypeId: String(row.agent_type_id),
    workspaceId: String(row.workspace_id),
    authSubjectId: String(row.auth_subject_id),
    bindingVersion: Number(row.binding_version),
    providerMessageId: String(row.provider_message_id),
    text: String(row.text),
    receivedAt: Number(row.received_at),
    attempts: Number(row.attempts),
    status: row.status as ChannelInboundStatus,
    ...(row.error_code ? { errorCode: String(row.error_code) } : {}),
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

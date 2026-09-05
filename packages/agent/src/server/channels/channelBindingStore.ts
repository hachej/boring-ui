import { randomUUID } from 'node:crypto'
import { ErrorCode } from '../../shared/error-codes'
import type { RunTransaction, SqlStorage } from '../events/sqlStorage'

export const SESSION_CREATE_TIMEOUT = ErrorCode.enum.SESSION_CREATE_TIMEOUT
export const RESERVATION_TTL_MS = 30_000
export const INBOUND_CLAIM_TTL_MS = 30_000
export const OUTBOUND_CLAIM_TTL_MS = 30_000
export const INTENTION_CLAIM_TTL_MS = 30_000

export type ChannelBindingStatus = 'active' | 'revoked'
export type ChannelInboundStatus = 'pending' | 'processing' | 'processed' | 'parked'
export type ChannelOutboundStatus = 'active' | 'parked'

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
  readonly outboundCursor: string
  readonly outboundStatus: ChannelOutboundStatus
  readonly sessionResetPending: boolean
  readonly templateSentForInboundAt?: number
}

export interface ProvisionChannelBindingInput extends Omit<ChannelBinding,
  'bindingVersion' | 'status' | 'lastInboundAt' | 'outboundCursor' | 'outboundStatus' | 'sessionResetPending' | 'templateSentForInboundAt'> {
  readonly status?: ChannelBindingStatus
  /** Tail of an existing target stream; omitted only for a new/empty session. */
  readonly outboundCursor?: string
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
  readonly claimOwner: string
  readonly attempts: number
  readonly status: ChannelInboundStatus
  readonly errorCode?: string
}

export type EnqueueInboundResult =
  | { readonly disposition: 'enqueued'; readonly binding: ChannelBinding; readonly queueId: number }
  | { readonly disposition: 'duplicate'; readonly binding?: ChannelBinding }
  | { readonly disposition: 'unknown_binding' }

export interface ChannelIntentionRecord {
  readonly questionId: string
  readonly sessionId: string
  readonly channel: string
  readonly conversationKey: string
  readonly agentTypeId: string
  readonly bindingVersion: number
  readonly fieldName: string
  readonly options: readonly { value: string; label: string; description?: string }[]
  readonly title?: string
  readonly context?: string
  readonly status: 'pending' | 'projecting' | 'window-held' | 'projected' | 'answering' | 'answered' | 'closed'
  readonly answerValues?: Readonly<Record<string, unknown>>
  readonly answerProviderMessageId?: string
}

export type ClaimIntentionReplyResult =
  | { readonly disposition: 'claimed'; readonly intention: ChannelIntentionRecord }
  | { readonly disposition: 'duplicate' }
  | { readonly disposition: 'no_intention' }

export type ClaimInvalidIntentionReplyResult =
  | { readonly disposition: 'claimed' }
  | { readonly disposition: 'duplicate' }
  | { readonly disposition: 'no_intention' }

type NextInboundResult =
  | { readonly disposition: 'claimed'; readonly inbound: QueuedChannelInbound }
  | { readonly disposition: 'blocked'; readonly retryAt: number }
  | { readonly disposition: 'empty' }

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
      outbound_cursor TEXT NOT NULL DEFAULT '-1',
      outbound_status TEXT NOT NULL DEFAULT 'active',
      session_reset_pending INTEGER NOT NULL DEFAULT 0,
      template_sent_for_inbound_at INTEGER,
      outbound_claim_owner TEXT,
      outbound_claim_expires_at INTEGER,
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
      claim_owner TEXT,
      claim_expires_at INTEGER,
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
    this.ensureColumn('boring_channel_inbound_queue', 'claim_owner', 'TEXT')
    this.ensureColumn('boring_channel_inbound_queue', 'claim_expires_at', 'INTEGER')
    this.ensureColumn('boring_channel_bindings', 'outbound_cursor', "TEXT NOT NULL DEFAULT '-1'")
    this.ensureColumn('boring_channel_bindings', 'outbound_status', "TEXT NOT NULL DEFAULT 'active'")
    this.ensureColumn('boring_channel_bindings', 'session_reset_pending', 'INTEGER NOT NULL DEFAULT 0')
    this.ensureColumn('boring_channel_bindings', 'template_sent_for_inbound_at', 'INTEGER')
    this.ensureColumn('boring_channel_bindings', 'outbound_claim_owner', 'TEXT')
    this.ensureColumn('boring_channel_bindings', 'outbound_claim_expires_at', 'INTEGER')
    this.sql.exec(`CREATE TABLE IF NOT EXISTS boring_channel_outbound_parked (
      channel TEXT NOT NULL,
      conversation_key TEXT NOT NULL,
      agent_type_id TEXT NOT NULL,
      binding_version INTEGER NOT NULL,
      terminal_offset TEXT NOT NULL,
      error_code TEXT NOT NULL,
      parked_at INTEGER NOT NULL,
      PRIMARY KEY (channel, conversation_key, agent_type_id, binding_version, terminal_offset)
    )`)
    this.sql.exec(`CREATE TABLE IF NOT EXISTS boring_channel_intentions (
      question_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      conversation_key TEXT NOT NULL,
      agent_type_id TEXT NOT NULL,
      binding_version INTEGER NOT NULL,
      field_name TEXT NOT NULL,
      options_json TEXT NOT NULL,
      title TEXT,
      context TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      claim_owner TEXT,
      claim_expires_at INTEGER,
      answer_values_json TEXT,
      answer_provider_message_id TEXT UNIQUE,
      updated_at INTEGER NOT NULL
    )`)
    this.sql.exec(`CREATE INDEX IF NOT EXISTS boring_channel_intentions_binding
      ON boring_channel_intentions(channel, conversation_key, agent_type_id, binding_version, status)`)
    this.sql.exec(`CREATE TABLE IF NOT EXISTS boring_channel_intention_reply_dedupe (
      channel TEXT NOT NULL,
      provider_message_id TEXT NOT NULL,
      seen_at INTEGER NOT NULL,
      question_id TEXT,
      binding_version INTEGER,
      status TEXT NOT NULL DEFAULT 'sent',
      claim_owner TEXT,
      claim_expires_at INTEGER,
      PRIMARY KEY (channel, provider_message_id)
    )`)
    this.ensureColumn('boring_channel_intention_reply_dedupe', 'question_id', 'TEXT')
    this.ensureColumn('boring_channel_intention_reply_dedupe', 'binding_version', 'INTEGER')
    this.ensureColumn('boring_channel_intention_reply_dedupe', 'status', "TEXT NOT NULL DEFAULT 'sent'")
    this.ensureColumn('boring_channel_intention_reply_dedupe', 'claim_owner', 'TEXT')
    this.ensureColumn('boring_channel_intention_reply_dedupe', 'claim_expires_at', 'INTEGER')
    this.sql.exec(`UPDATE boring_channel_intention_reply_dedupe
      SET binding_version=(SELECT i.binding_version FROM boring_channel_intentions i
        WHERE i.question_id=boring_channel_intention_reply_dedupe.question_id)
      WHERE binding_version IS NULL AND question_id IS NOT NULL`)
    this.sql.exec(`UPDATE boring_channel_intentions SET status='pending', claim_owner=NULL, claim_expires_at=NULL
      WHERE status='projecting' AND claim_expires_at<=?`, Date.now())
    this.sql.exec(`UPDATE boring_channel_inbound_queue
      SET status='parked', error_code=?
      WHERE workspace_id IS NULL OR auth_subject_id IS NULL OR binding_version IS NULL`, ErrorCode.enum.CHANNEL_BINDING_REVOKED)
    // Only pre-lease processing rows are safe to recover immediately. Live
    // claims are reclaimed by nextPending only after their durable lease ends.
    this.sql.exec(`UPDATE boring_channel_inbound_queue
      SET status='pending', claim_owner=NULL, claim_expires_at=NULL
      WHERE status='processing' AND (claim_owner IS NULL OR claim_expires_at IS NULL)`)
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.sql.exec(`PRAGMA table_info(${table})`).toArray()
    if (!columns.some((entry) => entry.name === column)) {
      this.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    }
  }

  provision(input: ProvisionChannelBindingInput): ChannelBinding {
    const now = Date.now()
    const row = this.sql.exec(`INSERT INTO boring_channel_bindings
      (channel, conversation_key, agent_type_id, workspace_id, auth_subject_id, binding_version, status, session_key, outbound_cursor)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(channel, conversation_key, agent_type_id) DO UPDATE SET
        workspace_id=excluded.workspace_id,
        auth_subject_id=excluded.auth_subject_id,
        binding_version=boring_channel_bindings.binding_version + 1,
        status=excluded.status,
        session_key=excluded.session_key,
        create_state=NULL,
        create_owner=NULL,
        create_expires_at=NULL,
        create_session_key=NULL,
        outbound_cursor=CASE
          WHEN boring_channel_bindings.session_key IS excluded.session_key
            AND boring_channel_bindings.workspace_id=excluded.workspace_id
            AND boring_channel_bindings.auth_subject_id=excluded.auth_subject_id
          THEN boring_channel_bindings.outbound_cursor
          ELSE excluded.outbound_cursor
        END,
        outbound_status='active',
        session_reset_pending=0,
        template_sent_for_inbound_at=NULL
      WHERE (boring_channel_bindings.outbound_claim_owner IS NULL
        OR boring_channel_bindings.outbound_claim_expires_at<=?)
        AND NOT EXISTS (SELECT 1 FROM boring_channel_intentions i
          WHERE i.channel=boring_channel_bindings.channel
            AND i.conversation_key=boring_channel_bindings.conversation_key
            AND i.agent_type_id=boring_channel_bindings.agent_type_id
            AND i.binding_version=boring_channel_bindings.binding_version
            AND ((i.status='projecting' AND i.claim_expires_at>?) OR i.status='answering'))
        AND NOT EXISTS (SELECT 1 FROM boring_channel_intention_reply_dedupe d
          JOIN boring_channel_intentions i ON i.question_id=d.question_id
            AND i.binding_version=d.binding_version
          WHERE i.channel=boring_channel_bindings.channel
            AND i.conversation_key=boring_channel_bindings.conversation_key
            AND i.agent_type_id=boring_channel_bindings.agent_type_id
            AND i.binding_version=boring_channel_bindings.binding_version
            AND d.status='sending' AND d.claim_expires_at>?)
      RETURNING channel, conversation_key, agent_type_id, workspace_id, auth_subject_id,
        binding_version, status, session_key, last_inbound_at, outbound_cursor, outbound_status,
        session_reset_pending, template_sent_for_inbound_at`,
    input.channel, input.conversationKey, input.agentTypeId, input.workspaceId,
    input.authSubjectId, input.status ?? 'active', input.sessionKey ?? null,
    input.outboundCursor ?? '-1', now, now, now).toArray()[0]
    if (!row) {
      throw Object.assign(new Error('Channel binding has active outbound delivery.'), {
        code: ErrorCode.enum.CHANNEL_BINDING_BUSY,
      })
    }
    return bindingFromRow(row)
  }

  getBinding(channel: string, conversationKey: string, agentTypeId: string): ChannelBinding | undefined {
    const row = this.sql.exec(`SELECT channel, conversation_key, agent_type_id, workspace_id,
      auth_subject_id, binding_version, status, session_key, last_inbound_at, outbound_cursor,
      outbound_status, session_reset_pending, template_sent_for_inbound_at FROM boring_channel_bindings
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
      if (!binding || binding.status !== 'active') return { disposition: 'unknown_binding' } as const
      // Unknown identities are not consumed: every retry remains fail-closed,
      // and a later explicit provision can safely admit the same provider id.
      this.sql.exec(`INSERT INTO boring_channel_inbound_dedupe(channel, provider_message_id, seen_at)
        VALUES (?, ?, ?)`, message.channel, message.providerMessageId, message.receivedAt)

      const inserted = this.sql.exec(`INSERT INTO boring_channel_inbound_queue
        (channel, conversation_key, agent_type_id, workspace_id, auth_subject_id, binding_version,
          provider_message_id, text, received_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`, message.channel, message.conversationKey,
      agentTypeId, binding.workspaceId, binding.authSubjectId, binding.bindingVersion,
      message.providerMessageId, message.text, message.receivedAt).toArray()[0]
      this.sql.exec(`UPDATE boring_channel_bindings SET last_inbound_at=?,
          template_sent_for_inbound_at=NULL
        WHERE channel=? AND conversation_key=? AND agent_type_id=?`, message.receivedAt,
      message.channel, message.conversationKey, agentTypeId)
      return { disposition: 'enqueued', binding: { ...binding, lastInboundAt: message.receivedAt }, queueId: Number(inserted!.id) } as const
    }, 'immediate')
  }

  recordIntentionInboundActivity(
    binding: Pick<ChannelBinding, 'channel' | 'conversationKey' | 'agentTypeId' | 'bindingVersion'>,
    receivedAt: number,
  ): ChannelBinding | undefined {
    const row = this.sql.exec(`UPDATE boring_channel_bindings SET last_inbound_at=?,
        template_sent_for_inbound_at=NULL
      WHERE channel=? AND conversation_key=? AND agent_type_id=? AND binding_version=? AND status='active'
      RETURNING channel, conversation_key, agent_type_id, workspace_id, auth_subject_id,
        binding_version, status, session_key, last_inbound_at, outbound_cursor, outbound_status,
        session_reset_pending, template_sent_for_inbound_at`, receivedAt, binding.channel,
    binding.conversationKey, binding.agentTypeId, binding.bindingVersion).toArray()[0]
    return row ? bindingFromRow(row) : undefined
  }

  activeBindings(): ChannelBinding[] {
    return this.sql.exec(`SELECT channel, conversation_key, agent_type_id, workspace_id,
      auth_subject_id, binding_version, status, session_key, last_inbound_at, outbound_cursor,
      outbound_status, session_reset_pending, template_sent_for_inbound_at
      FROM boring_channel_bindings WHERE status='active'`).toArray().map(bindingFromRow)
  }

  bindingForSession(sessionId: string, workspaceId: string): ChannelBinding | undefined {
    const row = this.sql.exec(`SELECT channel, conversation_key, agent_type_id, workspace_id,
      auth_subject_id, binding_version, status, session_key, last_inbound_at, outbound_cursor,
      outbound_status, session_reset_pending, template_sent_for_inbound_at
      FROM boring_channel_bindings WHERE status='active' AND session_key=? AND workspace_id=?
      ORDER BY binding_version DESC LIMIT 1`, sessionId, workspaceId).toArray()[0]
    return row ? bindingFromRow(row) : undefined
  }

  recordIntention(input: Omit<ChannelIntentionRecord, 'status'>): boolean {
    const binding = this.getBinding(input.channel, input.conversationKey, input.agentTypeId)
    if (!binding || binding.status !== 'active' || binding.bindingVersion !== input.bindingVersion
      || binding.sessionKey !== input.sessionId) return false
    return this.sql.exec(`INSERT INTO boring_channel_intentions
      (question_id, session_id, channel, conversation_key, agent_type_id, binding_version,
        field_name, options_json, title, context, status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      ON CONFLICT(question_id) DO UPDATE SET
        channel=excluded.channel,
        conversation_key=excluded.conversation_key,
        agent_type_id=excluded.agent_type_id,
        binding_version=excluded.binding_version,
        field_name=excluded.field_name,
        options_json=excluded.options_json,
        title=excluded.title,
        context=excluded.context,
        status='pending',
        claim_owner=NULL,
        claim_expires_at=NULL,
        answer_values_json=NULL,
        answer_provider_message_id=NULL,
        updated_at=excluded.updated_at
      WHERE boring_channel_intentions.session_id=excluded.session_id
        AND boring_channel_intentions.status IN ('pending', 'projecting', 'window-held', 'projected')
        AND (boring_channel_intentions.channel<>excluded.channel
          OR boring_channel_intentions.conversation_key<>excluded.conversation_key
          OR boring_channel_intentions.agent_type_id<>excluded.agent_type_id
          OR boring_channel_intentions.binding_version<>excluded.binding_version)
      RETURNING question_id`,
    input.questionId, input.sessionId, input.channel, input.conversationKey, input.agentTypeId,
    input.bindingVersion, input.fieldName, JSON.stringify(input.options), input.title ?? null,
    input.context ?? null, Date.now()).toArray().length === 1
  }

  openIntentions(): ChannelIntentionRecord[] {
    return this.sql.exec(`SELECT i.* FROM boring_channel_intentions i
      JOIN boring_channel_bindings b ON b.channel=i.channel AND b.conversation_key=i.conversation_key
        AND b.agent_type_id=i.agent_type_id AND b.binding_version=i.binding_version
        AND b.session_key=i.session_id AND b.status='active'
      WHERE i.status IN ('pending', 'projecting', 'window-held', 'projected', 'answering')
      ORDER BY i.updated_at, i.question_id`).toArray().map(intentionFromRow)
  }

  terminalIntention(channel: string, conversationKey: string, agentTypeId: string): ChannelIntentionRecord | undefined {
    const row = this.sql.exec(`SELECT i.* FROM boring_channel_intentions i
      JOIN boring_channel_bindings b ON b.channel=i.channel AND b.conversation_key=i.conversation_key
        AND b.agent_type_id=i.agent_type_id AND b.binding_version=i.binding_version
        AND b.session_key=i.session_id AND b.status='active'
      WHERE i.channel=? AND i.conversation_key=? AND i.agent_type_id=?
        AND i.status IN ('answered', 'closed') ORDER BY i.updated_at DESC LIMIT 1`,
    channel, conversationKey, agentTypeId).toArray()[0]
    return row ? intentionFromRow(row) : undefined
  }

  activeIntention(channel: string, conversationKey: string, agentTypeId: string): ChannelIntentionRecord | undefined {
    const row = this.sql.exec(`SELECT i.* FROM boring_channel_intentions i
      JOIN boring_channel_bindings b ON b.channel=i.channel AND b.conversation_key=i.conversation_key
        AND b.agent_type_id=i.agent_type_id AND b.binding_version=i.binding_version
        AND b.session_key=i.session_id AND b.status='active'
      WHERE i.channel=? AND i.conversation_key=? AND i.agent_type_id=?
        AND i.status IN ('projected', 'answering') ORDER BY i.updated_at DESC LIMIT 1`,
    channel, conversationKey, agentTypeId).toArray()[0]
    return row ? intentionFromRow(row) : undefined
  }

  claimIntentionProjection(questionId: string, owner: string, ttlMs = INTENTION_CLAIM_TTL_MS): ChannelIntentionRecord | undefined {
    const now = Date.now()
    const row = this.sql.exec(`UPDATE boring_channel_intentions SET status='projecting',
        claim_owner=?, claim_expires_at=?, updated_at=?
      WHERE question_id=? AND (status='pending' OR (status='projecting' AND claim_expires_at<=?))
        AND EXISTS (SELECT 1 FROM boring_channel_bindings b
          WHERE b.channel=boring_channel_intentions.channel
            AND b.conversation_key=boring_channel_intentions.conversation_key
            AND b.agent_type_id=boring_channel_intentions.agent_type_id
            AND b.binding_version=boring_channel_intentions.binding_version
            AND b.session_key=boring_channel_intentions.session_id AND b.status='active')
      RETURNING *`, owner, now + ttlMs, now, questionId, now).toArray()[0]
    return row ? intentionFromRow(row) : undefined
  }

  holdIntentionForWindow(questionId: string, owner: string): boolean {
    return this.sql.exec(`UPDATE boring_channel_intentions SET status='window-held',
      claim_owner=NULL, claim_expires_at=NULL, updated_at=?
      WHERE question_id=? AND status='projecting' AND claim_owner=? RETURNING question_id`,
    Date.now(), questionId, owner).toArray().length === 1
  }

  releaseWindowHeldIntentions(binding: Pick<ChannelBinding,
    'channel' | 'conversationKey' | 'agentTypeId' | 'bindingVersion'>): void {
    this.sql.exec(`UPDATE boring_channel_intentions SET status='pending', updated_at=?
      WHERE channel=? AND conversation_key=? AND agent_type_id=? AND binding_version=?
        AND status='window-held'`, Date.now(), binding.channel, binding.conversationKey,
    binding.agentTypeId, binding.bindingVersion)
  }

  ownsIntentionClaim(questionId: string, owner: string): boolean {
    return this.sql.exec(`SELECT 1 FROM boring_channel_intentions
      WHERE question_id=? AND claim_owner=? AND claim_expires_at>?`,
    questionId, owner, Date.now()).toArray().length === 1
  }

  renewIntentionClaim(questionId: string, owner: string, ttlMs = INTENTION_CLAIM_TTL_MS): boolean {
    const now = Date.now()
    return this.sql.exec(`UPDATE boring_channel_intentions SET claim_expires_at=?
      WHERE question_id=? AND claim_owner=? AND claim_expires_at>? RETURNING question_id`,
    now + ttlMs, questionId, owner, now).toArray().length === 1
  }

  completeIntentionProjection(questionId: string, owner: string): boolean {
    return this.sql.exec(`UPDATE boring_channel_intentions SET status='projected',
        claim_owner=NULL, claim_expires_at=NULL, updated_at=?
      WHERE question_id=? AND status='projecting' AND claim_owner=? AND claim_expires_at>?
      RETURNING question_id`, Date.now(), questionId, owner, Date.now()).toArray().length === 1
  }

  claimIntentionReply(
    intention: ChannelIntentionRecord,
    providerMessageId: string,
    values: Readonly<Record<string, unknown>>,
    owner: string,
    ttlMs = INTENTION_CLAIM_TTL_MS,
  ): ClaimIntentionReplyResult {
    return this.runTransaction(() => {
      const duplicate = this.sql.exec(`SELECT 1 FROM boring_channel_intention_reply_dedupe
        WHERE channel=? AND provider_message_id=?`, intention.channel, providerMessageId).toArray()[0]
      if (duplicate) return { disposition: 'duplicate' } as const
      const now = Date.now()
      const claimed = this.sql.exec(`UPDATE boring_channel_intentions SET status='answering',
          claim_owner=?, claim_expires_at=?, answer_values_json=?, answer_provider_message_id=?, updated_at=?
        WHERE question_id=? AND binding_version=? AND status='projected'
          AND EXISTS (SELECT 1 FROM boring_channel_bindings b
            WHERE b.channel=boring_channel_intentions.channel
              AND b.conversation_key=boring_channel_intentions.conversation_key
              AND b.agent_type_id=boring_channel_intentions.agent_type_id
              AND b.binding_version=boring_channel_intentions.binding_version
              AND b.session_key=boring_channel_intentions.session_id AND b.status='active')
        RETURNING *`, owner, now + ttlMs, JSON.stringify(values), providerMessageId, now,
      intention.questionId, intention.bindingVersion).toArray()[0]
      if (!claimed) return { disposition: 'no_intention' } as const
      this.sql.exec(`INSERT INTO boring_channel_intention_reply_dedupe
        (channel, provider_message_id, seen_at, question_id, binding_version, status)
        VALUES (?, ?, ?, ?, ?, 'sent')`, intention.channel, providerMessageId, now,
      intention.questionId, intention.bindingVersion)
      return { disposition: 'claimed', intention: intentionFromRow(claimed) } as const
    }, 'immediate')
  }

  claimRecoverableIntentionAnswer(questionId: string, owner: string, ttlMs = INTENTION_CLAIM_TTL_MS): ChannelIntentionRecord | undefined {
    const now = Date.now()
    const row = this.sql.exec(`UPDATE boring_channel_intentions SET claim_owner=?, claim_expires_at=?, updated_at=?
      WHERE question_id=? AND status='answering' AND answer_values_json IS NOT NULL
        AND (claim_owner IS NULL OR claim_expires_at<=?)
        AND EXISTS (SELECT 1 FROM boring_channel_bindings b
          WHERE b.channel=boring_channel_intentions.channel
            AND b.conversation_key=boring_channel_intentions.conversation_key
            AND b.agent_type_id=boring_channel_intentions.agent_type_id
            AND b.binding_version=boring_channel_intentions.binding_version
            AND b.session_key=boring_channel_intentions.session_id AND b.status='active')
        RETURNING *`, owner, now + ttlMs, now, questionId, now).toArray()[0]
    return row ? intentionFromRow(row) : undefined
  }

  completeIntentionAnswer(questionId: string, owner: string): boolean {
    return this.sql.exec(`UPDATE boring_channel_intentions SET status='answered',
        claim_owner=NULL, claim_expires_at=NULL, updated_at=?
      WHERE question_id=? AND status='answering' AND claim_owner=? RETURNING question_id`,
    Date.now(), questionId, owner).toArray().length === 1
  }

  reconcileIntentionAnswered(questionId: string): void {
    this.sql.exec(`UPDATE boring_channel_intentions SET status='answered',
      claim_owner=NULL, claim_expires_at=NULL, updated_at=?
      WHERE question_id=? AND status IN ('pending', 'projecting', 'window-held', 'projected', 'answering')`, Date.now(), questionId)
  }

  reconcileIntentionClosed(questionId: string): void {
    this.sql.exec(`UPDATE boring_channel_intentions SET status='closed',
      claim_owner=NULL, claim_expires_at=NULL, updated_at=?
      WHERE question_id=? AND status IN ('pending', 'projecting', 'window-held', 'projected', 'answering')`, Date.now(), questionId)
  }

  claimInvalidIntentionReply(
    intention: ChannelIntentionRecord,
    providerMessageId: string,
    owner: string,
    ttlMs = INTENTION_CLAIM_TTL_MS,
  ): ClaimInvalidIntentionReplyResult {
    return this.runTransaction(() => {
      const now = Date.now()
      const authoritative = this.sql.exec(`SELECT 1 FROM boring_channel_intentions i
        JOIN boring_channel_bindings b ON b.channel=i.channel AND b.conversation_key=i.conversation_key
          AND b.agent_type_id=i.agent_type_id AND b.binding_version=i.binding_version
          AND b.session_key=i.session_id AND b.status='active'
        WHERE i.question_id=? AND i.binding_version=? AND i.status='projected'`,
      intention.questionId, intention.bindingVersion).toArray()[0]
      if (!authoritative) return { disposition: 'no_intention' } as const
      const existing = this.sql.exec(`SELECT status, claim_expires_at
        FROM boring_channel_intention_reply_dedupe WHERE channel=? AND provider_message_id=?`,
      intention.channel, providerMessageId).toArray()[0]
      if (existing && (existing.status === 'sent' || Number(existing.claim_expires_at) > now)) {
        return { disposition: 'duplicate' } as const
      }
      const row = existing
        ? this.sql.exec(`UPDATE boring_channel_intention_reply_dedupe
            SET question_id=?, binding_version=?, status='sending', claim_owner=?, claim_expires_at=?
            WHERE channel=? AND provider_message_id=? AND status='sending' AND claim_expires_at<=?
            RETURNING provider_message_id`, intention.questionId, intention.bindingVersion,
          owner, now + ttlMs, intention.channel, providerMessageId, now).toArray()[0]
        : this.sql.exec(`INSERT INTO boring_channel_intention_reply_dedupe
            (channel, provider_message_id, seen_at, question_id, binding_version, status, claim_owner, claim_expires_at)
            VALUES (?, ?, ?, ?, ?, 'sending', ?, ?) RETURNING provider_message_id`, intention.channel,
          providerMessageId, now, intention.questionId, intention.bindingVersion, owner, now + ttlMs).toArray()[0]
      return row ? { disposition: 'claimed' } as const : { disposition: 'duplicate' } as const
    }, 'immediate')
  }

  completeInvalidIntentionReply(channel: string, providerMessageId: string, owner: string): boolean {
    return this.sql.exec(`UPDATE boring_channel_intention_reply_dedupe
      SET status='sent', claim_owner=NULL, claim_expires_at=NULL
      WHERE channel=? AND provider_message_id=? AND status='sending' AND claim_owner=?
      RETURNING provider_message_id`, channel, providerMessageId, owner).toArray().length === 1
  }

  pendingInvalidIntentionReplies(): Array<{
    intention: ChannelIntentionRecord
    providerMessageId: string
    retryAt: number
  }> {
    return this.sql.exec(`SELECT i.*, d.provider_message_id, d.claim_expires_at AS reply_claim_expires_at
      FROM boring_channel_intention_reply_dedupe d
      JOIN boring_channel_intentions i ON i.question_id=d.question_id
        AND i.binding_version=d.binding_version AND i.status='projected'
      JOIN boring_channel_bindings b ON b.channel=i.channel AND b.conversation_key=i.conversation_key
        AND b.agent_type_id=i.agent_type_id AND b.binding_version=i.binding_version
        AND b.session_key=i.session_id AND b.status='active'
      WHERE d.status='sending'`).toArray().map((row) => ({
      intention: intentionFromRow(row),
      providerMessageId: String(row.provider_message_id),
      retryAt: Number(row.reply_claim_expires_at),
    }))
  }

  hasIntentionReply(channel: string, providerMessageId: string): boolean {
    return this.sql.exec(`SELECT 1 FROM boring_channel_intention_reply_dedupe
      WHERE channel=? AND provider_message_id=?`, channel, providerMessageId).toArray().length === 1
  }

  claimOutbound(binding: ChannelBinding, owner: string, claimTtlMs = OUTBOUND_CLAIM_TTL_MS): boolean {
    const now = Date.now()
    return this.sql.exec(`UPDATE boring_channel_bindings
      SET outbound_claim_owner=?, outbound_claim_expires_at=?
      WHERE channel=? AND conversation_key=? AND agent_type_id=? AND binding_version=?
        AND status='active' AND outbound_status='active' AND session_key=? AND outbound_cursor=?
        AND (outbound_claim_owner IS NULL OR outbound_claim_expires_at<=?) RETURNING channel`,
    owner, now + claimTtlMs, binding.channel, binding.conversationKey, binding.agentTypeId,
    binding.bindingVersion, binding.sessionKey ?? null, binding.outboundCursor, now).toArray().length === 1
  }

  outboundClaimRetryAt(binding: ChannelBinding): number | undefined {
    const row = this.sql.exec(`SELECT outbound_claim_expires_at FROM boring_channel_bindings
      WHERE channel=? AND conversation_key=? AND agent_type_id=? AND binding_version=?
        AND session_key=? AND outbound_cursor=? AND outbound_claim_owner IS NOT NULL`,
    binding.channel, binding.conversationKey, binding.agentTypeId, binding.bindingVersion,
    binding.sessionKey ?? null, binding.outboundCursor).toArray()[0]
    return row?.outbound_claim_expires_at === undefined || row.outbound_claim_expires_at === null
      ? undefined
      : Number(row.outbound_claim_expires_at)
  }

  ownsOutboundClaim(owner: string): boolean {
    return this.sql.exec(`SELECT 1 FROM boring_channel_bindings
      WHERE outbound_claim_owner=? AND outbound_claim_expires_at>?`, owner, Date.now()).toArray().length === 1
  }

  renewOutbound(owner: string, claimTtlMs = OUTBOUND_CLAIM_TTL_MS): boolean {
    return this.sql.exec(`UPDATE boring_channel_bindings SET outbound_claim_expires_at=?
      WHERE outbound_claim_owner=? AND outbound_claim_expires_at>? RETURNING channel`,
    Date.now() + claimTtlMs, owner, Date.now()).toArray().length === 1
  }

  releaseOutbound(owner: string): void {
    this.sql.exec(`UPDATE boring_channel_bindings
      SET outbound_claim_owner=NULL, outbound_claim_expires_at=NULL
      WHERE outbound_claim_owner=?`, owner)
  }

  parkOutboundBinding(binding: ChannelBinding, claimOwner: string, errorCode: string): boolean {
    return this.runTransaction(() => {
      const updated = this.sql.exec(`UPDATE boring_channel_bindings SET outbound_status='parked'
        WHERE channel=? AND conversation_key=? AND agent_type_id=? AND binding_version=?
          AND status='active' AND session_key IS ? AND outbound_cursor=?
          AND outbound_claim_owner=? AND outbound_claim_expires_at>? RETURNING channel`,
      binding.channel, binding.conversationKey, binding.agentTypeId, binding.bindingVersion,
      binding.sessionKey ?? null, binding.outboundCursor, claimOwner, Date.now()).toArray()
      if (updated.length !== 1) return false
      this.sql.exec(`INSERT OR IGNORE INTO boring_channel_outbound_parked
        (channel, conversation_key, agent_type_id, binding_version, terminal_offset, error_code, parked_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`, binding.channel, binding.conversationKey, binding.agentTypeId,
      binding.bindingVersion, binding.outboundCursor, errorCode, Date.now())
      return true
    }, 'immediate')
  }

  compareAndSetOutboundCursor(binding: ChannelBinding, claimOwner: string, nextCursor: string): boolean {
    return this.sql.exec(`UPDATE boring_channel_bindings SET outbound_cursor=?, session_reset_pending=0
      WHERE channel=? AND conversation_key=? AND agent_type_id=? AND binding_version=?
        AND status='active' AND outbound_status='active' AND session_key=? AND outbound_cursor=?
        AND outbound_claim_owner=? AND outbound_claim_expires_at>?
      RETURNING channel`, nextCursor, binding.channel, binding.conversationKey, binding.agentTypeId,
    binding.bindingVersion, binding.sessionKey ?? null, binding.outboundCursor,
    claimOwner, Date.now()).toArray().length === 1
  }

  markTemplateSent(binding: ChannelBinding, claimOwner: string): boolean {
    const marker = binding.lastInboundAt ?? 0
    return this.sql.exec(`UPDATE boring_channel_bindings SET template_sent_for_inbound_at=?
      WHERE channel=? AND conversation_key=? AND agent_type_id=? AND binding_version=?
        AND status='active' AND outbound_status='active'
        AND ((?=0 AND last_inbound_at IS NULL) OR last_inbound_at=?)
        AND template_sent_for_inbound_at IS NULL
        AND outbound_claim_owner=? AND outbound_claim_expires_at>? RETURNING channel`, marker,
    binding.channel, binding.conversationKey, binding.agentTypeId, binding.bindingVersion,
    marker, marker, claimOwner, Date.now()).toArray().length === 1
  }

  parkOutbound(binding: ChannelBinding, claimOwner: string, terminalOffset: string, errorCode: string): boolean {
    return this.runTransaction(() => {
      const updated = this.sql.exec(`UPDATE boring_channel_bindings
        SET outbound_cursor=?
        WHERE channel=? AND conversation_key=? AND agent_type_id=? AND binding_version=?
          AND status='active' AND outbound_status='active' AND session_key=? AND outbound_cursor=?
          AND outbound_claim_owner=? AND outbound_claim_expires_at>? RETURNING channel`,
      terminalOffset, binding.channel, binding.conversationKey, binding.agentTypeId,
      binding.bindingVersion, binding.sessionKey ?? null, binding.outboundCursor,
      claimOwner, Date.now()).toArray()
      if (updated.length !== 1) return false
      this.sql.exec(`INSERT OR IGNORE INTO boring_channel_outbound_parked
        (channel, conversation_key, agent_type_id, binding_version, terminal_offset, error_code, parked_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`, binding.channel, binding.conversationKey, binding.agentTypeId,
      binding.bindingVersion, terminalOffset, errorCode, Date.now())
      return true
    }, 'immediate')
  }

  acknowledgeSessionReset(binding: ChannelBinding, claimOwner: string): boolean {
    return this.sql.exec(`UPDATE boring_channel_bindings SET session_reset_pending=0
      WHERE channel=? AND conversation_key=? AND agent_type_id=? AND binding_version=?
        AND status='active' AND session_key=? AND session_reset_pending=1
        AND outbound_claim_owner=? AND outbound_claim_expires_at>? RETURNING channel`,
    binding.channel, binding.conversationKey, binding.agentTypeId, binding.bindingVersion,
    binding.sessionKey ?? null, claimOwner, Date.now()).toArray().length === 1
  }

  markSessionGone(binding: ChannelBinding, claimOwner: string): boolean {
    if (!binding.sessionKey) return false
    return this.sql.exec(`UPDATE boring_channel_bindings SET session_key=NULL,
        outbound_cursor='-1', outbound_status='active', session_reset_pending=1,
        template_sent_for_inbound_at=NULL, create_state=NULL, create_owner=NULL,
        create_expires_at=NULL, create_session_key=NULL
      WHERE channel=? AND conversation_key=? AND agent_type_id=? AND binding_version=?
        AND status='active' AND session_key=? AND outbound_cursor=?
        AND outbound_claim_owner=? AND outbound_claim_expires_at>? RETURNING channel`,
    binding.channel, binding.conversationKey, binding.agentTypeId, binding.bindingVersion,
    binding.sessionKey, binding.outboundCursor, claimOwner, Date.now()).toArray().length === 1
  }

  pendingBindings(): ChannelBinding[] {
    return this.sql.exec(`SELECT DISTINCT b.channel, b.conversation_key, b.agent_type_id,
      b.workspace_id, b.auth_subject_id, b.binding_version, b.status, b.session_key, b.last_inbound_at,
      b.outbound_cursor, b.outbound_status, b.session_reset_pending, b.template_sent_for_inbound_at
      FROM boring_channel_bindings b JOIN boring_channel_inbound_queue q
        ON q.channel=b.channel AND q.conversation_key=b.conversation_key AND q.agent_type_id=b.agent_type_id
      WHERE q.status IN ('pending', 'processing')`).toArray().map(bindingFromRow)
  }

  nextPending(
    channel: string,
    conversationKey: string,
    agentTypeId: string,
    claimOwner: string,
    claimTtlMs = INBOUND_CLAIM_TTL_MS,
  ): NextInboundResult {
    return this.runTransaction(() => {
      const now = Date.now()
      this.sql.exec(`UPDATE boring_channel_inbound_queue
        SET status='pending', claim_owner=NULL, claim_expires_at=NULL
        WHERE channel=? AND conversation_key=? AND agent_type_id=? AND status='processing'
          AND claim_expires_at<=?`, channel, conversationKey, agentTypeId, now)
      // The oldest unfinished row is a binding-wide database lock. A second
      // process cannot claim a later row while the first owns a live lease.
      const candidate = this.sql.exec(`SELECT * FROM boring_channel_inbound_queue
        WHERE channel=? AND conversation_key=? AND agent_type_id=? AND status IN ('pending', 'processing')
        ORDER BY id LIMIT 1`, channel, conversationKey, agentTypeId).toArray()[0]
      if (!candidate) return { disposition: 'empty' } as const
      if (candidate.status === 'processing') {
        return { disposition: 'blocked', retryAt: Number(candidate.claim_expires_at) } as const
      }
      const claimed = this.sql.exec(`UPDATE boring_channel_inbound_queue
        SET status='processing', attempts=attempts+1, claim_owner=?, claim_expires_at=?
        WHERE id=? AND status='pending' RETURNING *`, claimOwner, now + claimTtlMs, candidate.id).toArray()[0]
      return claimed
        ? { disposition: 'claimed', inbound: inboundFromRow(claimed) } as const
        : { disposition: 'blocked', retryAt: now + claimTtlMs } as const
    }, 'immediate')
  }

  renewInbound(id: number, claimOwner: string, claimTtlMs = INBOUND_CLAIM_TTL_MS): boolean {
    return this.sql.exec(`UPDATE boring_channel_inbound_queue SET claim_expires_at=?
      WHERE id=? AND status='processing' AND claim_owner=? RETURNING id`,
    Date.now() + claimTtlMs, id, claimOwner).toArray().length === 1
  }

  completeInbound(id: number, claimOwner: string): boolean {
    return this.sql.exec(`UPDATE boring_channel_inbound_queue
      SET status='processed', claim_owner=NULL, claim_expires_at=NULL, error_code=NULL
      WHERE id=? AND status='processing' AND claim_owner=? RETURNING id`, id, claimOwner).toArray().length === 1
  }

  retryInbound(id: number, claimOwner: string, errorCode: string): void {
    this.sql.exec(`UPDATE boring_channel_inbound_queue
      SET status='pending', claim_owner=NULL, claim_expires_at=NULL, error_code=?
      WHERE id=? AND status='processing' AND claim_owner=?`, errorCode, id, claimOwner)
  }

  parkInbound(id: number, errorCode: string, claimOwner?: string): void {
    this.sql.exec(`UPDATE boring_channel_inbound_queue
      SET status='parked', claim_owner=NULL, claim_expires_at=NULL, error_code=?
      WHERE id=?${claimOwner ? " AND status='processing' AND claim_owner=?" : ''}`,
    errorCode, id, ...(claimOwner ? [claimOwner] : []))
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
    outboundCursor: row.outbound_cursor === null || row.outbound_cursor === undefined ? '-1' : String(row.outbound_cursor),
    outboundStatus: (row.outbound_status ?? 'active') as ChannelOutboundStatus,
    sessionResetPending: Number(row.session_reset_pending ?? 0) === 1,
    ...(row.template_sent_for_inbound_at === null || row.template_sent_for_inbound_at === undefined
      ? {}
      : { templateSentForInboundAt: Number(row.template_sent_for_inbound_at) }),
  }
}

function intentionFromRow(row: Record<string, unknown>): ChannelIntentionRecord {
  const answerValues = row.answer_values_json ? JSON.parse(String(row.answer_values_json)) as Record<string, unknown> : undefined
  return {
    questionId: String(row.question_id),
    sessionId: String(row.session_id),
    channel: String(row.channel),
    conversationKey: String(row.conversation_key),
    agentTypeId: String(row.agent_type_id),
    bindingVersion: Number(row.binding_version),
    fieldName: String(row.field_name),
    options: JSON.parse(String(row.options_json)) as ChannelIntentionRecord['options'],
    ...(row.title ? { title: String(row.title) } : {}),
    ...(row.context ? { context: String(row.context) } : {}),
    status: row.status as ChannelIntentionRecord['status'],
    ...(answerValues ? { answerValues } : {}),
    ...(row.answer_provider_message_id ? { answerProviderMessageId: String(row.answer_provider_message_id) } : {}),
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
    claimOwner: String(row.claim_owner),
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

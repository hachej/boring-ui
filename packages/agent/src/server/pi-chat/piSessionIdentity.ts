import { ErrorCode } from '../../shared/error-codes'
import type { SessionSummary } from '../../shared/session'
import type { ChatModelSelection } from '../../shared/chat'

const DEFAULT_TITLE = 'New session'

export interface PiSessionRequestContext {
  workspaceId: string
  storageScope?: string
  authSubject?: string
  requestId: string
}

export interface PiSessionRecord {
  sessionId: string
  title?: string
  createdAt: string
  updatedAt: string
  turnCount?: number
  isStreaming?: boolean
}

export interface PiSessionCreateInit {
  title?: string
  modelDefault?: ChatModelSelection
}

export interface PiSessionMetadata {
  sessionId: string
  workspaceId: string
  storageScope?: string
  title: string
  createdAt: string
  updatedAt: string
  modelDefault?: ChatModelSelection
  lastSeq?: number
}

export interface PiSessionRepository {
  list(): Promise<PiSessionRecord[]>
  create(init?: { title?: string }): Promise<PiSessionRecord>
  delete(sessionId: string): Promise<void>
  exists(sessionId: string): Promise<boolean>
}

export interface PiSessionMetadataIndex {
  get(sessionId: string): Promise<PiSessionMetadata | undefined>
  listByWorkspace(workspaceId: string): Promise<PiSessionMetadata[]>
  upsert(metadata: PiSessionMetadata): Promise<void>
  delete(sessionId: string): Promise<void>
}

export class PiSessionAccessError extends Error {
  readonly code = ErrorCode.enum.SESSION_NOT_FOUND

  constructor(readonly sessionId: string) {
    super('session not found')
    this.name = 'PiSessionAccessError'
  }
}

export class InMemoryPiSessionMetadataIndex implements PiSessionMetadataIndex {
  private readonly metadata = new Map<string, PiSessionMetadata>()

  async get(sessionId: string): Promise<PiSessionMetadata | undefined> {
    return cloneMetadata(this.metadata.get(sessionId))
  }

  async listByWorkspace(workspaceId: string): Promise<PiSessionMetadata[]> {
    return Array.from(this.metadata.values())
      .filter((entry) => entry.workspaceId === workspaceId)
      .map((entry) => cloneRequiredMetadata(entry))
  }

  async upsert(metadata: PiSessionMetadata): Promise<void> {
    this.metadata.set(metadata.sessionId, cloneRequiredMetadata(metadata))
  }

  async delete(sessionId: string): Promise<void> {
    this.metadata.delete(sessionId)
  }
}

export interface PiSessionIdentityServiceOptions {
  repository: PiSessionRepository
  metadata: PiSessionMetadataIndex
}

export class PiSessionIdentityService {
  constructor(private readonly options: PiSessionIdentityServiceOptions) {}

  async create(ctx: PiSessionRequestContext, init: PiSessionCreateInit = {}): Promise<SessionSummary> {
    const record = await this.options.repository.create({ title: init.title })
    const title = init.title ?? record.title ?? DEFAULT_TITLE
    const createdAt = record.createdAt
    const updatedAt = record.updatedAt

    await this.options.metadata.upsert({
      sessionId: record.sessionId,
      workspaceId: ctx.workspaceId,
      storageScope: ctx.storageScope,
      title,
      createdAt,
      updatedAt,
      modelDefault: init.modelDefault,
    })

    return toSummary(record, { title, createdAt, updatedAt })
  }

  async list(ctx: PiSessionRequestContext, options: { activeSessionId?: string } = {}): Promise<SessionSummary[]> {
    const [records, metadata] = await Promise.all([
      this.options.repository.list(),
      this.options.metadata.listByWorkspace(ctx.workspaceId),
    ])
    const scopedMetadata = metadata.filter((entry) => belongsToContext(ctx, entry))
    const metadataById = new Map(scopedMetadata.map((entry) => [entry.sessionId, entry]))
    const recordsById = new Map(records.map((record) => [record.sessionId, record]))
    const summaries = new Map<string, SessionSummary>()

    for (const entry of scopedMetadata) {
      const record = recordsById.get(entry.sessionId)
      if (!record) continue
      summaries.set(entry.sessionId, toSummary(record, entry))
    }

    if (options.activeSessionId && metadataById.has(options.activeSessionId)) {
      const record = recordsById.get(options.activeSessionId)
      const entry = metadataById.get(options.activeSessionId)
      if (record && entry) summaries.set(options.activeSessionId, toSummary(record, entry))
    }

    return Array.from(summaries.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async resolveActiveSession(ctx: PiSessionRequestContext, activeSessionId?: string): Promise<SessionSummary | undefined> {
    if (activeSessionId) {
      try {
        const entry = await this.assertCanAccess(ctx, activeSessionId)
        const exists = await this.options.repository.exists(activeSessionId)
        if (exists) {
          const record = (await this.options.repository.list()).find((candidate) => candidate.sessionId === activeSessionId)
          if (record) return toSummary(record, entry)
        }
      } catch (err) {
        if (!(err instanceof PiSessionAccessError)) throw err
      }
    }

    return (await this.list(ctx))[0]
  }

  async assertCanAccess(ctx: PiSessionRequestContext, sessionId: string): Promise<PiSessionMetadata> {
    const metadata = await this.options.metadata.get(sessionId)
    if (!metadata || !belongsToContext(ctx, metadata)) {
      throw new PiSessionAccessError(sessionId)
    }
    const exists = await this.options.repository.exists(sessionId)
    if (!exists) throw new PiSessionAccessError(sessionId)
    return metadata
  }

  async delete(ctx: PiSessionRequestContext, sessionId: string): Promise<void> {
    await this.assertCanAccess(ctx, sessionId)
    await this.options.repository.delete(sessionId)
    await this.options.metadata.delete(sessionId)
  }
}

function belongsToContext(ctx: PiSessionRequestContext, metadata: PiSessionMetadata): boolean {
  if (metadata.workspaceId !== ctx.workspaceId) return false
  return (metadata.storageScope ?? '') === (ctx.storageScope ?? '')
}

function toSummary(record: PiSessionRecord, metadata: Pick<PiSessionMetadata, 'title' | 'createdAt' | 'updatedAt'>): SessionSummary {
  return {
    id: record.sessionId,
    title: metadata.title || record.title || DEFAULT_TITLE,
    createdAt: metadata.createdAt || record.createdAt,
    updatedAt: maxIso(metadata.updatedAt, record.updatedAt),
    turnCount: record.turnCount ?? 0,
  }
}

function maxIso(a: string, b: string): string {
  return a.localeCompare(b) >= 0 ? a : b
}

function cloneRequiredMetadata(metadata: PiSessionMetadata): PiSessionMetadata {
  return {
    ...metadata,
    modelDefault: metadata.modelDefault ? { ...metadata.modelDefault } : undefined,
  }
}

function cloneMetadata(metadata: PiSessionMetadata | undefined): PiSessionMetadata | undefined {
  return metadata ? cloneRequiredMetadata(metadata) : undefined
}

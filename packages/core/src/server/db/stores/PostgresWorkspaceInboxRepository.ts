import { and, desc, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type { WorkspaceInboxItem, WorkspaceInboxItemInput, WorkspaceInboxItemStatus, WorkspaceInboxItemViewState } from '../../../shared/types.js'
import { workspaceInboxItems, workspaceInboxItemViewStates } from '../schema.js'
import { inboxIdempotencyHash } from './workspaceInboxHash.js'

function toWorkspaceInboxItem(row: typeof workspaceInboxItems.$inferSelect): WorkspaceInboxItem {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    kind: row.kind as WorkspaceInboxItem['kind'],
    status: row.status as WorkspaceInboxItemStatus,
    title: row.title,
    description: row.description,
    sourceType: row.sourceType as WorkspaceInboxItem['sourceType'],
    sourceId: row.sourceId,
    sourceLabel: row.sourceLabel,
    sessionId: row.sessionId,
    targetLabel: row.targetLabel,
    artifact: row.artifact as WorkspaceInboxItem['artifact'],
    priority: row.priority,
    actions: Array.isArray(row.actions) ? row.actions as WorkspaceInboxItem['actions'] : [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export class PostgresWorkspaceInboxRepository {
  constructor(private readonly db: PostgresJsDatabase) {}

  async list(workspaceId: string, userId: string, filters: { status?: WorkspaceInboxItemStatus | 'all'; kind?: WorkspaceInboxItem['kind'] } = {}): Promise<{ items: WorkspaceInboxItem[]; viewState: WorkspaceInboxItemViewState[] }> {
    const conditions = [eq(workspaceInboxItems.workspaceId, workspaceId)]
    const status = filters.status ?? 'open'
    if (status !== 'all') conditions.push(eq(workspaceInboxItems.status, status))
    if (filters.kind) conditions.push(eq(workspaceInboxItems.kind, filters.kind))
    const rows = await this.db.select().from(workspaceInboxItems).where(and(...conditions)).orderBy(desc(workspaceInboxItems.updatedAt))
    const viewRows = await this.db
      .select({ itemId: workspaceInboxItemViewStates.itemId, pinned: workspaceInboxItemViewStates.pinned })
      .from(workspaceInboxItemViewStates)
      .where(and(eq(workspaceInboxItemViewStates.workspaceId, workspaceId), eq(workspaceInboxItemViewStates.userId, userId)))
    return { items: rows.map(toWorkspaceInboxItem), viewState: viewRows.map((row) => ({ itemId: row.itemId, pinned: row.pinned })) }
  }

  async create(workspaceId: string, input: WorkspaceInboxItemInput, idempotencyKey: string): Promise<{ item: WorkspaceInboxItem; created: boolean; conflict?: 'idempotency' | 'source' }> {
    const hash = inboxIdempotencyHash(input)
    const findByKey = () => this.db.select().from(workspaceInboxItems).where(and(eq(workspaceInboxItems.workspaceId, workspaceId), eq(workspaceInboxItems.idempotencyKey, idempotencyKey))).limit(1)
    const findBySource = () => this.db.select().from(workspaceInboxItems).where(and(eq(workspaceInboxItems.workspaceId, workspaceId), eq(workspaceInboxItems.sourceType, input.sourceType), eq(workspaceInboxItems.sourceId, input.sourceId))).limit(1)
    const existingByKey = await findByKey()
    if (existingByKey[0]) return existingByKey[0].idempotencyHash === hash ? { item: toWorkspaceInboxItem(existingByKey[0]), created: false } : { item: toWorkspaceInboxItem(existingByKey[0]), created: false, conflict: 'idempotency' }
    const existingBySource = await findBySource()
    if (existingBySource[0]) return { item: toWorkspaceInboxItem(existingBySource[0]), created: false, conflict: 'source' }
    try {
      const [row] = await this.db.insert(workspaceInboxItems).values({
        workspaceId, kind: input.kind, status: 'open', title: input.title, description: input.description,
        sourceType: input.sourceType, sourceId: input.sourceId, sourceLabel: input.sourceLabel,
        sessionId: input.sessionId ?? null, targetLabel: input.targetLabel ?? '', artifact: input.artifact ?? null,
        priority: input.priority ?? 0, actions: input.actions ?? [], idempotencyKey, idempotencyHash: hash,
      }).returning()
      return { item: toWorkspaceInboxItem(row), created: true }
    } catch (error) {
      const racedByKey = await findByKey()
      if (racedByKey[0]) return racedByKey[0].idempotencyHash === hash ? { item: toWorkspaceInboxItem(racedByKey[0]), created: false } : { item: toWorkspaceInboxItem(racedByKey[0]), created: false, conflict: 'idempotency' }
      const racedBySource = await findBySource()
      if (racedBySource[0]) return { item: toWorkspaceInboxItem(racedBySource[0]), created: false, conflict: 'source' }
      throw error
    }
  }

  async updateStatus(workspaceId: string, itemId: string, status: WorkspaceInboxItemStatus): Promise<WorkspaceInboxItem | null> {
    const [row] = await this.db.update(workspaceInboxItems).set({ status, updatedAt: new Date() }).where(and(eq(workspaceInboxItems.workspaceId, workspaceId), eq(workspaceInboxItems.id, itemId))).returning()
    return row ? toWorkspaceInboxItem(row) : null
  }

  async putViewState(workspaceId: string, userId: string, itemId: string, state: { pinned?: boolean }): Promise<WorkspaceInboxItemViewState | null> {
    const existing = await this.db.select({ id: workspaceInboxItems.id }).from(workspaceInboxItems).where(and(eq(workspaceInboxItems.workspaceId, workspaceId), eq(workspaceInboxItems.id, itemId))).limit(1)
    if (!existing[0]) return null
    const pinned = state.pinned ?? false
    await this.db.insert(workspaceInboxItemViewStates).values({ workspaceId, itemId, userId, pinned })
      .onConflictDoUpdate({
        target: [workspaceInboxItemViewStates.workspaceId, workspaceInboxItemViewStates.itemId, workspaceInboxItemViewStates.userId],
        set: { pinned, updatedAt: new Date() },
      })
    return { itemId, pinned }
  }
}

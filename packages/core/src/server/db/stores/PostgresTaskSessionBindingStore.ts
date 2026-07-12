import { and, desc, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

import { taskSessionBindings } from '../schema.js'

export interface TaskSessionBindingRecord {
  id: string
  workspaceId: string
  adapterId: string
  taskId: string
  sessionId: string
  title?: string
  createdAt: string
}

export interface TaskSessionBindingCreateInput {
  workspaceId: string
  adapterId: string
  taskId: string
  sessionId: string
  title?: string
}

export interface TaskSessionBindingListInput {
  workspaceId: string
  adapterId: string
  taskId: string
}

export interface TaskSessionBindingDeleteInput {
  workspaceId: string
  bindingId: string
}

export class PostgresTaskSessionBindingStoreError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = 'PostgresTaskSessionBindingStoreError'
  }
}

type DbLike = Pick<PostgresJsDatabase, 'select' | 'insert' | 'delete'>

function toIso(value: Date | string): string {
  return typeof value === 'string' ? new Date(value).toISOString() : value.toISOString()
}

function toBinding(row: typeof taskSessionBindings.$inferSelect): TaskSessionBindingRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    adapterId: row.adapterId,
    taskId: row.taskId,
    sessionId: row.sessionId,
    ...(row.title ? { title: row.title } : {}),
    createdAt: toIso(row.createdAt),
  }
}

function bindingNotFound(id: string): PostgresTaskSessionBindingStoreError {
  return new PostgresTaskSessionBindingStoreError(404, 'TASK_SESSION_BINDING_NOT_FOUND', `Task session binding not found: ${id}`)
}

export class PostgresTaskSessionBindingStore {
  constructor(private readonly db: DbLike) {}

  async listBindings(input: TaskSessionBindingListInput): Promise<TaskSessionBindingRecord[]> {
    const rows = await this.db
      .select()
      .from(taskSessionBindings)
      .where(and(
        eq(taskSessionBindings.workspaceId, input.workspaceId),
        eq(taskSessionBindings.adapterId, input.adapterId),
        eq(taskSessionBindings.taskId, input.taskId),
      ))
      .orderBy(desc(taskSessionBindings.createdAt))

    return rows.map(toBinding)
  }

  async createBinding(input: TaskSessionBindingCreateInput): Promise<TaskSessionBindingRecord> {
    const inserted = await this.db
      .insert(taskSessionBindings)
      .values({
        workspaceId: input.workspaceId,
        adapterId: input.adapterId,
        taskId: input.taskId,
        sessionId: input.sessionId,
        title: input.title ?? null,
      })
      .onConflictDoNothing({
        target: [
          taskSessionBindings.workspaceId,
          taskSessionBindings.adapterId,
          taskSessionBindings.taskId,
          taskSessionBindings.sessionId,
        ],
      })
      .returning()

    if (inserted[0]) return toBinding(inserted[0])

    const existing = await this.db
      .select()
      .from(taskSessionBindings)
      .where(and(
        eq(taskSessionBindings.workspaceId, input.workspaceId),
        eq(taskSessionBindings.adapterId, input.adapterId),
        eq(taskSessionBindings.taskId, input.taskId),
        eq(taskSessionBindings.sessionId, input.sessionId),
      ))
      .limit(1)

    if (!existing[0]) {
      throw new PostgresTaskSessionBindingStoreError(500, 'TASK_SESSION_BINDING_CONFLICT', 'Task session binding conflict could not be resolved')
    }
    return toBinding(existing[0])
  }

  async deleteBinding(input: TaskSessionBindingDeleteInput): Promise<void> {
    const deleted = await this.db
      .delete(taskSessionBindings)
      .where(and(
        eq(taskSessionBindings.workspaceId, input.workspaceId),
        eq(taskSessionBindings.id, input.bindingId),
      ))
      .returning({ id: taskSessionBindings.id })

    if (!deleted[0]) throw bindingNotFound(input.bindingId)
  }
}

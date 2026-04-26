import { eq, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { users } from '../../../../drizzle/schema.js'
import { userSettings } from '../schema.js'
import type { UserStore } from '../../app/types.js'
import type { User } from '../../../shared/types.js'

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function rowToUser(row: typeof users.$inferSelect): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    emailVerified: row.email_verified,
    image: row.image,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

export class PostgresUserStore implements UserStore {
  constructor(private db: PostgresJsDatabase) {}

  async getById(id: string): Promise<User | null> {
    const rows = await this.db.select().from(users).where(eq(users.id, id)).limit(1)
    return rows.length > 0 ? rowToUser(rows[0]) : null
  }

  async getByEmail(email: string): Promise<User | null> {
    const normalized = normalizeEmail(email)
    const rows = await this.db
      .select()
      .from(users)
      .where(eq(users.email, normalized))
      .limit(1)
    return rows.length > 0 ? rowToUser(rows[0]) : null
  }

  async upsert(userId: string, data: { email: string; name?: string }): Promise<User> {
    const normalized = normalizeEmail(data.email)
    const rows = await this.db
      .insert(users)
      .values({
        id: userId,
        email: normalized,
        name: data.name ?? '',
        email_verified: false,
      })
      .onConflictDoUpdate({
        target: users.id,
        set: {
          email: normalized,
          ...(data.name !== undefined ? { name: data.name } : {}),
          updated_at: new Date(),
        },
      })
      .returning()
    return rowToUser(rows[0])
  }

  async getUserSettings(
    userId: string,
    appId: string,
  ): Promise<{ displayName: string; email: string; settings: Record<string, unknown> }> {
    const rows = await this.db
      .select()
      .from(userSettings)
      .where(
        sql`${userSettings.userId} = ${userId} AND ${userSettings.appId} = ${appId}`,
      )
      .limit(1)

    if (rows.length === 0) {
      const user = await this.getById(userId)
      return {
        displayName: user?.name ?? '',
        email: user?.email ?? '',
        settings: {},
      }
    }

    return {
      displayName: rows[0].displayName,
      email: rows[0].email,
      settings: (rows[0].settings ?? {}) as Record<string, unknown>,
    }
  }

  async putUserSettings(
    userId: string,
    appId: string,
    updates: { displayName?: string; email?: string; settings?: Record<string, unknown> },
  ): Promise<{ displayName: string; email: string; settings: Record<string, unknown> }> {
    const rows = await this.db
      .insert(userSettings)
      .values({
        userId,
        appId,
        displayName: updates.displayName ?? '',
        email: updates.email ?? '',
        settings: updates.settings ?? {},
      })
      .onConflictDoUpdate({
        target: [userSettings.userId, userSettings.appId],
        set: {
          ...(updates.displayName !== undefined ? { displayName: updates.displayName } : {}),
          ...(updates.email !== undefined ? { email: updates.email } : {}),
          ...(updates.settings !== undefined ? { settings: updates.settings } : {}),
          updatedAt: new Date(),
        },
      })
      .returning()

    return {
      displayName: rows[0].displayName,
      email: rows[0].email,
      settings: (rows[0].settings ?? {}) as Record<string, unknown>,
    }
  }
}

import { eq, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { users } from '../../../../drizzle/schema.js'
import { userSettings } from '../schema.js'
import type { UserStore } from '../../app/types.js'
import type { User } from '../../../shared/types.js'

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function jsonbSetPathExpression(path: string[], value: unknown) {
  let expression = sql`${userSettings.settings}`
  for (let i = 1; i < path.length; i += 1) {
    const prefix = path.slice(0, i)
    const existingObject = sql`CASE
      WHEN jsonb_typeof(${userSettings.settings} #> ${prefix}::text[]) = 'object'
      THEN ${userSettings.settings} #> ${prefix}::text[]
      ELSE '{}'::jsonb
    END`
    expression = sql`jsonb_set(${expression}, ${prefix}::text[], ${existingObject}, true)`
  }
  return sql`jsonb_set(${expression}, ${path}::text[], ${JSON.stringify(value)}::jsonb, true)`
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
    const current = await this.getUserSettings(userId, appId)
    const nextDisplayName = updates.displayName ?? current.displayName
    const nextEmail = updates.email ?? current.email
    const nextSettings = updates.settings ?? current.settings

    const rows = await this.db
      .insert(userSettings)
      .values({
        userId,
        appId,
        displayName: nextDisplayName,
        email: nextEmail,
        settings: nextSettings,
      })
      .onConflictDoUpdate({
        target: [userSettings.userId, userSettings.appId],
        set: {
          displayName: nextDisplayName,
          email: nextEmail,
          settings: nextSettings,
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

  async putClientUserSettings(
    userId: string,
    appId: string,
    updates: { displayName?: string; settings?: Record<string, unknown> },
  ): Promise<{ displayName: string; email: string; settings: Record<string, unknown> }> {
    if (!updates.settings) return await this.putUserSettings(userId, appId, { displayName: updates.displayName })
    const current = await this.getUserSettings(userId, appId)
    const clientSettings = Object.fromEntries(
      Object.entries(updates.settings).filter(([key]) => !key.startsWith('__server')),
    )
    const nextDisplayName = updates.displayName ?? current.displayName
    const nextEmail = current.email
    const rows = await this.db
      .insert(userSettings)
      .values({
        userId,
        appId,
        displayName: nextDisplayName,
        email: nextEmail,
        settings: clientSettings,
      })
      .onConflictDoUpdate({
        target: [userSettings.userId, userSettings.appId],
        set: {
          displayName: nextDisplayName,
          settings: sql`(
            SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb)
            FROM jsonb_each(${userSettings.settings})
            WHERE left(key, 8) = '__server'
          ) || ${JSON.stringify(clientSettings)}::jsonb`,
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

  async patchUserSettingsJsonPath(
    userId: string,
    appId: string,
    path: string[],
    value: unknown,
  ): Promise<{ displayName: string; email: string; settings: Record<string, unknown> }> {
    if (path.length === 0) throw new Error('settings JSON path must not be empty')
    const user = await this.getById(userId)
    const rows = await this.db.transaction(async (tx) => {
      await tx
        .insert(userSettings)
        .values({
          userId,
          appId,
          displayName: user?.name ?? '',
          email: user?.email ?? '',
          settings: {},
        })
        .onConflictDoNothing({ target: [userSettings.userId, userSettings.appId] })

      return await tx
        .update(userSettings)
        .set({
          settings: jsonbSetPathExpression(path, value),
          updatedAt: new Date(),
        })
        .where(sql`${userSettings.userId} = ${userId} AND ${userSettings.appId} = ${appId}`)
        .returning()
    })

    return {
      displayName: rows[0].displayName,
      email: rows[0].email,
      settings: (rows[0].settings ?? {}) as Record<string, unknown>,
    }
  }
}

import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'

import { runMigrations } from '../../migrate'
import { PostgresTaskSessionBindingStore } from '../PostgresTaskSessionBindingStore'
import { taskSessionBindings } from '../../schema'
import type { CoreConfig } from '../../../../shared/types'

const TEST_DB_URL = process.env.DATABASE_URL
const LOCAL_SOCKET_DATABASE = process.env.PGDATABASE ?? 'boring_ui_test'
const LOCAL_SOCKET_USER = process.env.PGUSER ?? process.env.USER ?? 'ubuntu'
const TEST_WORKSPACE_PREFIX = 'task-bindings-test-'

const BASE_CONFIG: CoreConfig = {
  appId: 'task-session-bindings-test',
  appName: 'Task Session Bindings Test',
  appLogo: null,
  port: 0,
  host: '127.0.0.1',
  staticDir: null,
  databaseUrl: TEST_DB_URL ?? 'postgres://unused.invalid/unused',
  stores: 'postgres',
  cors: { origins: ['http://localhost:3000'], credentials: true },
  bodyLimit: 16 * 1024 * 1024,
  logLevel: 'silent' as CoreConfig['logLevel'],
  encryption: { workspaceSettingsKey: 'a'.repeat(64) },
  auth: {
    secret: 's'.repeat(64),
    url: 'http://localhost:3000',
    sessionTtlSeconds: 3600,
    sessionCookieSecure: false,
  },
  features: { githubOauth: false, googleOauth: false, invitesEnabled: true, sendWelcomeEmail: true, inviteTtlDays: 7 },
}

let sqlClient: postgres.Sql
let store: PostgresTaskSessionBindingStore

function workspaceId(suffix: string = randomUUID()): string {
  return `${TEST_WORKSPACE_PREFIX}${suffix}`
}

async function readTaskBindingMigration(): Promise<string> {
  return await readFile(resolve(__dirname, '../../../../../drizzle/0018_task_session_bindings.sql'), 'utf-8')
}

async function applyTaskBindingMigrationForLocalSocket(sqlClient: postgres.Sql): Promise<void> {
  await sqlClient`CREATE EXTENSION IF NOT EXISTS pgcrypto`
  const migration = await readTaskBindingMigration()
  const compatibleMigration = migration
    .replace('CREATE TABLE "boring_task_session_bindings"', 'CREATE TABLE IF NOT EXISTS "boring_task_session_bindings"')
    .replace('CREATE UNIQUE INDEX "boring_task_session_bindings_tuple_idx"', 'CREATE UNIQUE INDEX IF NOT EXISTS "boring_task_session_bindings_tuple_idx"')
    .replace('CREATE INDEX "boring_task_session_bindings_task_idx"', 'CREATE INDEX IF NOT EXISTS "boring_task_session_bindings_task_idx"')
  for (const statement of compatibleMigration.split('--> statement-breakpoint')) {
    const trimmed = statement.trim()
    if (trimmed) await sqlClient.unsafe(trimmed)
  }
}

describe('PostgresTaskSessionBindingStore schema contract', () => {
  it('keeps the migration and Drizzle schema aligned on tuple uniqueness and task lookup indexes', async () => {
    const migration = await readTaskBindingMigration()
    const table = taskSessionBindings as unknown as {
      [key: string]: unknown
      workspaceId: unknown
      adapterId: unknown
      taskId: unknown
      sessionId: unknown
      createdAt: unknown
    }

    expect(table.workspaceId).toBeTruthy()
    expect(table.adapterId).toBeTruthy()
    expect(table.taskId).toBeTruthy()
    expect(table.sessionId).toBeTruthy()
    expect(table.createdAt).toBeTruthy()
    expect(migration).toContain('CREATE TABLE "boring_task_session_bindings"')
    expect(migration).toContain('"workspace_id" text NOT NULL')
    expect(migration).toContain('"adapter_id" text NOT NULL')
    expect(migration).toContain('"task_id" text NOT NULL')
    expect(migration).toContain('"session_id" text NOT NULL')
    expect(migration).toContain('CREATE UNIQUE INDEX "boring_task_session_bindings_tuple_idx"')
    expect(migration).toContain('("workspace_id","adapter_id","task_id","session_id")')
    expect(migration).toContain('CREATE INDEX "boring_task_session_bindings_task_idx"')
    expect(migration).toContain('("workspace_id","adapter_id","task_id","created_at")')
  })
})

describe('PostgresTaskSessionBindingStore', () => {
  beforeAll(async () => {
    if (TEST_DB_URL) {
      await runMigrations(BASE_CONFIG)
      sqlClient = postgres(TEST_DB_URL, { max: 4 })
    } else {
      sqlClient = postgres({ host: '/var/run/postgresql', database: LOCAL_SOCKET_DATABASE, username: LOCAL_SOCKET_USER, max: 4 })
      await applyTaskBindingMigrationForLocalSocket(sqlClient)
    }
    store = new PostgresTaskSessionBindingStore(drizzle(sqlClient))
  })

  afterAll(async () => {
    await sqlClient?.end()
  })

  beforeEach(async () => {
    await sqlClient`DELETE FROM boring_task_session_bindings WHERE workspace_id LIKE ${`${TEST_WORKSPACE_PREFIX}%`}`
  })
  it('creates idempotent unique workspace/adapter/task/session bindings and lists newest first', async () => {
    const ws = workspaceId()
    const first = await store.createBinding({ workspaceId: ws, adapterId: 'github', taskId: '1', sessionId: 'pi-1', title: 'One' })
    const duplicate = await store.createBinding({ workspaceId: ws, adapterId: 'github', taskId: '1', sessionId: 'pi-1', title: 'Changed' })
    const second = await store.createBinding({ workspaceId: ws, adapterId: 'github', taskId: '1', sessionId: 'pi-2', title: 'Two' })
    await store.createBinding({ workspaceId: workspaceId(), adapterId: 'github', taskId: '1', sessionId: 'pi-1' })
    await store.createBinding({ workspaceId: ws, adapterId: 'github', taskId: '2', sessionId: 'pi-1' })

    expect(duplicate).toEqual(first)
    await expect(store.listBindings({ workspaceId: ws, adapterId: 'github', taskId: '1' })).resolves.toEqual([second, first])
  })

  it('serializes concurrent links through the database unique tuple', async () => {
    const ws = workspaceId()
    const created = await Promise.all(Array.from({ length: 10 }, () => store.createBinding({
      workspaceId: ws,
      adapterId: 'github',
      taskId: '1',
      sessionId: 'pi-1',
      title: 'One',
    })))

    expect(new Set(created.map((binding) => binding.id)).size).toBe(1)
    await expect(store.listBindings({ workspaceId: ws, adapterId: 'github', taskId: '1' })).resolves.toHaveLength(1)
  })

  it('handles concurrent link and unlink deterministically', async () => {
    const ws = workspaceId()
    const existing = await store.createBinding({ workspaceId: ws, adapterId: 'github', taskId: '1', sessionId: 'pi-1' })

    await Promise.all([
      store.deleteBinding({ workspaceId: ws, bindingId: existing.id }),
      store.createBinding({ workspaceId: ws, adapterId: 'github', taskId: '1', sessionId: 'pi-2' }),
    ])

    await expect(store.listBindings({ workspaceId: ws, adapterId: 'github', taskId: '1' })).resolves.toEqual([
      expect.objectContaining({ sessionId: 'pi-2' }),
    ])
  })

  it('isolates workspaces and survives host restart or sandbox replacement', async () => {
    const wsA = workspaceId('a')
    const wsB = workspaceId('b')
    const binding = await store.createBinding({ workspaceId: wsA, adapterId: 'github', taskId: '614', sessionId: 'pi-a', title: 'Hosted A' })
    await store.createBinding({ workspaceId: wsB, adapterId: 'github', taskId: '614', sessionId: 'pi-b', title: 'Hosted B' })

    const restartedHostStore = new PostgresTaskSessionBindingStore(drizzle(sqlClient))
    await expect(restartedHostStore.listBindings({ workspaceId: wsA, adapterId: 'github', taskId: '614' })).resolves.toEqual([binding])
    await expect(restartedHostStore.listBindings({ workspaceId: wsB, adapterId: 'github', taskId: '614' })).resolves.toEqual([
      expect.objectContaining({ workspaceId: wsB, sessionId: 'pi-b' }),
    ])
  })

  it('unlinks only inside the requested workspace', async () => {
    const wsA = workspaceId('unlink-a')
    const wsB = workspaceId('unlink-b')
    const binding = await store.createBinding({ workspaceId: wsA, adapterId: 'github', taskId: '1', sessionId: 'pi-1' })
    await expect(store.deleteBinding({ workspaceId: wsB, bindingId: binding.id })).rejects.toMatchObject({
      status: 404,
      code: 'TASK_SESSION_BINDING_NOT_FOUND',
    })
    await expect(store.listBindings({ workspaceId: wsA, adapterId: 'github', taskId: '1' })).resolves.toEqual([binding])

    await store.deleteBinding({ workspaceId: wsA, bindingId: binding.id })
    await expect(store.listBindings({ workspaceId: wsA, adapterId: 'github', taskId: '1' })).resolves.toEqual([])
  })
})

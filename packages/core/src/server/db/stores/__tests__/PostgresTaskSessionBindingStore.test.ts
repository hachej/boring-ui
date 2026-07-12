import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'

import { runMigrations } from '../../migrate'
import { PostgresTaskSessionBindingStore } from '../PostgresTaskSessionBindingStore'
import { taskSessionBindings } from '../../schema'
import type { CoreConfig } from '../../../../shared/types'
import { resolveCoreTestDatabase, type CoreTestDatabase } from '../../__tests__/testDatabase'
import { runTaskSessionBindingStoreConformance } from '../../../../../../../plugins/tasks/src/server/__tests__/sessionBindingStore.conformance'

const TEST_WORKSPACES = ['workspace-a', 'workspace-b']

function baseConfig(databaseUrl: string): CoreConfig {
  return {
    appId: 'task-session-bindings-test',
    appName: 'Task Session Bindings Test',
    appLogo: null,
    port: 0,
    host: '127.0.0.1',
    staticDir: null,
    databaseUrl,
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
}

const TEST_DB: CoreTestDatabase | undefined = await resolveCoreTestDatabase('task_bindings')

let sqlClient: postgres.Sql
let store: PostgresTaskSessionBindingStore

async function readTaskBindingMigration(): Promise<string> {
  return await readFile(resolve(__dirname, '../../../../../drizzle/0018_task_session_bindings.sql'), 'utf-8')
}

beforeAll(async () => {
  if (!TEST_DB) return
  await runMigrations(baseConfig(TEST_DB.databaseUrl))
  sqlClient = postgres(TEST_DB.databaseUrl, { max: 5 })
  store = new PostgresTaskSessionBindingStore(drizzle(sqlClient))
})

afterAll(async () => {
  await sqlClient?.end()
  await TEST_DB?.cleanup()
})

beforeEach(async () => {
  if (!sqlClient) return
  await sqlClient`DELETE FROM boring_task_session_bindings WHERE workspace_id IN ${sqlClient(TEST_WORKSPACES)}`
})

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

describe.runIf(TEST_DB)('PostgresTaskSessionBindingStore', () => {
  runTaskSessionBindingStoreConformance({
    name: 'PostgresTaskSessionBindingStore',
    createStore: () => store,
    createReopenedStore: () => new PostgresTaskSessionBindingStore(drizzle(sqlClient)),
  })

  it('does not report a conflict when a duplicate link races an unlink', async () => {
    for (let index = 0; index < 25; index += 1) {
      const taskId = `race-${index}`
      const input = { workspaceId: 'workspace-a', adapterId: 'github', taskId, sessionId: 'pi-race', title: 'Race' }
      const existing = await store.createBinding(input)

      const results = await Promise.allSettled([
        store.createBinding(input),
        store.deleteBinding({ workspaceId: 'workspace-a', bindingId: existing.id }),
      ])
      expect(results).toEqual([
        expect.objectContaining({ status: 'fulfilled' }),
        expect.objectContaining({ status: 'fulfilled' }),
      ])

      const remaining = await store.listBindings({ workspaceId: 'workspace-a', adapterId: 'github', taskId })
      expect(remaining).toEqual(
        remaining.length === 0
          ? []
          : [expect.objectContaining({ workspaceId: 'workspace-a', adapterId: 'github', taskId, sessionId: 'pi-race' })],
      )
    }
  })

  it('is backed by the real migrated Postgres table and unique index', async () => {
    const binding = await store.createBinding({ workspaceId: 'workspace-a', adapterId: 'github', taskId: '614', sessionId: 'pi-a', title: 'Hosted A' })
    const rows = await sqlClient`
      SELECT workspace_id, adapter_id, task_id, session_id, title
      FROM boring_task_session_bindings
      WHERE id = ${binding.id}
    `
    expect(rows).toEqual([{ workspace_id: 'workspace-a', adapter_id: 'github', task_id: '614', session_id: 'pi-a', title: 'Hosted A' }])

    const indexes = await sqlClient`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'boring_task_session_bindings'
      ORDER BY indexname
    `
    expect(indexes.map((row) => row.indexname)).toEqual(expect.arrayContaining([
      'boring_task_session_bindings_task_idx',
      'boring_task_session_bindings_tuple_idx',
    ]))
  })
})

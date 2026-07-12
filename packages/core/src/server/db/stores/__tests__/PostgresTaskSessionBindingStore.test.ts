import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'

import { runMigrations } from '../../migrate'
import { PostgresTaskSessionBindingStore } from '../PostgresTaskSessionBindingStore'
import type { CoreConfig } from '../../../../shared/types'

const TEST_DB_URL = process.env.DATABASE_URL
const TEST_WORKSPACE_PREFIX = 'task-bindings-test-'
const describePostgres = TEST_DB_URL ? describe : describe.skip

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

describePostgres('PostgresTaskSessionBindingStore', () => {
  beforeAll(async () => {
    await runMigrations(BASE_CONFIG)
    sqlClient = postgres(TEST_DB_URL!, { max: 4 })
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

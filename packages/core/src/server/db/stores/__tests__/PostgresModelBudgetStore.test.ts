import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { runMigrations } from '../../migrate'
import { ModelBudgetExceededError, PostgresModelBudgetStore } from '../PostgresModelBudgetStore'
import type { CoreConfig } from '../../../../shared/types'

const TEST_DB_URL = process.env.DATABASE_URL ?? 'postgres://ubuntu:test@localhost/boring_ui_test'
const USER = 'budget-user-1'
const OTHER_USER = 'budget-user-2'

const BASE_CONFIG: CoreConfig = {
  appId: 'test-app', appName: 'Test App', appLogo: null, port: 0, host: '127.0.0.1', staticDir: null,
  databaseUrl: TEST_DB_URL, stores: 'postgres', cors: { origins: ['http://localhost:3000'], credentials: true },
  bodyLimit: 16 * 1024 * 1024, logLevel: 'silent' as CoreConfig['logLevel'], encryption: { workspaceSettingsKey: 'a'.repeat(64) },
  auth: { secret: 's'.repeat(64), url: 'http://localhost:3000', sessionTtlSeconds: 3600, sessionCookieSecure: false },
  features: { githubOauth: false, googleOauth: false, invitesEnabled: true, sendWelcomeEmail: true, inviteTtlDays: 7 },
}

let sqlClient: postgres.Sql
let store: PostgresModelBudgetStore

beforeAll(async () => {
  await runMigrations(BASE_CONFIG)
  sqlClient = postgres(TEST_DB_URL, { max: 5 })
  store = new PostgresModelBudgetStore(drizzle(sqlClient))
})

afterAll(async () => {
  await sqlClient?.end()
})

beforeEach(async () => {
  await sqlClient`DELETE FROM boring_model_budget_reservations WHERE user_id IN (${USER}, ${OTHER_USER})`
  await sqlClient`DELETE FROM boring_usage_ledger WHERE user_id IN (${USER}, ${OTHER_USER})`
})

describe('PostgresModelBudgetStore', () => {
  it('idempotently reserves and settles/releases active holds', async () => {
    const now = new Date('2026-07-15T12:00:00Z')
    const first = await store.reserve({ userId: USER, runId: 'run-1', provider: 'infomaniak', model: 'qwen', budgetMicros: 2_000_000, holdMicros: 1_000_000, ttlSeconds: 60, now })
    const second = await store.reserve({ userId: USER, runId: 'run-1', provider: 'infomaniak', model: 'qwen', budgetMicros: 2_000_000, holdMicros: 1_000_000, ttlSeconds: 60, now })

    expect(second).toEqual({ ...first, created: false })
    await store.settle({ reservationId: first.reservationId })
    const settled = await sqlClient`SELECT status FROM boring_model_budget_reservations WHERE id = ${first.reservationId}`
    expect(settled[0]?.status).toBe('settled')

    const released = await store.reserve({ userId: USER, runId: 'run-2', provider: 'infomaniak', model: 'qwen', budgetMicros: 2_000_000, holdMicros: 1_000_000, ttlSeconds: 60, now })
    await store.release({ reservationId: released.reservationId })
    const rows = await sqlClient`SELECT status FROM boring_model_budget_reservations WHERE id = ${released.reservationId}`
    expect(rows[0]?.status).toBe('released')
  })

  it('includes ledger and active holds, and frees expired holds', async () => {
    const now = new Date('2026-07-15T12:00:00Z')
    await sqlClient`
      INSERT INTO boring_usage_ledger (id, user_id, run_id, provider, model, billed_cost_micros, created_at)
      VALUES ('usage-budget-1', ${USER}, 'ledger-run', 'infomaniak', 'qwen', 700000, ${now.toISOString()}::timestamp)
    `
    await store.reserve({ userId: USER, runId: 'run-active', provider: 'infomaniak', model: 'qwen', budgetMicros: 2_000_000, holdMicros: 1_000_000, ttlSeconds: 60, now })

    await expect(store.reserve({ userId: USER, runId: 'run-over', provider: 'infomaniak', model: 'qwen', budgetMicros: 2_000_000, holdMicros: 500_000, ttlSeconds: 60, now })).rejects.toBeInstanceOf(ModelBudgetExceededError)

    expect(await store.sweepExpired(new Date(now.getTime() + 120_000))).toBe(1)
    await expect(store.reserve({ userId: USER, runId: 'run-after-expiry', provider: 'infomaniak', model: 'qwen', budgetMicros: 2_000_000, holdMicros: 500_000, ttlSeconds: 60, now: new Date(now.getTime() + 120_000) })).resolves.toMatchObject({ created: true })
  })

  it('scopes active reservation idempotency by user and run id', async () => {
    const now = new Date('2026-07-15T12:00:00Z')
    const first = await store.reserve({ userId: USER, runId: 'shared-run', provider: 'infomaniak', model: 'qwen', budgetMicros: 2_000_000, holdMicros: 1_000_000, ttlSeconds: 60, now })
    const secondUser = await store.reserve({ userId: OTHER_USER, runId: 'shared-run', provider: 'infomaniak', model: 'qwen', budgetMicros: 2_000_000, holdMicros: 1_000_000, ttlSeconds: 60, now })

    expect(secondUser.created).toBe(true)
    expect(secondUser.reservationId).not.toBe(first.reservationId)
  })

  it('counts settled fallback holds against later budget checks without double-counting partial ledger rows', async () => {
    const now = new Date('2026-07-15T12:00:00Z')
    const fallback = await store.reserve({ userId: USER, runId: 'fallback-run', provider: 'infomaniak', model: 'qwen', budgetMicros: 1_500_000, holdMicros: 1_000_000, ttlSeconds: 60, now })
    await sqlClient`
      INSERT INTO boring_usage_ledger (id, user_id, run_id, provider, model, billed_cost_micros, created_at)
      VALUES ('usage-budget-partial-fallback', ${USER}, 'fallback-run', 'infomaniak', 'qwen', 200000, ${now.toISOString()}::timestamp)
    `
    await store.settle({ reservationId: fallback.reservationId })

    await expect(store.reserve({ userId: USER, runId: 'next-run-ok', provider: 'infomaniak', model: 'qwen', budgetMicros: 1_500_000, holdMicros: 500_000, ttlSeconds: 60, now })).resolves.toMatchObject({ created: true })
    await store.release({ runId: 'next-run-ok', userId: USER })
    await expect(store.reserve({ userId: USER, runId: 'next-run-over', provider: 'infomaniak', model: 'qwen', budgetMicros: 1_500_000, holdMicros: 600_000, ttlSeconds: 60, now })).rejects.toBeInstanceOf(ModelBudgetExceededError)
    await expect(store.reserve({ userId: OTHER_USER, runId: 'next-run-over', provider: 'infomaniak', model: 'qwen', budgetMicros: 1_500_000, holdMicros: 600_000, ttlSeconds: 60, now })).resolves.toMatchObject({ created: true })
  })

  it('does not double-count ledger rows for runs with active holds', async () => {
    const now = new Date('2026-07-15T12:00:00Z')
    await store.reserve({ userId: USER, runId: 'same-run', provider: 'infomaniak', model: 'qwen', budgetMicros: 1_500_000, holdMicros: 1_000_000, ttlSeconds: 60, now })
    await sqlClient`
      INSERT INTO boring_usage_ledger (id, user_id, run_id, provider, model, billed_cost_micros, created_at)
      VALUES ('usage-budget-2', ${USER}, 'same-run', 'infomaniak', 'qwen', 1000000, ${now.toISOString()}::timestamp)
    `

    await expect(store.reserve({ userId: USER, runId: 'new-run', provider: 'infomaniak', model: 'qwen', budgetMicros: 1_500_000, holdMicros: 500_000, ttlSeconds: 60, now })).resolves.toMatchObject({ created: true })
  })
})

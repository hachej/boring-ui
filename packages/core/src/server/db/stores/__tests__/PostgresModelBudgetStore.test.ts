import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { runMigrations } from '../../migrate'
import { ModelBudgetExceededError, PostgresModelBudgetStore } from '../PostgresModelBudgetStore'
import { PostgresBudgetReservationStore, UserBudgetExceededError } from '../PostgresBudgetReservationStore'
import type { CoreConfig } from '../../../../shared/types'

const TEST_DB_URL_CANDIDATES = [
  process.env.DATABASE_URL,
  'postgresql://ubuntu:test@127.0.0.1:5432/boring_ui_v2_local',
].filter((url): url is string => Boolean(url))
const POSTGRES_ADMIN_DB_URL = 'postgres://postgres:postgres@127.0.0.1:5432/postgres'
const USER = 'budget-user-1'
const OTHER_USER = 'budget-user-2'

function baseConfig(databaseUrl: string): CoreConfig {
  return {
    appId: 'test-app', appName: 'Test App', appLogo: null, port: 0, host: '127.0.0.1', staticDir: null,
    databaseUrl, stores: 'postgres', cors: { origins: ['http://localhost:3000'], credentials: true },
    bodyLimit: 16 * 1024 * 1024, logLevel: 'silent' as CoreConfig['logLevel'], encryption: { workspaceSettingsKey: 'a'.repeat(64) },
    auth: { secret: 's'.repeat(64), url: 'http://localhost:3000', sessionTtlSeconds: 3600, sessionCookieSecure: false },
    features: { githubOauth: false, googleOauth: false, invitesEnabled: true, sendWelcomeEmail: true, inviteTtlDays: 7 },
  }
}

async function canConnect(databaseUrl: string): Promise<boolean> {
  const client = postgres(databaseUrl, { max: 1, connect_timeout: 2 })
  try {
    await client`SELECT 1`
    return true
  } catch {
    return false
  } finally {
    await client.end({ timeout: 1 }).catch(() => {})
  }
}

type TestDbTarget = {
  databaseUrl: string
  cleanup?: () => Promise<void>
}

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function databaseUrlWithName(databaseUrl: string, databaseName: string): string {
  const parsed = new URL(databaseUrl)
  parsed.pathname = `/${databaseName}`
  return parsed.toString()
}

async function createTemporaryDatabase(adminUrl: string): Promise<TestDbTarget | undefined> {
  if (!(await canConnect(adminUrl))) return undefined
  const databaseName = `boring_model_budget_${process.pid}_${Date.now()}`
  const admin = postgres(adminUrl, { max: 1, connect_timeout: 2 })
  try {
    await admin.unsafe(`CREATE DATABASE ${quoteIdent(databaseName)}`)
    return {
      databaseUrl: databaseUrlWithName(adminUrl, databaseName),
      cleanup: async () => {
        const cleanupClient = postgres(adminUrl, { max: 1, connect_timeout: 2 })
        try {
          await cleanupClient`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${databaseName}`
          await cleanupClient.unsafe(`DROP DATABASE IF EXISTS ${quoteIdent(databaseName)}`)
        } finally {
          await cleanupClient.end({ timeout: 1 }).catch(() => {})
        }
      },
    }
  } catch {
    return undefined
  } finally {
    await admin.end({ timeout: 1 }).catch(() => {})
  }
}

async function resolveTestDb(): Promise<TestDbTarget | undefined> {
  for (const databaseUrl of TEST_DB_URL_CANDIDATES) {
    if (await canConnect(databaseUrl)) return { databaseUrl }
  }
  return createTemporaryDatabase(POSTGRES_ADMIN_DB_URL)
}

function modelBudgetLockKey(input: { userId: string; provider: string; model: string; period: string }): string {
  return `model-budget:${input.userId}:${input.provider}:${input.model}:${input.period}`
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function expectStillPending(promise: Promise<unknown>): Promise<void> {
  await expect(Promise.race([
    promise.then(() => 'resolved', () => 'rejected'),
    delay(75).then(() => 'pending'),
  ])).resolves.toBe('pending')
}

const TEST_DB = await resolveTestDb()

let sqlClient: postgres.Sql
let store: PostgresModelBudgetStore
let budgetStore: PostgresBudgetReservationStore

beforeAll(async () => {
  if (!TEST_DB) return
  await runMigrations(baseConfig(TEST_DB.databaseUrl))
  sqlClient = postgres(TEST_DB.databaseUrl, { max: 5 })
  store = new PostgresModelBudgetStore(drizzle(sqlClient))
  budgetStore = new PostgresBudgetReservationStore(drizzle(sqlClient))
})

afterAll(async () => {
  await sqlClient?.end()
  await TEST_DB?.cleanup?.()
})

beforeEach(async () => {
  await sqlClient`DELETE FROM boring_budget_reservations WHERE user_id IN (${USER}, ${OTHER_USER})`
  await sqlClient`DELETE FROM boring_usage_ledger WHERE user_id IN (${USER}, ${OTHER_USER})`
})

describe.runIf(TEST_DB)('PostgresModelBudgetStore', () => {
  it('idempotently reserves and settles/releases active holds', async () => {
    const now = new Date('2026-07-15T12:00:00Z')
    const first = await store.reserve({ userId: USER, runId: 'run-1', provider: 'infomaniak', model: 'qwen', budgetMicros: 2_000_000, holdMicros: 1_000_000, ttlSeconds: 60, now })
    const second = await store.reserve({ userId: USER, runId: 'run-1', provider: 'infomaniak', model: 'qwen', budgetMicros: 2_000_000, holdMicros: 1_000_000, ttlSeconds: 60, now })

    expect(second).toEqual({ ...first, created: false })
    await store.settle({ reservationId: first.reservationId })
    const settled = await sqlClient`SELECT status FROM boring_budget_reservations WHERE id = ${first.reservationId}`
    expect(settled[0]?.status).toBe('settled')

    const released = await store.reserve({ userId: USER, runId: 'run-2', provider: 'infomaniak', model: 'qwen', budgetMicros: 2_000_000, holdMicros: 1_000_000, ttlSeconds: 60, now })
    await store.release({ reservationId: released.reservationId })
    const rows = await sqlClient`SELECT status FROM boring_budget_reservations WHERE id = ${released.reservationId}`
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

  it('serializes release and reserve on the budget advisory lock', async () => {
    const now = new Date('2026-07-15T12:00:00Z')
    const period = PostgresModelBudgetStore.monthPeriodUtc(now)
    const first = await store.reserve({ userId: USER, runId: 'locked-active', provider: 'infomaniak', model: 'qwen', budgetMicros: 1_000_000, holdMicros: 1_000_000, ttlSeconds: 60, now })

    let overReserve!: Promise<unknown>
    let release!: Promise<void>
    await sqlClient.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${modelBudgetLockKey({ userId: USER, provider: 'infomaniak', model: 'qwen', period })}))`
      overReserve = store.reserve({ userId: USER, runId: 'locked-over', provider: 'infomaniak', model: 'qwen', budgetMicros: 1_000_000, holdMicros: 1_000_000, ttlSeconds: 60, now })
      await expectStillPending(overReserve)

      release = store.release({ reservationId: first.reservationId })
      await expectStillPending(release)
      const rows = await sqlClient`SELECT status FROM boring_budget_reservations WHERE id = ${first.reservationId}`
      expect(rows[0]?.status).toBe('active')
    })

    await expect(overReserve).rejects.toBeInstanceOf(ModelBudgetExceededError)
    await expect(release).resolves.toBeUndefined()
    const rows = await sqlClient`SELECT status FROM boring_budget_reservations WHERE id = ${first.reservationId}`
    expect(rows[0]?.status).toBe('released')
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

  it('counts reserved-run charges in the reserved UTC month exactly once across month boundaries', async () => {
    const beforeBoundary = new Date('2026-07-31T23:59:30Z')
    const afterBoundary = new Date('2026-08-01T00:00:30Z')
    const afterReuse = new Date('2026-08-01T00:05:00Z')
    const afterDelayedUsage = new Date('2026-08-01T00:06:00Z')

    const exact = await store.reserve({ userId: USER, runId: 'boundary-ledger', provider: 'infomaniak', model: 'qwen', budgetMicros: 1_500_000, holdMicros: 1_000_000, ttlSeconds: 60, now: beforeBoundary })
    await sqlClient`UPDATE boring_budget_reservations SET created_at = ${beforeBoundary.toISOString()}::timestamp WHERE id = ${exact.reservationId}`
    await store.release({ reservationId: exact.reservationId })

    const reused = await store.reserve({ userId: USER, runId: 'boundary-ledger', provider: 'infomaniak', model: 'qwen', budgetMicros: 1_000_000, holdMicros: 1_000_000, ttlSeconds: 60, now: afterReuse })
    await sqlClient`UPDATE boring_budget_reservations SET created_at = ${afterReuse.toISOString()}::timestamp WHERE id = ${reused.reservationId}`
    await store.release({ reservationId: reused.reservationId })
    await sqlClient`
      INSERT INTO boring_usage_ledger (id, user_id, run_id, provider, model, billed_cost_micros, created_at, metadata)
      VALUES ('usage-budget-boundary-ledger', ${USER}, 'boundary-ledger', 'infomaniak', 'qwen', 1000000, ${afterDelayedUsage.toISOString()}::timestamp, ${JSON.stringify({ modelBudgetReservationId: exact.reservationId })}::jsonb)
    `

    await expect(store.reserve({ userId: USER, runId: 'boundary-aug-not-charged', provider: 'infomaniak', model: 'qwen', budgetMicros: 1_000_000, holdMicros: 1_000_000, ttlSeconds: 60, now: afterDelayedUsage })).resolves.toMatchObject({ created: true })
    await store.release({ runId: 'boundary-aug-not-charged', userId: USER })
    await expect(store.reserve({ userId: USER, runId: 'boundary-aug-after-reuse', provider: 'infomaniak', model: 'qwen', budgetMicros: 1_000_000, holdMicros: 1_000_000, ttlSeconds: 60, now: afterDelayedUsage })).resolves.toMatchObject({ created: true })
    await store.release({ runId: 'boundary-aug-after-reuse', userId: USER })
    await expect(store.reserve({ userId: USER, runId: 'boundary-jul-exact-ok', provider: 'infomaniak', model: 'qwen', budgetMicros: 1_500_000, holdMicros: 500_000, ttlSeconds: 60, now: beforeBoundary })).resolves.toMatchObject({ created: true })
    await store.release({ runId: 'boundary-jul-exact-ok', userId: USER })
    await expect(store.reserve({ userId: USER, runId: 'boundary-jul-over', provider: 'infomaniak', model: 'qwen', budgetMicros: 1_500_000, holdMicros: 500_001, ttlSeconds: 60, now: beforeBoundary })).rejects.toBeInstanceOf(ModelBudgetExceededError)

    const fallback = await store.reserve({ userId: OTHER_USER, runId: 'boundary-fallback', provider: 'infomaniak', model: 'qwen', budgetMicros: 1_500_000, holdMicros: 1_000_000, ttlSeconds: 60, now: beforeBoundary })
    await sqlClient`UPDATE boring_budget_reservations SET created_at = ${beforeBoundary.toISOString()}::timestamp WHERE id = ${fallback.reservationId}`
    await sqlClient`
      INSERT INTO boring_usage_ledger (id, user_id, run_id, provider, model, billed_cost_micros, created_at)
      VALUES ('usage-budget-boundary-fallback', ${OTHER_USER}, 'boundary-fallback', 'infomaniak', 'qwen', 200000, ${afterBoundary.toISOString()}::timestamp)
    `
    await store.settle({ reservationId: fallback.reservationId })

    await expect(store.reserve({ userId: OTHER_USER, runId: 'boundary-fallback-aug-not-charged', provider: 'infomaniak', model: 'qwen', budgetMicros: 1_000_000, holdMicros: 1_000_000, ttlSeconds: 60, now: afterBoundary })).resolves.toMatchObject({ created: true })
    await store.release({ runId: 'boundary-fallback-aug-not-charged', userId: OTHER_USER })
    await expect(store.reserve({ userId: OTHER_USER, runId: 'boundary-fallback-jul-ok', provider: 'infomaniak', model: 'qwen', budgetMicros: 1_500_000, holdMicros: 500_000, ttlSeconds: 60, now: beforeBoundary })).resolves.toMatchObject({ created: true })
    await store.release({ runId: 'boundary-fallback-jul-ok', userId: OTHER_USER })
    await expect(store.reserve({ userId: OTHER_USER, runId: 'boundary-fallback-jul-over', provider: 'infomaniak', model: 'qwen', budgetMicros: 1_500_000, holdMicros: 500_001, ttlSeconds: 60, now: beforeBoundary })).rejects.toBeInstanceOf(ModelBudgetExceededError)
  })

  it('enforces user-scope aggregate budgets with active holds and fallback rows', async () => {
    const now = new Date('2026-07-15T12:00:00Z')
    const userHold = await budgetStore.reserve({ scope: 'user', userId: USER, runId: 'user-active', budgetMicros: 2_000_000, holdMicros: 1_000_000, ttlSeconds: 60, now })
    await sqlClient`
      INSERT INTO boring_usage_ledger (id, user_id, run_id, source, provider, model, billed_cost_micros, created_at, metadata)
      VALUES ('usage-user-active', ${USER}, 'user-active', 'pi-chat', 'infomaniak', 'qwen', 900000, ${now.toISOString()}::timestamp, ${JSON.stringify({ userBudgetReservationId: userHold.reservationId })}::jsonb)
    `

    await expect(budgetStore.reserve({ scope: 'user', userId: USER, runId: 'user-next-ok', budgetMicros: 2_000_000, holdMicros: 1_000_000, ttlSeconds: 60, now })).resolves.toMatchObject({ created: true })
    await budgetStore.release({ scope: 'user', runId: 'user-next-ok', userId: USER })

    const fallback = await budgetStore.reserve({ scope: 'user', userId: OTHER_USER, runId: 'user-fallback', budgetMicros: 1_500_000, holdMicros: 1_000_000, ttlSeconds: 60, now })
    await sqlClient`
      INSERT INTO boring_usage_ledger (id, user_id, run_id, source, billed_cost_micros, created_at, metadata)
      VALUES ('usage-user-fallback', ${OTHER_USER}, 'user-fallback', 'pi-chat-fallback', 1000000, ${now.toISOString()}::timestamp, ${JSON.stringify({ userBudgetReservationId: fallback.reservationId })}::jsonb)
    `
    await budgetStore.release({ scope: 'user', reservationId: fallback.reservationId })
    await expect(budgetStore.reserve({ scope: 'user', userId: OTHER_USER, runId: 'user-over', budgetMicros: 1_500_000, holdMicros: 600_000, ttlSeconds: 60, now })).rejects.toBeInstanceOf(UserBudgetExceededError)
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

  it('getSpendSnapshot reports active holds, settled-as-used, and the period reset boundary without writing rows', async () => {
    const now = new Date('2026-07-15T12:00:00Z')
    const hold = await budgetStore.reserve({ scope: 'model', userId: USER, runId: 'snap-run', provider: 'infomaniak', model: 'qwen', budgetMicros: 5_000_000, holdMicros: 1_000_000, ttlSeconds: 60, now })

    const held = await budgetStore.getSpendSnapshot({ scope: 'model', userId: USER, provider: 'infomaniak', model: 'qwen', now })
    expect(held).toMatchObject({ scope: 'model', usedMicros: 0, heldMicros: 1_000_000, period: '2026-07' })
    expect(held.periodStart.toISOString()).toBe('2026-07-01T00:00:00.000Z')
    expect(held.periodEnd.toISOString()).toBe('2026-08-01T00:00:00.000Z')

    // Read-only: the snapshot must not create/settle any reservation.
    const rows = await sqlClient`SELECT count(*)::int AS n FROM boring_budget_reservations WHERE user_id = ${USER} AND status = 'active'`
    expect(rows[0]?.n).toBe(1)

    await budgetStore.settle({ scope: 'model', reservationId: hold.reservationId })
    const settled = await budgetStore.getSpendSnapshot({ scope: 'model', userId: USER, provider: 'infomaniak', model: 'qwen', now })
    expect(settled).toMatchObject({ usedMicros: 1_000_000, heldMicros: 0 })
  })
})

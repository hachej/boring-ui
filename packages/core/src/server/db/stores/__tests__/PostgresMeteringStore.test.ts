import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { runMigrations } from '../../migrate'
import { InsufficientCreditError, PostgresMeteringStore } from '../PostgresMeteringStore'
import type { CoreConfig } from '../../../../shared/types'

const TEST_DB_URL = process.env.DATABASE_URL ?? 'postgres://ubuntu:test@localhost/boring_ui_test'

const BASE_CONFIG: CoreConfig = {
  appId: 'test-app',
  appName: 'Test App',
  appLogo: null,
  port: 0,
  host: '127.0.0.1',
  staticDir: null,
  databaseUrl: TEST_DB_URL,
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

const USER = 'metering-user-1'
const OTHER_USER = 'metering-user-2'

let sqlClient: postgres.Sql
let store: PostgresMeteringStore

beforeAll(async () => {
  await runMigrations(BASE_CONFIG)
  sqlClient = postgres(TEST_DB_URL, { max: 5 })
  store = new PostgresMeteringStore(drizzle(sqlClient))
})

afterAll(async () => {
  await sqlClient?.end()
})

beforeEach(async () => {
  await sqlClient`DELETE FROM boring_usage_ledger WHERE user_id IN (${USER}, ${OTHER_USER})`
  await sqlClient`DELETE FROM boring_usage_reservations WHERE user_id IN (${USER}, ${OTHER_USER})`
  await sqlClient`DELETE FROM boring_credit_grants WHERE user_id IN (${USER}, ${OTHER_USER})`
})

describe('PostgresMeteringStore', () => {
  it('creates grants idempotently per (user, reason)', async () => {
    expect(await store.grantOnce({ userId: USER, reason: 'initial', amountMicros: 15_000_000 })).toEqual({ created: true })
    expect(await store.grantOnce({ userId: USER, reason: 'initial', amountMicros: 15_000_000 })).toEqual({ created: false })
    expect(await store.grantOnce({ userId: USER, reason: 'topup:1', amountMicros: 5_000_000 })).toEqual({ created: true })

    const balance = await store.getBalance(USER)
    expect(balance.grantedMicros).toBe(20_000_000)
    expect(balance.remainingMicros).toBe(20_000_000)
  })

  it('excludes expired grants from the balance', async () => {
    await store.grantOnce({ userId: USER, reason: 'expired', amountMicros: 9_000_000, expiresAt: new Date(Date.now() - 1000) })
    await store.grantOnce({ userId: USER, reason: 'live', amountMicros: 1_000_000 })
    const balance = await store.getBalance(USER)
    expect(balance.grantedMicros).toBe(1_000_000)
  })

  it('includes active reservations in the balance and enforces the hard stop', async () => {
    await store.grantOnce({ userId: USER, reason: 'initial', amountMicros: 1_000_000 })
    await store.reserve({ userId: USER, runId: 'turn-1', amountMicros: 750_000, ttlSeconds: 600 })

    const balance = await store.getBalance(USER)
    expect(balance).toMatchObject({
      grantedMicros: 1_000_000,
      usedMicros: 0,
      remainingMicros: 1_000_000,
      activeReservedMicros: 750_000,
      availableMicros: 250_000,
    })

    await expect(
      store.reserve({ userId: USER, runId: 'turn-2', amountMicros: 750_000, ttlSeconds: 600 }),
    ).rejects.toBeInstanceOf(InsufficientCreditError)

    // A softer floor lets the second reservation through.
    await expect(
      store.reserve({ userId: USER, runId: 'turn-2', amountMicros: 750_000, ttlSeconds: 600, minAvailableMicros: 100_000 }),
    ).resolves.toMatchObject({ reservationId: expect.any(String) })
  })

  it('carries 402 metadata on the hard-stop error', async () => {
    await store.grantOnce({ userId: USER, reason: 'initial', amountMicros: 100 })
    const error = await store
      .reserve({ userId: USER, runId: 'turn-1', amountMicros: 1_000, ttlSeconds: 60 })
      .then(() => null, (err: unknown) => err)
    expect(error).toBeInstanceOf(InsufficientCreditError)
    expect(error).toMatchObject({ statusCode: 402, code: 'INSUFFICIENT_CREDIT', availableMicros: 100, requiredMicros: 1_000 })
  })

  it('inserts usage idempotently by usage id', async () => {
    await store.grantOnce({ userId: USER, reason: 'initial', amountMicros: 10_000_000 })
    const input = {
      usageId: 'pi-usage:s1:message:a1',
      userId: USER,
      sessionId: 's1',
      runId: 'turn-1',
      messageId: 'a1',
      source: 'pi-chat',
      provider: 'ollama',
      model: 'kimi-k2:1t',
      inputTokens: 1000,
      outputTokens: 200,
      providerCostMicros: 0,
      billedCostMicros: 870_000,
    }
    expect(await store.recordUsage(input)).toEqual({ inserted: true })
    expect(await store.recordUsage(input)).toEqual({ inserted: false })

    const balance = await store.getBalance(USER)
    expect(balance.usedMicros).toBe(870_000)
    expect(balance.remainingMicros).toBe(10_000_000 - 870_000)
  })

  it('settles a reservation after usage, and recovers an expired reservation on settlement retry', async () => {
    await store.grantOnce({ userId: USER, reason: 'initial', amountMicros: 10_000_000 })
    await store.reserve({ userId: USER, runId: 'turn-1', amountMicros: 750_000, ttlSeconds: 600 })
    await store.recordUsage({ usageId: 'u1', userId: USER, runId: 'turn-1', billedCostMicros: 100_000 })

    expect(await store.finishReservation({ runId: 'turn-1', userId: USER }, 'settled')).toEqual({ updated: true })
    expect(await store.finishReservation({ runId: 'turn-1', userId: USER }, 'settled')).toEqual({ updated: false })
    expect((await store.getBalance(USER)).activeReservedMicros).toBe(0)

    // Settlement retry after the reservation already expired still closes it.
    await store.reserve({ userId: USER, runId: 'turn-2', amountMicros: 750_000, ttlSeconds: 600 })
    await sqlClient`UPDATE boring_usage_reservations SET status = 'expired' WHERE run_id = 'turn-2'`
    expect(await store.finishReservation({ runId: 'turn-2', userId: USER }, 'settled')).toEqual({ updated: true })
    const statuses = await sqlClient`SELECT status FROM boring_usage_reservations WHERE run_id = 'turn-2'`
    expect(statuses[0]?.status).toBe('settled')
  })

  it('releases reservations without charging', async () => {
    await store.grantOnce({ userId: USER, reason: 'initial', amountMicros: 1_000_000 })
    await store.reserve({ userId: USER, runId: 'turn-1', amountMicros: 500_000, ttlSeconds: 600 })
    expect(await store.finishReservation({ runId: 'turn-1', userId: USER }, 'released')).toEqual({ updated: true })
    const balance = await store.getBalance(USER)
    expect(balance.usedMicros).toBe(0)
    expect(balance.activeReservedMicros).toBe(0)
  })

  it('expires stale reservations without charging', async () => {
    await store.grantOnce({ userId: USER, reason: 'initial', amountMicros: 1_000_000 })
    await store.reserve({ userId: USER, runId: 'turn-stale', amountMicros: 500_000, ttlSeconds: 600 })
    await store.reserve({ userId: USER, runId: 'turn-fresh', amountMicros: 100_000, ttlSeconds: 600 })
    await sqlClient`UPDATE boring_usage_reservations SET expires_at = now() - interval '1 minute' WHERE run_id = 'turn-stale'`

    const expired = await store.expireStaleReservations()
    expect(expired).toBe(1)

    const balance = await store.getBalance(USER)
    expect(balance.usedMicros).toBe(0)
    expect(balance.activeReservedMicros).toBe(100_000)
  })

  it('reserves idempotently per run id while the reservation is active', async () => {
    await store.grantOnce({ userId: USER, reason: 'initial', amountMicros: 1_000_000 })
    const first = await store.reserve({ userId: USER, runId: 'turn-retry', amountMicros: 750_000, ttlSeconds: 600 })
    const second = await store.reserve({ userId: USER, runId: 'turn-retry', amountMicros: 750_000, ttlSeconds: 600 })

    expect(second.reservationId).toBe(first.reservationId)
    expect((await store.getBalance(USER)).activeReservedMicros).toBe(750_000)
  })

  it('finishes reservations by reservation id and scopes run-id finishes by user', async () => {
    await store.grantOnce({ userId: USER, reason: 'initial', amountMicros: 1_000_000 })
    await store.grantOnce({ userId: OTHER_USER, reason: 'initial', amountMicros: 1_000_000 })
    const mine = await store.reserve({ userId: USER, runId: 'turn-shared', amountMicros: 100_000, ttlSeconds: 600 })

    // Wrong-user scope is a no-op; right scope settles; id-keyed finish works.
    expect(await store.finishReservation({ runId: 'turn-shared', userId: OTHER_USER }, 'released')).toEqual({ updated: false })
    expect(await store.finishReservation({ reservationId: mine.reservationId }, 'settled')).toEqual({ updated: true })
    await expect(store.finishReservation({}, 'settled')).rejects.toThrow('requires reservationId or runId')
    // A runId-keyed finish must carry the tenant scope.
    await expect(store.finishReservation({ runId: 'turn-shared' }, 'settled')).rejects.toThrow('requires userId')
  })

  it('allows a new active reservation for a turn after the previous one finished', async () => {
    await store.grantOnce({ userId: USER, reason: 'initial', amountMicros: 5_000_000 })
    await store.reserve({ userId: USER, runId: 'turn-1', amountMicros: 500_000, ttlSeconds: 600 })
    await store.finishReservation({ runId: 'turn-1', userId: USER }, 'released')
    await expect(
      store.reserve({ userId: USER, runId: 'turn-1', amountMicros: 500_000, ttlSeconds: 600 }),
    ).resolves.toMatchObject({ reservationId: expect.any(String) })
  })

  it('settles only the newest row when a run id has an expired row plus a live retry', async () => {
    await store.grantOnce({ userId: USER, reason: 'initial', amountMicros: 5_000_000 })
    // Old reservation for the run expired before settlement; client retried
    // and a fresh active reservation now exists for the same run id.
    const stale = await store.reserve({ userId: USER, runId: 'turn-r', amountMicros: 500_000, ttlSeconds: 600 })
    await sqlClient`UPDATE boring_usage_reservations SET status = 'expired' WHERE id = ${stale.reservationId}`
    const live = await store.reserve({ userId: USER, runId: 'turn-r', amountMicros: 500_000, ttlSeconds: 600 })

    expect(await store.finishReservation({ runId: 'turn-r', userId: USER }, 'settled')).toEqual({ updated: true })

    const rows = await sqlClient`SELECT id, status FROM boring_usage_reservations WHERE run_id = 'turn-r' ORDER BY created_at`
    const staleRow = rows.find((row) => row.id === stale.reservationId)
    const liveRow = rows.find((row) => row.id === live.reservationId)
    // The dead row stays expired; only the live reservation is settled.
    expect(staleRow?.status).toBe('expired')
    expect(liveRow?.status).toBe('settled')
  })

  it('does not reuse an expired-but-active reservation to bypass the hard stop', async () => {
    await store.grantOnce({ userId: USER, reason: 'initial', amountMicros: 1_000_000 })
    const stale = await store.reserve({ userId: USER, runId: 'turn-x', amountMicros: 750_000, ttlSeconds: 600 })
    // The row is still status='active' but past its TTL (sweep hasn't run);
    // computeBalance already excludes it, so available looks like the full grant.
    await sqlClient`UPDATE boring_usage_reservations SET expires_at = now() - interval '1 minute' WHERE id = ${stale.reservationId}`
    // Spend most of the grant so a fresh hold can no longer fit.
    await store.recordUsage({ usageId: 'u1', userId: USER, runId: 'turn-x', billedCostMicros: 900_000 })

    // Re-reserving the same run id must hit the hard stop, not silently return
    // the stale (uncounted) reservation. (The failed reserve rolls back, so the
    // stale row stays active until the next sweep/successful reserve.)
    await expect(
      store.reserve({ userId: USER, runId: 'turn-x', amountMicros: 750_000, ttlSeconds: 600 }),
    ).rejects.toBeInstanceOf(InsufficientCreditError)
  })

  it('expires the stale row and mints a fresh hold when a same-run reserve succeeds after TTL', async () => {
    await store.grantOnce({ userId: USER, reason: 'initial', amountMicros: 5_000_000 })
    const stale = await store.reserve({ userId: USER, runId: 'turn-y', amountMicros: 750_000, ttlSeconds: 600 })
    await sqlClient`UPDATE boring_usage_reservations SET expires_at = now() - interval '1 minute' WHERE id = ${stale.reservationId}`

    const fresh = await store.reserve({ userId: USER, runId: 'turn-y', amountMicros: 750_000, ttlSeconds: 600 })
    expect(fresh.reservationId).not.toBe(stale.reservationId)

    const rows = await sqlClient`SELECT id, status FROM boring_usage_reservations WHERE run_id = 'turn-y'`
    expect(rows.find((row) => row.id === stale.reservationId)?.status).toBe('expired')
    expect(rows.find((row) => row.id === fresh.reservationId)?.status).toBe('active')
    expect((await store.getBalance(USER)).activeReservedMicros).toBe(750_000)
  })

  it('does not return another user\'s active reservation from the idempotent reserve path', async () => {
    await store.grantOnce({ userId: USER, reason: 'initial', amountMicros: 5_000_000 })
    await store.grantOnce({ userId: OTHER_USER, reason: 'initial', amountMicros: 5_000_000 })
    await store.reserve({ userId: USER, runId: 'turn-collide', amountMicros: 100_000, ttlSeconds: 600 })

    // The global partial unique index rejects a second active row for the same
    // run id rather than letting the other user free-ride on USER's hold.
    await expect(
      store.reserve({ userId: OTHER_USER, runId: 'turn-collide', amountMicros: 100_000, ttlSeconds: 600 }),
    ).rejects.toThrow()
    expect((await store.getBalance(OTHER_USER)).activeReservedMicros).toBe(0)
  })

  it('keeps balances isolated per user', async () => {
    await store.grantOnce({ userId: USER, reason: 'initial', amountMicros: 1_000_000 })
    await store.grantOnce({ userId: OTHER_USER, reason: 'initial', amountMicros: 2_000_000 })
    await store.recordUsage({ usageId: 'iso-1', userId: USER, billedCostMicros: 300_000 })

    expect((await store.getBalance(USER)).remainingMicros).toBe(700_000)
    expect((await store.getBalance(OTHER_USER)).remainingMicros).toBe(2_000_000)
  })

  it('serializes concurrent reservations so users cannot overdraw', async () => {
    await store.grantOnce({ userId: USER, reason: 'initial', amountMicros: 1_000_000 })
    const attempts = await Promise.allSettled(
      Array.from({ length: 4 }, (_value, index) =>
        store.reserve({ userId: USER, runId: `turn-c${index}`, amountMicros: 400_000, ttlSeconds: 600 }),
      ),
    )
    const granted = attempts.filter((attempt) => attempt.status === 'fulfilled')
    expect(granted).toHaveLength(2)
    expect((await store.getBalance(USER)).activeReservedMicros).toBe(800_000)
  })

  it('rejects invalid amounts', async () => {
    await expect(store.grantOnce({ userId: USER, reason: 'bad', amountMicros: 0 })).rejects.toThrow('positive integer')
    await expect(store.reserve({ userId: USER, runId: 't', amountMicros: 1.5, ttlSeconds: 60 })).rejects.toThrow('positive integer')
    await expect(store.recordUsage({ usageId: 'x', userId: USER, billedCostMicros: -1 })).rejects.toThrow('non-negative')
  })
})

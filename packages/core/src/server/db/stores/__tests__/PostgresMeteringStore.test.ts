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
  // Includes refund-before-grant tombstones, which carry a NULL user_id.
  await sqlClient`DELETE FROM boring_credit_purchases WHERE user_id IN (${USER}, ${OTHER_USER}) OR user_id IS NULL`
})

describe('grantPurchaseOnce (global per-order idempotency)', () => {
  it('credits a paid order exactly once; an identical retry no-ops, a conflicting one throws', async () => {
    expect(await store.grantPurchaseOnce({ orderId: 'ord-1', userId: USER, amountMicros: 10_000_000 })).toEqual({ granted: true })
    // Identical retry of the same order → no second grant (idempotent).
    expect(await store.grantPurchaseOnce({ orderId: 'ord-1', userId: USER, amountMicros: 10_000_000 })).toEqual({ granted: false })
    // Same order id misrouted to a DIFFERENT user → conflict, surfaced loudly
    // (never silently 200-acked as idempotent — it's accounting corruption).
    await expect(store.grantPurchaseOnce({ orderId: 'ord-1', userId: OTHER_USER, amountMicros: 10_000_000 })).rejects.toThrow(/refusing conflicting re-grant/)
    // A conflicting amount for the same user also throws.
    await expect(store.grantPurchaseOnce({ orderId: 'ord-1', userId: USER, amountMicros: 25_000_000 })).rejects.toThrow(/refusing conflicting re-grant/)

    expect((await store.getBalance(USER)).grantedMicros).toBe(10_000_000)
    expect((await store.getBalance(OTHER_USER)).grantedMicros).toBe(0)
    const purchases = await sqlClient`SELECT count(*)::int AS n FROM boring_credit_purchases WHERE order_id = 'ord-1'`
    expect(purchases[0]?.n).toBe(1)
  })

  it('rejects invalid purchase input', async () => {
    await expect(store.grantPurchaseOnce({ orderId: '', userId: USER, amountMicros: 1 })).rejects.toThrow('orderId')
    await expect(store.grantPurchaseOnce({ orderId: 'o', userId: USER, amountMicros: 0 })).rejects.toThrow('positive integer')
  })

  it('revokes a refunded purchase once, deducting the credited amount', async () => {
    await store.grantPurchaseOnce({ orderId: 'ord-r', userId: USER, amountMicros: 10_000_000 })
    expect((await store.getBalance(USER)).remainingMicros).toBe(10_000_000)

    // Refund deducts the original credit via a usage-ledger debit.
    expect(await store.revokePurchase('ord-r')).toEqual({ revoked: true })
    expect((await store.getBalance(USER)).remainingMicros).toBe(0)

    // Idempotent: a webhook retry of the same refund does not double-deduct.
    expect(await store.revokePurchase('ord-r')).toEqual({ revoked: false })
    expect((await store.getBalance(USER)).remainingMicros).toBe(0)
  })

  it('no-ops revoking an unknown order', async () => {
    expect(await store.revokePurchase('never-credited')).toEqual({ revoked: false })
  })

  it('revokes an already-credited order even when tombstoning is disallowed (retired variant)', async () => {
    // The order was credited; a later refund whose variant was retired from the
    // allow-list (allowTombstone=false) must still revoke by order id.
    await store.grantPurchaseOnce({ orderId: 'ord-retired', userId: USER, amountMicros: 10_000_000 })
    expect(await store.revokePurchase('ord-retired', { allowTombstone: false })).toEqual({ revoked: true })
    expect((await store.getBalance(USER)).remainingMicros).toBe(0)
  })

  it('does not tombstone an unknown order when tombstoning is disallowed (cross-store refund)', async () => {
    // A refund for an order we never credited, that doesn't validate as a credit
    // order, must NOT write a blocking tombstone — a legit later order can grant.
    expect(await store.revokePurchase('ord-foreign', { allowTombstone: false })).toEqual({ revoked: false })
    const rows = await sqlClient`SELECT count(*)::int AS n FROM boring_credit_purchases WHERE order_id = 'ord-foreign'`
    expect(rows[0]?.n).toBe(0)
    expect(await store.grantPurchaseOnce({ orderId: 'ord-foreign', userId: USER, amountMicros: 5_000_000 })).toEqual({ granted: true })
  })

  it('refund-before-grant tombstones the order so a later order_created never credits', async () => {
    // order_refunded arrives before order_created (out-of-order webhook delivery).
    expect(await store.revokePurchase('ord-race')).toEqual({ revoked: false })
    // The matching grant must now be refused — the user must not keep credits.
    expect(await store.grantPurchaseOnce({ orderId: 'ord-race', userId: USER, amountMicros: 10_000_000 })).toEqual({ granted: false })
    expect((await store.getBalance(USER)).grantedMicros).toBe(0)

    const rows = await sqlClient`SELECT status FROM boring_credit_purchases WHERE order_id = 'ord-race'`
    expect(rows[0]?.status).toBe('refunded')
  })

  it('marks a granted order refunded exactly once on revoke', async () => {
    await store.grantPurchaseOnce({ orderId: 'ord-g', userId: USER, amountMicros: 10_000_000 })
    expect(await store.revokePurchase('ord-g')).toEqual({ revoked: true })
    const rows = await sqlClient`SELECT status FROM boring_credit_purchases WHERE order_id = 'ord-g'`
    expect(rows[0]?.status).toBe('refunded')
    // A second order_created for the same (now refunded) order does not re-credit.
    expect(await store.grantPurchaseOnce({ orderId: 'ord-g', userId: USER, amountMicros: 10_000_000 })).toEqual({ granted: false })
    expect((await store.getBalance(USER)).remainingMicros).toBe(0)
  })

  it('revokes the proportional delta across repeated partial refunds, then fully', async () => {
    await store.grantPurchaseOnce({ orderId: 'ord-p', userId: USER, amountMicros: 10_000_000 })
    // 30% refunded cumulative → revoke €3.
    expect(await store.revokePurchase('ord-p', { refundFraction: 0.3 })).toEqual({ revoked: true })
    expect((await store.getBalance(USER)).remainingMicros).toBe(7_000_000)
    // Retry of the same cumulative fraction is a no-op (no double-debit).
    expect(await store.revokePurchase('ord-p', { refundFraction: 0.3 })).toEqual({ revoked: false })
    expect((await store.getBalance(USER)).remainingMicros).toBe(7_000_000)
    // 80% cumulative → revoke only the €5 delta.
    expect(await store.revokePurchase('ord-p', { refundFraction: 0.8 })).toEqual({ revoked: true })
    expect((await store.getBalance(USER)).remainingMicros).toBe(2_000_000)
    let rows = await sqlClient`SELECT status FROM boring_credit_purchases WHERE order_id = 'ord-p'`
    expect(rows[0]?.status).toBe('granted') // not fully refunded yet
    // Full refund (fraction ≥ 1, capped) revokes the remaining €2 and marks refunded.
    expect(await store.revokePurchase('ord-p', { refundFraction: 1.2 })).toEqual({ revoked: true })
    expect((await store.getBalance(USER)).remainingMicros).toBe(0)
    rows = await sqlClient`SELECT status FROM boring_credit_purchases WHERE order_id = 'ord-p'`
    expect(rows[0]?.status).toBe('refunded')
  })

  it('full refund-before-grant blocks a later grant; partial grants NET of the pending refund', async () => {
    // Full refund before order_created → terminal tombstone, later grant refused.
    expect(await store.revokePurchase('ord-full', { refundFraction: 1 })).toEqual({ revoked: false })
    expect(await store.grantPurchaseOnce({ orderId: 'ord-full', userId: USER, amountMicros: 10_000_000 })).toEqual({ granted: false })

    // Partial (50%) refund before order_created → recorded as pending; the later
    // grant mints the full €10 then immediately revokes €5 → net €5 balance.
    expect(await store.revokePurchase('ord-part', { refundFraction: 0.5 })).toEqual({ revoked: false })
    let rows = await sqlClient`SELECT status, pending_refund_ppm FROM boring_credit_purchases WHERE order_id = 'ord-part'`
    expect(rows[0]?.status).toBe('refund_pending')
    expect(Number(rows[0]?.pending_refund_ppm)).toBe(500_000)
    expect(await store.grantPurchaseOnce({ orderId: 'ord-part', userId: USER, amountMicros: 10_000_000 })).toEqual({ granted: true })
    expect((await store.getBalance(USER)).remainingMicros).toBe(5_000_000)
    rows = await sqlClient`SELECT status, pending_refund_ppm, refunded_micros FROM boring_credit_purchases WHERE order_id = 'ord-part'`
    expect(rows[0]?.status).toBe('granted')
    expect(rows[0]?.pending_refund_ppm).toBeNull()
    expect(Number(rows[0]?.refunded_micros)).toBe(5_000_000)
    // A retry of the same grant does not re-credit.
    expect(await store.grantPurchaseOnce({ orderId: 'ord-part', userId: USER, amountMicros: 10_000_000 })).toEqual({ granted: false })
    expect((await store.getBalance(USER)).remainingMicros).toBe(5_000_000)
  })

  it('accumulates repeated partial refunds before grant, then grants net', async () => {
    // 30% then 80% (cumulative) refunds both arrive before order_created.
    expect(await store.revokePurchase('ord-multi', { refundFraction: 0.3 })).toEqual({ revoked: false })
    expect(await store.revokePurchase('ord-multi', { refundFraction: 0.8 })).toEqual({ revoked: false })
    let rows = await sqlClient`SELECT status, pending_refund_ppm FROM boring_credit_purchases WHERE order_id = 'ord-multi'`
    expect(rows[0]?.status).toBe('refund_pending') // NOT wrongly tombstoned to refunded
    expect(Number(rows[0]?.pending_refund_ppm)).toBe(800_000)
    // Later grant mints €10 then revokes 80% (€8) → net €2.
    expect(await store.grantPurchaseOnce({ orderId: 'ord-multi', userId: USER, amountMicros: 10_000_000 })).toEqual({ granted: true })
    expect((await store.getBalance(USER)).remainingMicros).toBe(2_000_000)
  })

  it('charges a fallback hold and settles when usage write failed', async () => {
    await store.grantOnce({ userId: USER, reason: 'initial', amountMicros: 10_000_000 })
    const { reservationId } = await store.reserve({
      userId: USER, runId: 'run-fb', source: 'pi-chat', amountMicros: 1_000_000, ttlSeconds: 7200, minAvailableMicros: 1_000_000,
    })
    // Fallback debit equal to the hold + settle (idempotent).
    await store.recordUsage({ usageId: `usage-fallback:${reservationId}`, userId: USER, runId: 'run-fb', source: 'pi-chat-fallback', billedCostMicros: 1_000_000 })
    await store.recordUsage({ usageId: `usage-fallback:${reservationId}`, userId: USER, runId: 'run-fb', source: 'pi-chat-fallback', billedCostMicros: 1_000_000 })
    await store.finishReservation({ reservationId }, 'settled')
    const balance = await store.getBalance(USER)
    expect(balance.usedMicros).toBe(1_000_000) // charged once, not free, not double
    expect(balance.activeReservedMicros).toBe(0)
  })
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
    expect(error).toMatchObject({ statusCode: 402, code: 'PAYMENT_REQUIRED', availableMicros: 100, requiredMicros: 1_000 })
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

  it('settles the exact reservation by id when a run id has an expired row plus a live retry', async () => {
    await store.grantOnce({ userId: USER, reason: 'initial', amountMicros: 5_000_000 })
    // Old reservation for the run expired before settlement; client retried
    // and a fresh active reservation now exists for the same run id.
    const stale = await store.reserve({ userId: USER, runId: 'turn-r', amountMicros: 500_000, ttlSeconds: 600 })
    await sqlClient`UPDATE boring_usage_reservations SET status = 'expired' WHERE id = ${stale.reservationId}`
    const live = await store.reserve({ userId: USER, runId: 'turn-r', amountMicros: 500_000, ttlSeconds: 600 })

    // A runId-only finish is ambiguous now (two finishable rows) and must be
    // rejected rather than settling the wrong hold.
    await expect(store.finishReservation({ runId: 'turn-r', userId: USER }, 'settled')).rejects.toThrow('ambiguous')

    // The unambiguous reservation-id path settles exactly the targeted row.
    expect(await store.finishReservation({ reservationId: stale.reservationId }, 'settled')).toEqual({ updated: true })

    const rows = await sqlClient`SELECT id, status FROM boring_usage_reservations WHERE run_id = 'turn-r'`
    expect(rows.find((row) => row.id === stale.reservationId)?.status).toBe('settled')
    // The live retry's hold is untouched.
    expect(rows.find((row) => row.id === live.reservationId)?.status).toBe('active')
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

  it('fails closed when a balance sum exceeds the safe integer range', async () => {
    // Two individually-safe grants whose sum exceeds Number.MAX_SAFE_INTEGER.
    await store.grantOnce({ userId: USER, reason: 'big-1', amountMicros: 6_000_000_000_000_000 })
    await store.grantOnce({ userId: USER, reason: 'big-2', amountMicros: 6_000_000_000_000_000 })
    await expect(store.getBalance(USER)).rejects.toThrow('safe integer range')
  })

  it('rejects invalid amounts', async () => {
    await expect(store.grantOnce({ userId: USER, reason: 'bad', amountMicros: 0 })).rejects.toThrow('positive integer')
    await expect(store.reserve({ userId: USER, runId: 't', amountMicros: 1.5, ttlSeconds: 60 })).rejects.toThrow('positive integer')
    await expect(store.recordUsage({ usageId: 'x', userId: USER, billedCostMicros: -1 })).rejects.toThrow('non-negative')
  })

  it('rejects an invalid minAvailableMicros instead of weakening the hard stop', async () => {
    await store.grantOnce({ userId: USER, reason: 'initial', amountMicros: 1_000 })
    await expect(
      store.reserve({ userId: USER, runId: 't', amountMicros: 100, ttlSeconds: 60, minAvailableMicros: Number.NaN }),
    ).rejects.toThrow('minAvailableMicros')
    await expect(
      store.reserve({ userId: USER, runId: 't', amountMicros: 100, ttlSeconds: 60, minAvailableMicros: -5 }),
    ).rejects.toThrow('minAvailableMicros')
  })
})

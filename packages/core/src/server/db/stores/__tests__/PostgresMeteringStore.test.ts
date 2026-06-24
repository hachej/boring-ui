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

  it('treats a re-grant with mismatched provider identity as a conflict', async () => {
    await store.grantPurchaseOnce({ orderId: 'ord-id', userId: USER, amountMicros: 10_000_000, storeId: 'A', testMode: false, variantId: '912340' })
    // Identical retry (same identity) → idempotent no-op.
    expect(await store.grantPurchaseOnce({ orderId: 'ord-id', userId: USER, amountMicros: 10_000_000, storeId: 'A', testMode: false, variantId: '912340' })).toEqual({ granted: false })
    // Same user+amount but a DIFFERENT store/mode/variant → conflict, throws.
    await expect(store.grantPurchaseOnce({ orderId: 'ord-id', userId: USER, amountMicros: 10_000_000, storeId: 'B', testMode: false, variantId: '912340' })).rejects.toThrow(/conflicting re-grant/)
    await expect(store.grantPurchaseOnce({ orderId: 'ord-id', userId: USER, amountMicros: 10_000_000, storeId: 'A', testMode: true, variantId: '912340' })).rejects.toThrow(/conflicting re-grant/)
    await expect(store.grantPurchaseOnce({ orderId: 'ord-id', userId: USER, amountMicros: 10_000_000, storeId: 'A', testMode: false, variantId: '999' })).rejects.toThrow(/conflicting re-grant/)
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

  it('throws on a conflicting refund debit when applying a pending refund at grant time', async () => {
    // Partial refund before grant → refund_pending at 50%.
    await store.revokePurchase('ord-pc', { refundFraction: 0.5, allowTombstone: true })
    // A corrupted ledger row already occupies the would-be refund debit id (€5 → refund:ord-pc:5000000), wrong amount.
    await store.recordUsage({ usageId: 'refund:ord-pc:5000000', userId: USER, source: 'manual', billedCostMicros: 1, metadata: {} })
    // The grant applying the pending refund must verify, not silently skip the debit.
    await expect(store.grantPurchaseOnce({ orderId: 'ord-pc', userId: USER, amountMicros: 10_000_000 })).rejects.toThrow(/ledger debit conflict/)
    const rows = await sqlClient`SELECT status FROM boring_credit_purchases WHERE order_id = 'ord-pc'`
    expect(rows[0]?.status).toBe('refund_pending') // rolled back, not granted
  })

  it('throws rather than mark refunded when a conflicting refund debit already exists', async () => {
    await store.grantPurchaseOnce({ orderId: 'ord-conf', userId: USER, amountMicros: 10_000_000 })
    // A corrupted/manual ledger row exists at the refund debit id with a WRONG amount.
    await store.recordUsage({ usageId: 'refund:ord-conf:10000000', userId: USER, source: 'manual', billedCostMicros: 1, metadata: {} })
    // The refund must NOT silently mark the purchase refunded without a real debit.
    await expect(store.revokePurchase('ord-conf', { refundFraction: 1 })).rejects.toThrow(/ledger debit conflict/)
    const rows = await sqlClient`SELECT status FROM boring_credit_purchases WHERE order_id = 'ord-conf'`
    expect(rows[0]?.status).toBe('granted') // unchanged — transaction rolled back
  })

  it('revokes only when the configured identity matches the credited row (mismatch throws)', async () => {
    await store.grantPurchaseOnce({ orderId: 'ord-idm', userId: USER, amountMicros: 10_000_000, storeId: 'S1', testMode: false, currency: 'EUR' })
    // An anomalous identity mismatch THROWS (surfaces as retryable 500), rather
    // than silently leaving a credited order un-revoked.
    await expect(store.revokePurchase('ord-idm', { expectedStoreId: 'S2', expectedTestMode: false, expectedCurrency: 'EUR' })).rejects.toThrow(/refund identity mismatch/)
    await expect(store.revokePurchase('ord-idm', { expectedStoreId: 'S1', expectedTestMode: true, expectedCurrency: 'EUR' })).rejects.toThrow(/refund identity mismatch/)
    await expect(store.revokePurchase('ord-idm', { expectedStoreId: 'S1', expectedTestMode: false, expectedCurrency: 'USD' })).rejects.toThrow(/refund identity mismatch/)
    expect((await store.getBalance(USER)).remainingMicros).toBe(10_000_000)
    // Matching configured identity → revoke. (A refund whose payload omits a
    // field still revokes because the caller passes the CONFIGURED identity.)
    expect(await store.revokePurchase('ord-idm', { expectedStoreId: 'S1', expectedTestMode: false, expectedCurrency: 'EUR' })).toEqual({ revoked: true })
    expect((await store.getBalance(USER)).remainingMicros).toBe(0)
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
    expect(await store.revokePurchase('ord-race', { allowTombstone: true })).toEqual({ revoked: false })
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
    expect(await store.revokePurchase('ord-full', { refundFraction: 1, allowTombstone: true })).toEqual({ revoked: false })
    expect(await store.grantPurchaseOnce({ orderId: 'ord-full', userId: USER, amountMicros: 10_000_000 })).toEqual({ granted: false })

    // Partial (50%) refund before order_created → recorded as pending; the later
    // grant mints the full €10 then immediately revokes €5 → net €5 balance.
    expect(await store.revokePurchase('ord-part', { refundFraction: 0.5, allowTombstone: true })).toEqual({ revoked: false })
    let rows = await sqlClient`SELECT status, pending_refund_ppm FROM boring_credit_purchases WHERE order_id = 'ord-part'`
    expect(rows[0]?.status).toBe('refund_pending')
    expect(Number(rows[0]?.pending_refund_ppm)).toBe(500_000)
    expect(await store.grantPurchaseOnce({ orderId: 'ord-part', userId: USER, amountMicros: 10_000_000 })).toEqual({ granted: true, refundAppliedMicros: 5_000_000 })
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
    expect(await store.revokePurchase('ord-multi', { refundFraction: 0.3, allowTombstone: true })).toEqual({ revoked: false })
    expect(await store.revokePurchase('ord-multi', { refundFraction: 0.8, allowTombstone: true })).toEqual({ revoked: false })
    let rows = await sqlClient`SELECT status, pending_refund_ppm FROM boring_credit_purchases WHERE order_id = 'ord-multi'`
    expect(rows[0]?.status).toBe('refund_pending') // NOT wrongly tombstoned to refunded
    expect(Number(rows[0]?.pending_refund_ppm)).toBe(800_000)
    // Later grant mints €10 then revokes 80% (€8) → net €2.
    expect(await store.grantPurchaseOnce({ orderId: 'ord-multi', userId: USER, amountMicros: 10_000_000 })).toEqual({ granted: true, refundAppliedMicros: 8_000_000 })
    expect((await store.getBalance(USER)).remainingMicros).toBe(2_000_000)
  })

  it('verifies usage idempotency: same id+data is a no-op, a colliding id with different data throws', async () => {
    await store.grantOnce({ userId: USER, reason: 'initial', amountMicros: 10_000_000 })
    await store.recordUsage({ usageId: 'um-1', userId: USER, runId: 'R', source: 'pi-chat', billedCostMicros: 500_000 })
    // Exact retry (same id + user + runId + amount) → idempotent no-op, no extra debit.
    expect(await store.recordUsage({ usageId: 'um-1', userId: USER, runId: 'R', source: 'pi-chat', billedCostMicros: 500_000 })).toEqual({ inserted: false })
    expect((await store.getBalance(USER)).usedMicros).toBe(500_000)
    // A COLLISION: same id, DIFFERENT amount → must throw, not silently drop the debit.
    await expect(store.recordUsage({ usageId: 'um-1', userId: USER, runId: 'R', source: 'pi-chat', billedCostMicros: 999_999 })).rejects.toThrow(/usage ledger id collision/)
    // A collision from a DIFFERENT reservation (same id+amount, replayed message
    // id across reserve attempts) → must throw so the fallback hold charges.
    await store.recordUsage({ usageId: 'um-2', userId: USER, runId: 'R', source: 'pi-chat', billedCostMicros: 100_000, metadata: { reservationId: 'res-A' } })
    expect(await store.recordUsage({ usageId: 'um-2', userId: USER, runId: 'R', source: 'pi-chat', billedCostMicros: 100_000, metadata: { reservationId: 'res-A' } })).toEqual({ inserted: false })
    await expect(store.recordUsage({ usageId: 'um-2', userId: USER, runId: 'R', source: 'pi-chat', billedCostMicros: 100_000, metadata: { reservationId: 'res-B' } })).rejects.toThrow(/usage ledger id collision/)
  })

  it('idempotency verification compares ALL immutable fields, not just user+amount (audit integrity)', async () => {
    await store.grantOnce({ userId: USER, reason: 'initial', amountMicros: 10_000_000 })
    await store.recordUsage({ usageId: 'um-3', userId: USER, runId: 'R', source: 'pi-chat', provider: 'infomaniak', model: 'm1', inputTokens: 100, billedCostMicros: 200_000 })
    // Same id + same user + same billed amount, but a DIFFERENT model / token count —
    // a genuine retry can't change these, so it's a collision that would corrupt the
    // audit trail. Must throw, not silently accept as idempotent.
    await expect(store.recordUsage({ usageId: 'um-3', userId: USER, runId: 'R', source: 'pi-chat', provider: 'infomaniak', model: 'm2-different', inputTokens: 100, billedCostMicros: 200_000 }))
      .rejects.toThrow(/usage ledger id collision/)
    await expect(store.recordUsage({ usageId: 'um-3', userId: USER, runId: 'R', source: 'pi-chat', provider: 'infomaniak', model: 'm1', inputTokens: 999, billedCostMicros: 200_000 }))
      .rejects.toThrow(/usage ledger id collision/)
    // The exact same content is still an idempotent no-op.
    expect(await store.recordUsage({ usageId: 'um-3', userId: USER, runId: 'R', source: 'pi-chat', provider: 'infomaniak', model: 'm1', inputTokens: 100, billedCostMicros: 200_000 })).toEqual({ inserted: false })
  })

  it('scopes fallback billing to the reservation, not the reused runId', async () => {
    await store.grantOnce({ userId: USER, reason: 'initial', amountMicros: 10_000_000 })
    // Attempt A under reservation res-A bills €1 of real usage for runId R.
    await store.recordUsage({ usageId: 'u-A', userId: USER, runId: 'R', source: 'pi-chat', billedCostMicros: 1_000_000, metadata: { reservationId: 'res-A' } })
    // billedMicrosForRun (reused runId) sees A's €1; billedMicrosForReservation(res-B) sees €0.
    expect(await store.billedMicrosForRun(USER, 'R')).toBe(1_000_000)
    expect(await store.billedMicrosForReservation(USER, 'res-B')).toBe(0)
    expect(await store.billedMicrosForReservation(USER, 'res-A')).toBe(1_000_000)
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

  it('settles an EXECUTED run at its ACTUAL usage on expiry (unmarked: hold released, real usage kept, not free, not over-charged)', async () => {
    await store.grantOnce({ userId: USER, reason: 'initial', amountMicros: 10_000_000 })
    const { reservationId } = await store.reserve({ userId: USER, runId: 'turn-exec', amountMicros: 1_000_000, ttlSeconds: 600 })
    // The run executed and billed €0.2 of real usage (tagged with the reservation),
    // but finalization never settled the reservation. No fallback marker (it had
    // billable usage, so the coordinator settled, not fallback-charged).
    await store.recordUsage({ usageId: 'ux-1', userId: USER, runId: 'turn-exec', source: 'pi-chat', billedCostMicros: 200_000, metadata: { reservationId } })
    await sqlClient`UPDATE boring_usage_reservations SET expires_at = now() - interval '1 minute' WHERE run_id = 'turn-exec'`

    expect(await store.expireStaleReservations()).toBe(1)
    // Charged the €0.2 it ACTUALLY used (the recorded debit); the hold is released —
    // NOT topped up to the €1 hold (that would over-charge), NOT free.
    const balance = await store.getBalance(USER)
    expect(balance.usedMicros).toBe(200_000)
    expect(balance.activeReservedMicros).toBe(0)
    // Idempotent: a second sweep does not change the charge.
    await store.expireStaleReservations()
    expect((await store.getBalance(USER)).usedMicros).toBe(200_000)
  })

  it('does NOT charge a ZERO-billed run on expiry (only zero-token rows ⇒ no billable work ⇒ free)', async () => {
    await store.grantOnce({ userId: USER, reason: 'initial', amountMicros: 10_000_000 })
    const { reservationId } = await store.reserve({ userId: USER, runId: 'turn-zero', amountMicros: 1_000_000, ttlSeconds: 600 })
    // A zero-token usage row was written, then the terminal release was lost (e.g.
    // a user abort whose releaseRun failed transiently). The sweep must treat this
    // as non-billable and FREE it — charging the full hold would over-charge a run
    // that did no billable work (pi r27 P1).
    await store.recordUsage({ usageId: 'uz-1', userId: USER, runId: 'turn-zero', source: 'pi-chat', billedCostMicros: 0, metadata: { reservationId } })
    await sqlClient`UPDATE boring_usage_reservations SET expires_at = now() - interval '1 minute' WHERE run_id = 'turn-zero'`
    await store.expireStaleReservations()
    expect((await store.getBalance(USER)).usedMicros).toBe(0) // freed, not charged
  })

  it('charges a marked (fallback-intent) run on expiry even with ZERO billed rows (durable settlement)', async () => {
    await store.grantOnce({ userId: USER, reason: 'initial', amountMicros: 10_000_000 })
    const { reservationId } = await store.reserve({ userId: USER, runId: 'turn-mark', amountMicros: 1_000_000, ttlSeconds: 600 })
    // The coordinator decided this started/no-billable run must be charged and durably
    // marked it — but the actual fallback charge write then FAILED (no usage row). The
    // sweep must still charge the hold (a brief finalization-time outage must not free
    // a started run). pi r28 P1.
    await store.markReservationFallbackCharge(USER, reservationId)
    await sqlClient`UPDATE boring_usage_reservations SET expires_at = now() - interval '1 minute' WHERE run_id = 'turn-mark'`
    await store.expireStaleReservations()
    expect((await store.getBalance(USER)).usedMicros).toBe(1_000_000) // full hold charged
  })

  it('settles a partially-billed UNMARKED run at its ACTUAL usage on expiry (does not top up to the hold)', async () => {
    await store.grantOnce({ userId: USER, reason: 'initial', amountMicros: 10_000_000 })
    const { reservationId } = await store.reserve({ userId: USER, runId: 'turn-part', amountMicros: 1_000_000, ttlSeconds: 600 })
    // Real billable usage (€0.3) was recorded but only the final settle write was lost
    // (no fallback marker). The €0.3 IS the actual charge; expiry must release the hold,
    // NOT top up to the full €1 (which would over-charge a run that used €0.3).
    await store.recordUsage({ usageId: 'up-1', userId: USER, runId: 'turn-part', source: 'pi-chat', billedCostMicros: 300_000, metadata: { reservationId } })
    await sqlClient`UPDATE boring_usage_reservations SET expires_at = now() - interval '1 minute' WHERE run_id = 'turn-part'`
    await store.expireStaleReservations()
    expect((await store.getBalance(USER)).usedMicros).toBe(300_000) // actual usage, not the hold
  })

  it('does not re-charge a reservation that already settled before the expiry sweep', async () => {
    await store.grantOnce({ userId: USER, reason: 'initial', amountMicros: 10_000_000 })
    const { reservationId } = await store.reserve({ userId: USER, runId: 'turn-settled', amountMicros: 1_000_000, ttlSeconds: 600 })
    await store.recordUsage({ usageId: 'us-1', userId: USER, runId: 'turn-settled', source: 'pi-chat', billedCostMicros: 300_000, metadata: { reservationId } })
    await store.finishReservation({ reservationId }, 'settled') // real usage only
    await sqlClient`UPDATE boring_usage_reservations SET expires_at = now() - interval '1 minute' WHERE id = ${reservationId}`
    // Expiry's atomic claim only touches ACTIVE rows, so a settled row is not
    // topped up to the hold — the run is charged its real €0.3, not €1.
    await store.expireStaleReservations()
    expect((await store.getBalance(USER)).usedMicros).toBe(300_000)
  })

  it('expires a stale reservation via the reserve() path too, charging a MARKED run to its hold', async () => {
    await store.grantOnce({ userId: USER, reason: 'initial', amountMicros: 10_000_000 })
    const { reservationId } = await store.reserve({ userId: USER, runId: 'turn-a', amountMicros: 1_000_000, ttlSeconds: 600 })
    await store.recordUsage({ usageId: 'ua-1', userId: USER, runId: 'turn-a', source: 'pi-chat', billedCostMicros: 300_000, metadata: { reservationId } })
    // Marked as fallback-charge-owed (the coordinator's charge write failed), so the
    // reserve()-path expiry tops it up to its €1 hold (crediting the €0.3 already billed).
    await store.markReservationFallbackCharge(USER, reservationId)
    await sqlClient`UPDATE boring_usage_reservations SET expires_at = now() - interval '1 minute' WHERE run_id = 'turn-a'`
    // A NEW reserve for the same user expires the stale one through the same policy.
    await store.reserve({ userId: USER, runId: 'turn-b', amountMicros: 1_000_000, ttlSeconds: 600 })
    expect((await store.getBalance(USER)).usedMicros).toBe(1_000_000) // turn-a topped up to its hold
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

  it('listLedger returns merged, signed, sanitized, newest-first activity scoped to the user', async () => {
    await store.grantOnce({ userId: USER, reason: 'signup_grant', amountMicros: 2_000_000 })
    await store.grantOnce({ userId: USER, reason: 'purchase:ord-1', amountMicros: 10_000_000 })
    await store.recordUsage({ usageId: 'led-u1', userId: USER, source: 'pi-chat', billedCostMicros: 300_000, metadata: {} })
    await store.recordUsage({ usageId: 'led-fb', userId: USER, source: 'pi-chat-fallback', billedCostMicros: 50_000, metadata: {} })
    await store.recordUsage({ usageId: 'led-rf', userId: USER, source: 'lemonsqueezy-refund', billedCostMicros: 1_000_000, metadata: {} })
    await store.recordUsage({ usageId: 'led-zero', userId: USER, source: 'pi-chat', billedCostMicros: 0, metadata: {} }) // omitted (noise)
    await store.grantOnce({ userId: OTHER_USER, reason: 'signup_grant', amountMicros: 2_000_000 }) // other user — excluded

    const entries = await store.listLedger(USER, 50)
    const kinds = entries.map((e) => e.kind).sort()
    expect(kinds).toEqual(['fallback', 'grant', 'purchase', 'refund', 'usage'])
    const byKind = Object.fromEntries(entries.map((e) => [e.kind, e]))
    expect(byKind.grant).toMatchObject({ amountMicros: 2_000_000, description: 'Signup grant' })
    expect(byKind.purchase).toMatchObject({ amountMicros: 10_000_000, description: 'Credit purchase' })
    expect(byKind.usage).toMatchObject({ amountMicros: -300_000, description: 'Agent usage' })
    expect(byKind.fallback).toMatchObject({ amountMicros: -50_000, description: 'Usage reconciliation' })
    expect(byKind.refund).toMatchObject({ amountMicros: -1_000_000, description: 'Refund' })
    // No zero-amount (zero-token) noise; no other user's rows; descriptions are generic.
    expect(entries.every((e) => e.amountMicros !== 0)).toBe(true)
    expect(JSON.stringify(entries)).not.toContain('ord-1') // no order id leaked
    // Ids are opaque tokens — no raw ledger keys (usage/refund/session/message ids).
    const serialized = JSON.stringify(entries)
    for (const raw of ['led-u1', 'led-fb', 'led-rf', 'pi-chat']) expect(serialized).not.toContain(raw)
    expect(entries.every((e) => /^[gu]_[0-9a-f]{8}$/.test(e.id))).toBe(true)
  })

  it('listLedger clamps the limit to 1..50', async () => {
    await store.grantOnce({ userId: USER, reason: 'signup_grant', amountMicros: 1_000 })
    expect(await store.listLedger(USER, 0)).toHaveLength(1) // clamped up to >=1, returns the one row
    expect((await store.listLedger(USER, 9999)).length).toBeLessThanOrEqual(50)
  })

  it('listLedger does not let recent zero-cost rows hide older billable usage', async () => {
    // Older billable usage, then several newer zero-cost (zero-token) rows.
    await store.recordUsage({ usageId: 'led-old', userId: USER, source: 'pi-chat', billedCostMicros: 700_000, metadata: {} })
    for (let i = 0; i < 3; i += 1) {
      await store.recordUsage({ usageId: `led-zero-${i}`, userId: USER, source: 'pi-chat', billedCostMicros: 0, metadata: {} })
    }
    // Even with a small limit, the billable row must surface (zero rows are excluded in SQL).
    const entries = await store.listLedger(USER, 2)
    expect(entries.some((e) => e.kind === 'usage' && e.amountMicros === -700_000)).toBe(true)
    expect(entries.every((e) => e.amountMicros !== 0)).toBe(true)
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

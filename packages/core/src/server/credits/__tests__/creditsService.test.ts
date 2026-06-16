import { describe, it, expect, vi } from 'vitest'
import { InsufficientCreditError } from '../../db/stores/PostgresMeteringStore'
import {
  CreditsService,
  CreditExhaustedError,
  SIGNUP_GRANT_REASON,
  type CreditsConfig,
  type CreditsMeteringStore,
} from '../creditsService'

const CONFIG: CreditsConfig = {
  enabled: true,
  signupGrantMicros: 2_000_000,
  signupGrantExpiresAfterDays: null,
  runReservationMicros: 250_000,
  reservationTtlSeconds: 7200,
  minBalanceMicros: 50_000,
  pricing: { margin: 1, creditMicrosPerUnit: 1_000_000 },
}

function makeStore(overrides: Partial<CreditsMeteringStore> = {}): CreditsMeteringStore {
  return {
    grantOnce: vi.fn(async () => ({ created: true })),
    grantPurchaseOnce: vi.fn(async () => ({ granted: true })),
    revokePurchase: vi.fn(async () => ({ revoked: true })),
    getBalance: vi.fn(async () => ({
      userId: 'u1',
      grantedMicros: 2_000_000,
      usedMicros: 500_000,
      remainingMicros: 1_500_000,
      activeReservedMicros: 250_000,
      availableMicros: 1_250_000,
    })),
    reserve: vi.fn(async () => ({ reservationId: 'res-1' })),
    recordUsage: vi.fn(async () => ({ inserted: true })),
    finishReservation: vi.fn(async () => ({ updated: true })),
    expireStaleReservations: vi.fn(async () => 0),
    billedMicrosForRun: vi.fn(async () => 0),
    billedMicrosForReservation: vi.fn(async () => 0),
    markReservationFallbackCharge: vi.fn(async () => {}),
    listLedger: vi.fn(async () => []),
    ...overrides,
  }
}

describe('CreditsService', () => {
  it('grants the signup credits once per process and maps the balance for the UI', async () => {
    const store = makeStore()
    const service = new CreditsService(store, CONFIG)

    const balance = await service.getBalance('u1')
    await service.getBalance('u1')

    expect(store.grantOnce).toHaveBeenCalledTimes(1)
    expect(store.grantOnce).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'u1', reason: SIGNUP_GRANT_REASON, amountMicros: 2_000_000,
    }))
    expect(vi.mocked(store.grantOnce).mock.calls[0][0]).not.toHaveProperty('expiresAt')
    expect(balance).toMatchObject({
      enabled: true,
      userId: 'u1',
      grantedMicros: 2_000_000,
      usedMicros: 500_000,
      activeReservedMicros: 250_000,
      // remaining = granted − used; available = remaining − active hold.
      remainingMicros: 1_500_000,
      availableMicros: 1_250_000,
      currency: 'credits',
    })
  })

  it('rejects an expiring signup grant config (would create debt after partial spend)', () => {
    expect(() => new CreditsService(makeStore(), { ...CONFIG, signupGrantExpiresAfterDays: 30 })).toThrow(/signupGrantExpiresAfterDays is not supported/)
  })

  it('grants the signup credits without an expiry', async () => {
    const store = makeStore()
    await new CreditsService(store, CONFIG).getBalance('u1')
    expect(store.grantOnce).toHaveBeenCalledWith(expect.objectContaining({ reason: SIGNUP_GRANT_REASON }))
    expect(vi.mocked(store.grantOnce).mock.calls[0][0]).not.toHaveProperty('expiresAt')
  })

  it('never reports negative balance but surfaces debt', async () => {
    const store = makeStore({
      getBalance: vi.fn(async () => ({ userId: 'u1', grantedMicros: 0, usedMicros: 100, remainingMicros: -100, activeReservedMicros: 0, availableMicros: -100 })),
    })
    const balance = await new CreditsService(store, CONFIG).getBalance('u1')
    expect(balance.remainingMicros).toBe(0)
    expect(balance.availableMicros).toBe(0)
    expect(balance.debtMicros).toBe(100)
  })

  it('grants a purchase idempotently keyed on the order id', async () => {
    const store = makeStore()
    const service = new CreditsService(store, CONFIG)
    await service.grantPurchase('u1', 'order-9', 10_000_000)
    expect(store.grantPurchaseOnce).toHaveBeenCalledWith({ userId: 'u1', orderId: 'order-9', amountMicros: 10_000_000 })
  })

  it('reserves a hold and returns the reservation id', async () => {
    const store = makeStore()
    const service = new CreditsService(store, CONFIG)
    const id = await service.reserveRun({ userId: 'u1', workspaceId: 'w', sessionId: 's', runId: 'r' })
    expect(id).toBe('res-1')
    // No GLOBAL cross-user sweep on admission — store.reserve() expires THIS user's
    // stale rows under the per-user lock (so an unrelated user's stale row can't fail
    // or slow this reserve).
    expect(store.expireStaleReservations).not.toHaveBeenCalled()
    expect(store.reserve).toHaveBeenCalledWith(expect.objectContaining({
      // minAvailable = hold (250k) + floor (50k): keep the floor AFTER reserving.
      userId: 'u1', runId: 'r', amountMicros: 250_000, ttlSeconds: 7200, minAvailableMicros: 300_000,
    }))
  })

  it('maps insufficient credit to a 402 CreditExhaustedError with the balance', async () => {
    const store = makeStore({ reserve: vi.fn(async () => { throw new InsufficientCreditError(10, 250_000) }) })
    const service = new CreditsService(store, CONFIG)
    const err = await service.reserveRun({ userId: 'u1', runId: 'r' }).then(() => null, (e) => e)
    expect(err).toBeInstanceOf(CreditExhaustedError)
    expect(err).toMatchObject({ statusCode: 402, code: 'PAYMENT_REQUIRED', details: { balance: expect.objectContaining({ currency: 'credits' }) } })
  })

  it('rethrows non-credit reserve failures', async () => {
    const failure = new Error('db down')
    const store = makeStore({ reserve: vi.fn(async () => { throw failure }) })
    await expect(new CreditsService(store, CONFIG).reserveRun({ userId: 'u1', runId: 'r' })).rejects.toBe(failure)
  })

  it('records usage priced token→credits with margin', async () => {
    const store = makeStore()
    const service = new CreditsService(store, {
      ...CONFIG,
      pricing: { margin: 1.3, creditMicrosPerUnit: 1_000_000, rates: [[/infomaniak/, { inputPerMillion: 0.5, outputPerMillion: 1.5 }]] },
    })
    await service.recordUsage({
      usageId: 'usage-1', userId: 'u1', runId: 'r', messageId: 'm', reservationId: 'res-1',
      provider: 'infomaniak', model: 'infomaniak/mistral',
      usage: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } },
      stopReason: 'stop',
    })
    // €0.5 raw → billed €0.5 × 1.3.
    expect(store.recordUsage).toHaveBeenCalledWith(expect.objectContaining({
      usageId: 'usage-1', provider: 'infomaniak', model: 'infomaniak/mistral',
      providerCostMicros: 500_000, billedCostMicros: Math.ceil(0.5 * 1.3 * 1_000_000),
    }))
  })

  it('fallback-charges only the delta up to the hold, scoped to THIS reservation', async () => {
    // €0.2 already billed for this reservation; hold 250k → top up 50k only.
    // billedMicrosForRun (reused runId) is large but must NOT be used.
    const store = makeStore({ billedMicrosForReservation: vi.fn(async () => 200_000), billedMicrosForRun: vi.fn(async () => 9_999_999) })
    const service = new CreditsService(store, CONFIG)
    await service.chargeFallbackUsage({ userId: 'u1', runId: 'r', reservationId: 'res-1' })
    // The durable charge intent is recorded BEFORE the top-up/settle, so a failed
    // charge write still lets expiry charge the hold.
    expect(store.markReservationFallbackCharge).toHaveBeenCalledWith('u1', 'res-1')
    expect(store.billedMicrosForReservation).toHaveBeenCalledWith('u1', 'res-1')
    expect(store.billedMicrosForRun).not.toHaveBeenCalled()
    expect(store.recordUsage).toHaveBeenCalledWith(expect.objectContaining({ billedCostMicros: 50_000, source: 'pi-chat-fallback' }))
    expect(store.finishReservation).toHaveBeenCalledWith({ reservationId: 'res-1' }, 'settled')
  })

  it('tags fallback audit metadata by cause (usage_write_failed vs no_billable_usage)', async () => {
    const store = makeStore()
    const service = new CreditsService(store, CONFIG)
    await service.chargeFallbackUsage({ userId: 'u1', runId: 'r', reservationId: 'res-1', kind: 'usage_write_failed' })
    expect(store.recordUsage).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ kind: 'usage_write_failed_fallback' }) }))

    const store2 = makeStore()
    await new CreditsService(store2, CONFIG).chargeFallbackUsage({ userId: 'u1', runId: 'r', reservationId: 'res-2', kind: 'no_billable_usage' })
    expect(store2.recordUsage).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ kind: 'no_billable_usage_fallback' }) }))
  })

  it('fallback skips the debit entirely when this reservation already met the hold', async () => {
    const store = makeStore({ billedMicrosForReservation: vi.fn(async () => 300_000) }) // ≥ hold
    const service = new CreditsService(store, CONFIG)
    await service.chargeFallbackUsage({ userId: 'u1', runId: 'r', reservationId: 'res-1' })
    expect(store.recordUsage).not.toHaveBeenCalled()
    expect(store.finishReservation).toHaveBeenCalledWith({ reservationId: 'res-1' }, 'settled')
  })

  it('fallback falls back to runId scoping when no reservation id is known', async () => {
    const store = makeStore({ billedMicrosForRun: vi.fn(async () => 100_000) })
    const service = new CreditsService(store, CONFIG)
    await service.chargeFallbackUsage({ userId: 'u1', runId: 'r' })
    expect(store.billedMicrosForRun).toHaveBeenCalledWith('u1', 'r')
    expect(store.recordUsage).toHaveBeenCalledWith(expect.objectContaining({ billedCostMicros: 150_000 }))
  })

  it('settles and releases by reservation id when present, else by run+user', async () => {
    const store = makeStore()
    const service = new CreditsService(store, CONFIG)
    await service.settleRun('u1', 'r', 'res-1')
    await service.releaseRun('u1', 'r')
    expect(store.finishReservation).toHaveBeenCalledWith({ reservationId: 'res-1' }, 'settled')
    expect(store.finishReservation).toHaveBeenCalledWith({ runId: 'r', userId: 'u1' }, 'released')
  })

  it('no-ops entirely when disabled', async () => {
    const store = makeStore()
    const service = new CreditsService(store, { ...CONFIG, enabled: false })
    const balance = await service.getBalance('u1')
    expect(balance.enabled).toBe(false)
    expect(await service.reserveRun({ userId: 'u1', runId: 'r' })).toBeUndefined()
    await service.recordUsage({ usageId: 'x', userId: 'u1', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: { total: 1 } } })
    await service.settleRun('u1', 'r')
    expect(store.grantOnce).not.toHaveBeenCalled()
    expect(store.reserve).not.toHaveBeenCalled()
    expect(store.recordUsage).not.toHaveBeenCalled()
    expect(store.finishReservation).not.toHaveBeenCalled()
  })

  describe('telemetry', () => {
    function withCapture() {
      const events: Array<{ name: string; distinctId?: string; properties?: Record<string, unknown> }> = []
      return { events, sink: { capture: (e: typeof events[number]) => { events.push(e) } } }
    }

    it('emits purchase.completed with amount/currency/pack on a fresh grant only', async () => {
      const { events, sink } = withCapture()
      const store = makeStore()
      const service = new CreditsService(store, CONFIG, undefined, sink)
      await service.grantPurchase('u1', 'order-1', 10_000_000, { currency: 'CHF', variantId: '10' })

      const purchase = events.find((e) => e.name === 'purchase.completed')
      expect(purchase).toMatchObject({
        distinctId: 'u1',
        properties: { creditMicros: 10_000_000, currency: 'CHF', packId: '10' },
      })

      // Idempotent retry (granted=false) must NOT re-emit.
      events.length = 0
      ;(store.grantPurchaseOnce as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ granted: false })
      await service.grantPurchase('u1', 'order-1', 10_000_000, { currency: 'CHF', variantId: '10' })
      expect(events.find((e) => e.name === 'purchase.completed')).toBeUndefined()
    })

    it('emits run.started on reserve and credits.exhausted when out of credits', async () => {
      const { events, sink } = withCapture()
      const okStore = makeStore()
      await new CreditsService(okStore, CONFIG, undefined, sink).reserveRun({ userId: 'u1', runId: 'r1' })
      expect(events.find((e) => e.name === 'run.started')?.distinctId).toBe('u1')

      events.length = 0
      const brokeStore = makeStore({
        reserve: vi.fn(async () => { throw new InsufficientCreditError(100, 250_000) }),
      })
      await expect(
        new CreditsService(brokeStore, CONFIG, undefined, sink).reserveRun({ userId: 'u2', runId: 'r2' }),
      ).rejects.toBeInstanceOf(CreditExhaustedError)
      expect(events.find((e) => e.name === 'credits.exhausted')?.distinctId).toBe('u2')
    })
  })
})

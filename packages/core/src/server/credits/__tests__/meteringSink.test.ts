import { describe, it, expect, vi } from 'vitest'
import { createCreditsMeteringSink } from '../meteringSink'
import { CreditsService, type CreditsConfig, type CreditsMeteringStore } from '../creditsService'

const CONFIG: CreditsConfig = {
  enabled: true,
  signupGrantMicros: 2_000_000,
  signupGrantExpiresAfterDays: null,
  runReservationMicros: 250_000,
  reservationTtlSeconds: 7200,
  minBalanceMicros: 50_000,
  pricing: { margin: 1, creditMicrosPerUnit: 1_000_000 },
}

function makeStore(): CreditsMeteringStore {
  return {
    grantOnce: vi.fn(async () => ({ created: false })),
    grantPurchaseOnce: vi.fn(async () => ({ granted: true })),
    revokePurchase: vi.fn(async () => ({ revoked: true })),
    getBalance: vi.fn(async () => ({ userId: 'u1', grantedMicros: 2_000_000, usedMicros: 0, remainingMicros: 2_000_000, activeReservedMicros: 0, availableMicros: 2_000_000 })),
    reserve: vi.fn(async () => ({ reservationId: 'res-1' })),
    recordUsage: vi.fn(async () => ({ inserted: true })),
    finishReservation: vi.fn(async () => ({ updated: true })),
    expireStaleReservations: vi.fn(async () => 0),
    billedMicrosForRun: vi.fn(async () => 0),
    billedMicrosForReservation: vi.fn(async () => 0),
    markReservationFallbackCharge: vi.fn(async () => {}),
  }
}

const BASE = { workspaceId: 'w', sessionId: 's', runId: 'pi-run:s:prompt:n', source: 'pi-chat' as const }

describe('createCreditsMeteringSink', () => {
  it('reserves and returns the reservation id for an authenticated user', async () => {
    const store = makeStore()
    const sink = createCreditsMeteringSink(() => new CreditsService(store, CONFIG))
    const result = await sink.reserveRun({ ...BASE, userId: 'u1', kind: 'prompt', message: 'hi' })
    expect(result).toEqual({ reservationId: 'res-1' })
    expect(store.reserve).toHaveBeenCalled()
  })

  it('fails closed with 401 when the run has no user', async () => {
    const store = makeStore()
    const sink = createCreditsMeteringSink(() => new CreditsService(store, CONFIG))
    await expect(sink.reserveRun({ ...BASE, kind: 'prompt', message: 'hi' })).rejects.toMatchObject({ statusCode: 401 })
    expect(store.reserve).not.toHaveBeenCalled()
  })

  it('skips reserve and returns empty when credits are disabled', async () => {
    const store = makeStore()
    const sink = createCreditsMeteringSink(() => new CreditsService(store, { ...CONFIG, enabled: false }))
    await expect(sink.reserveRun({ ...BASE, kind: 'prompt', message: 'hi' })).resolves.toEqual({})
    expect(store.reserve).not.toHaveBeenCalled()
  })

  it('records usage and settles/releases by reservation id', async () => {
    const store = makeStore()
    const sink = createCreditsMeteringSink(() => new CreditsService(store, CONFIG))
    await sink.recordUsage({
      ...BASE, userId: 'u1', usageId: 'usage-1', messageId: 'm', reservationId: 'res-1',
      model: { provider: 'infomaniak', id: 'infomaniak/mistral' },
      usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'stop',
    })
    await sink.settleRun({ ...BASE, userId: 'u1', reservationId: 'res-1', status: 'ok' })
    await sink.releaseRun({ ...BASE, userId: 'u1', reservationId: 'res-1', reason: 'queue-cleared' })
    expect(store.recordUsage).toHaveBeenCalledWith(expect.objectContaining({ usageId: 'usage-1', model: 'infomaniak/mistral' }))
    expect(store.finishReservation).toHaveBeenCalledWith({ reservationId: 'res-1' }, 'settled')
    expect(store.finishReservation).toHaveBeenCalledWith({ reservationId: 'res-1' }, 'released')
  })

  it('charges a fallback hold and settles on usage-write-failed (run never goes free)', async () => {
    const store = makeStore()
    const sink = createCreditsMeteringSink(() => new CreditsService(store, CONFIG))
    await sink.releaseRun({ ...BASE, userId: 'u1', reservationId: 'res-1', reason: 'usage-write-failed' })
    // Conservative debit equal to the per-run hold, then settle — not a free release.
    expect(store.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ usageId: 'usage-fallback:res-1', billedCostMicros: CONFIG.runReservationMicros, source: 'pi-chat-fallback' }),
    )
    expect(store.finishReservation).toHaveBeenCalledWith({ reservationId: 'res-1' }, 'settled')
    expect(store.finishReservation).not.toHaveBeenCalledWith(expect.anything(), 'released')
  })

  it('skips usage/settle/release for userless runs', async () => {
    const store = makeStore()
    const sink = createCreditsMeteringSink(() => new CreditsService(store, CONFIG))
    await sink.recordUsage({ ...BASE, usageId: 'u', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } })
    await sink.settleRun({ ...BASE, status: 'ok' })
    await sink.releaseRun({ ...BASE, reason: 'cancelled' })
    expect(store.recordUsage).not.toHaveBeenCalled()
    expect(store.finishReservation).not.toHaveBeenCalled()
  })
})

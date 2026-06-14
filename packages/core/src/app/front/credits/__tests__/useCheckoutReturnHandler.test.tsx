// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCheckoutReturnHandler } from '../useCheckoutReturnHandler'
import { CHECKOUT_BASELINE_STORAGE_KEY } from '../useCreditBalance'

function balance(remainingMicros: number, debtMicros = 0) {
  return {
    enabled: true,
    userId: 'u1',
    grantedMicros: 0,
    usedMicros: 0,
    remainingMicros,
    activeReservedMicros: 0,
    availableMicros: remainingMicros,
    debtMicros,
    currency: 'credits' as const,
  }
}

function mockBalanceFetch(...sequence: Array<ReturnType<typeof balance> | null>) {
  let i = 0
  return vi.fn(async () => {
    const next = sequence[Math.min(i, sequence.length - 1)]
    i += 1
    if (next === null) return { ok: false, json: async () => ({}) } as unknown as Response
    return { ok: true, json: async () => next } as unknown as Response
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  window.history.replaceState({}, '', '/?checkout=return')
  window.localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function settle() {
  // Flush the async IIFE (baseline read) then run the confirm-schedule timers.
  await act(async () => { await Promise.resolve() })
  await act(async () => { await vi.advanceTimersByTimeAsync(65_000) })
}

describe('useCheckoutReturnHandler', () => {
  it('confirms only after a real net increase vs the stored pre-checkout baseline', async () => {
    window.localStorage.setItem(CHECKOUT_BASELINE_STORAGE_KEY, JSON.stringify({ net: 0, ts: Date.now() }))
    vi.stubGlobal('fetch', mockBalanceFetch(balance(1_000_000)))

    const { result } = renderHook(() => useCheckoutReturnHandler())
    await settle()
    expect(result.current.status).toBe('confirmed')
  })

  it('does NOT confirm a spoofed return when no baseline can be established', async () => {
    // No stored baseline + the baseline fetch fails → baseline is null → never confirm,
    // even though later polls return a (pre-existing) balance.
    vi.stubGlobal('fetch', mockBalanceFetch(null, balance(9_000_000)))

    const { result } = renderHook(() => useCheckoutReturnHandler())
    await settle()
    expect(result.current.status).toBe('processing')
  })

  it('confirms a debt-clearing top-up even though remainingMicros stays at 0', async () => {
    // Pre-checkout: in debt (net −5e6). After: debt cleared (net 0) → increase.
    window.localStorage.setItem(CHECKOUT_BASELINE_STORAGE_KEY, JSON.stringify({ net: -5_000_000, ts: Date.now() }))
    vi.stubGlobal('fetch', mockBalanceFetch(balance(0, 0)))

    const { result } = renderHook(() => useCheckoutReturnHandler())
    await settle()
    expect(result.current.status).toBe('confirmed')
  })

  it('reports cancelled without polling when the marker is cancelled', async () => {
    window.history.replaceState({}, '', '/?checkout=cancelled')
    const fetchSpy = mockBalanceFetch(balance(1_000_000))
    vi.stubGlobal('fetch', fetchSpy)

    const { result } = renderHook(() => useCheckoutReturnHandler())
    await settle()
    expect(result.current.status).toBe('cancelled')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

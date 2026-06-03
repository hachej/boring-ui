import { describe, test, expect, vi, beforeEach } from 'vitest'

let stateSlots: Array<[unknown, (v: unknown) => void]> = []
let effectCallbacks: Array<() => void | (() => void)> = []
let callbackFns: Array<(...args: unknown[]) => unknown> = []
const versionStore = { current: 0 }

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return {
    ...actual,
    useState: (init: unknown) => {
      const val = typeof init === 'function' ? (init as () => unknown)() : init
      const setter = vi.fn()
      const slot: [unknown, (v: unknown) => void] = [val, setter]
      stateSlots.push(slot)
      return slot
    },
    useEffect: (fn: () => void | (() => void)) => {
      effectCallbacks.push(fn)
    },
    useCallback: <T extends (...args: unknown[]) => unknown>(fn: T) => {
      callbackFns.push(fn)
      return fn
    },
    useMemo: <T>(fn: () => T) => fn(),
    useRef: (initial: unknown) => {
      if (typeof initial === 'number') {
        versionStore.current = initial
        return versionStore
      }
      return { current: initial }
    },
  }
})

import { useSessions } from '../useSessions'

const mockFetch = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  stateSlots = []
  effectCallbacks = []
  callbackFns = []
  versionStore.current = 0
  globalThis.fetch = mockFetch as unknown as typeof fetch
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() },
    writable: true,
  })
})

describe('useSessions', () => {
  test('returns expected shape', () => {
    const result = useSessions()
    expect(result).toHaveProperty('sessions')
    expect(result).toHaveProperty('activeSession')
    expect(result).toHaveProperty('activeSessionId')
    expect(result).toHaveProperty('loading')
    expect(result).toHaveProperty('error')
    expect(result).toHaveProperty('create')
    expect(result).toHaveProperty('switch')
    expect(result).toHaveProperty('delete')
  })

  test('initial state is loading with empty sessions', () => {
    const result = useSessions()
    expect(result.sessions).toEqual([])
    expect(result.loading).toBe(true)
    expect(result.error).toBeUndefined()
  })

  test('uses an initial active session id when provided', () => {
    useSessions({ initialActiveSessionId: 'session-from-url' })

    expect(stateSlots[1][0]).toBe('session-from-url')
  })

  test('effect calls refresh on mount', () => {
    useSessions()
    expect(effectCallbacks).toHaveLength(1)
    const refreshFn = callbackFns[0]
    expect(refreshFn).toBeDefined()
  })

  test('refresh fetches sessions from API', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 's1', title: 'First' }],
    })

    useSessions()
    const refreshFn = callbackFns[0]
    await refreshFn()

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/agent/sessions')
    const setSessions = stateSlots[0][1]
    expect(setSessions).toHaveBeenCalled()
  })

  test('does not fetch sessions while disabled', async () => {
    useSessions({ enabled: false })
    const effect = effectCallbacks[0]
    effect()

    expect(mockFetch).not.toHaveBeenCalled()
    const setLoading = stateSlots[2][1]
    expect(setLoading).toHaveBeenCalledWith(false)
  })

  test('refresh forwards requestHeaders', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 's1', title: 'First' }],
    })

    useSessions({ requestHeaders: { 'x-boring-workspace-id': 'w1' } })
    const refreshFn = callbackFns[0]
    await refreshFn()

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/agent/sessions', {
      headers: { 'x-boring-workspace-id': 'w1' },
    })
  })

  test('retries transient 503s without surfacing an error, then loads sessions', async () => {
    vi.useFakeTimers()
    try {
      // First three calls 503 ("runtime still preparing"), then success.
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 503 })
        .mockResolvedValueOnce({ ok: false, status: 503 })
        .mockResolvedValueOnce({ ok: false, status: 503 })
        .mockResolvedValueOnce({ ok: true, json: async () => [{ id: 's1', title: 'First' }] })

      useSessions()
      const refreshFn = callbackFns[0]
      const setError = stateSlots[3][1]
      const setSessions = stateSlots[0][1]

      const promise = refreshFn()
      // Drain the backoff timers + microtasks between retries.
      await vi.runAllTimersAsync()
      await promise

      // It retried past the 503s and eventually fetched successfully.
      expect(mockFetch).toHaveBeenCalledTimes(4)
      expect(setSessions).toHaveBeenCalledWith([{ id: 's1', title: 'First' }])
      // No terminal error was surfaced (only setError(undefined) on success).
      const setErrorMock = setError as unknown as ReturnType<typeof vi.fn>
      const sawTruthyError = setErrorMock.mock.calls.some((call: unknown[]) => Boolean(call[0]))
      expect(sawTruthyError).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  test('does not retry a non-503 failure (no infinite retry on a real 500)', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 })

    useSessions()
    const refreshFn = callbackFns[0]
    await refreshFn()

    // A 500 is terminal: exactly one fetch, error surfaced.
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const setError = stateSlots[3][1]
    expect(setError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('500') }))
  })

  test('gives up after the bounded retry budget on a persistent 503', async () => {
    vi.useFakeTimers()
    try {
      mockFetch.mockResolvedValue({ ok: false, status: 503 })

      useSessions()
      const refreshFn = callbackFns[0]
      const setError = stateSlots[3][1]

      const promise = refreshFn()
      await vi.runAllTimersAsync()
      await promise

      // Bounded: MAX_SESSIONS_RETRIES (8) retries => 9 total attempts, not infinite.
      expect(mockFetch).toHaveBeenCalledTimes(9)
      // After exhausting the budget the 503 surfaces as a terminal error.
      expect(setError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('preparing') }))
    } finally {
      vi.useRealTimers()
    }
  })

  test('refresh skips stale responses via version counter', async () => {
    let resolveFetch!: (v: unknown) => void
    mockFetch.mockReturnValueOnce(
      new Promise((r) => { resolveFetch = r }),
    )

    useSessions()
    const refreshFn = callbackFns[0]
    const p = refreshFn()

    versionStore.current = 99

    resolveFetch({ ok: true, json: async () => [{ id: 's1', title: 'A' }] })
    await p

    const setSessions = stateSlots[0][1]
    expect(setSessions).not.toHaveBeenCalled()
  })

  test('create POSTs and returns new session', async () => {
    const newSession = { id: 's-new', title: 'New session' }
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => newSession })
      .mockResolvedValueOnce({ ok: true, json: async () => [newSession] })

    useSessions()
    const createFn = callbackFns[1]

    const result = await createFn({ title: 'New session' })
    expect(result).toEqual(newSession)
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/agent/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New session' }),
    })
  })

  test('create forwards requestHeaders with JSON content type', async () => {
    const newSession = { id: 's-new', title: 'New session' }
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => newSession })
      .mockResolvedValueOnce({ ok: true, json: async () => [newSession] })

    useSessions({ requestHeaders: { 'x-boring-workspace-id': 'w1' } })
    const createFn = callbackFns[1]

    await createFn({ title: 'New session' })
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/agent/sessions', {
      method: 'POST',
      headers: {
        'x-boring-workspace-id': 'w1',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: 'New session' }),
    })
  })

  test('create persists activeSessionId to localStorage', async () => {
    const newSession = { id: 's-new', title: 'Test' }
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => newSession })
      .mockResolvedValueOnce({ ok: true, json: async () => [newSession] })

    useSessions()
    const createFn = callbackFns[1]
    await createFn()

    expect(localStorage.setItem).toHaveBeenCalledWith(
      'boring-agent:activeSessionId',
      's-new',
    )
  })

  test('create calls refresh after success', async () => {
    const newSession = { id: 's-new', title: 'Test' }
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => newSession })
      .mockResolvedValueOnce({ ok: true, json: async () => [newSession] })

    useSessions()
    const createFn = callbackFns[1]
    await createFn()

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(mockFetch).toHaveBeenLastCalledWith('/api/v1/agent/sessions')
  })

  test('create keeps the new session visible when the immediate refresh is stale empty', async () => {
    const newSession = { id: 's-new', title: 'Test' }
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => newSession })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })

    useSessions()
    const createFn = callbackFns[1]
    await createFn()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const setSessions = stateSlots[0][1] as unknown as ReturnType<typeof vi.fn>
    expect(setSessions).toHaveBeenCalledWith([newSession])
    expect(setSessions).not.toHaveBeenCalledWith([])
  })

  test('create surfaces error on failure', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })

    useSessions()
    const createFn = callbackFns[1]

    await expect(createFn()).rejects.toThrow('Failed to create session: 500')
  })

  test('switch updates activeSessionId and persists', () => {
    useSessions()
    const switchFn = callbackFns[2]
    switchFn('s-42')

    const setActiveId = stateSlots[1][1]
    expect(setActiveId).toHaveBeenCalledWith('s-42')
    expect(localStorage.setItem).toHaveBeenCalledWith(
      'boring-agent:activeSessionId',
      's-42',
    )
  })

  test('switch can persist under a workspace-scoped storageKey', () => {
    useSessions({ storageKey: 'boring-agent:activeSessionId:w1' })
    const switchFn = callbackFns[2]
    switchFn('s-42')

    expect(localStorage.setItem).toHaveBeenCalledWith(
      'boring-agent:activeSessionId:w1',
      's-42',
    )
  })

  test('delete sends DELETE request', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 204 })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })

    useSessions()
    const deleteFn = callbackFns[3]
    await deleteFn('s1')

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/agent/sessions/s1',
      { method: 'DELETE' },
    )
  })

  test('delete forwards requestHeaders', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 204 })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })

    useSessions({ requestHeaders: { 'x-boring-workspace-id': 'w1' } })
    const deleteFn = callbackFns[3]
    await deleteFn('s1')

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/agent/sessions/s1',
      {
        method: 'DELETE',
        headers: { 'x-boring-workspace-id': 'w1' },
      },
    )
  })

  test('delete optimistically removes from sessions list', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 204 })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })

    useSessions()
    const deleteFn = callbackFns[3]
    await deleteFn('s1')

    const setSessions = stateSlots[0][1]
    expect(setSessions).toHaveBeenCalledWith(expect.any(Function))
  })

  test('delete clears activeSessionId if deleted session was active', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 204 })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })

    useSessions()
    const deleteFn = callbackFns[3]
    await deleteFn('s1')

    const setActiveId = stateSlots[1][1]
    expect(setActiveId).toHaveBeenCalledWith(expect.any(Function))
  })

  test('delete calls refresh after success', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 204 })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })

    useSessions()
    const deleteFn = callbackFns[3]
    await deleteFn('s1')

    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  test('delete treats 404 as success', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })

    useSessions()
    const deleteFn = callbackFns[3]
    await expect(deleteFn('gone')).resolves.toBeUndefined()
  })

  test('delete surfaces error and refreshes on server failure', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ id: 's1' }] })

    useSessions()
    const deleteFn = callbackFns[3]

    await expect(deleteFn('s1')).rejects.toThrow('Failed to delete session: 500')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  test('delete rolls back on network error and refreshes', async () => {
    mockFetch
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ ok: true, json: async () => [{ id: 's1' }] })

    useSessions()
    const deleteFn = callbackFns[3]

    await expect(deleteFn('s1')).rejects.toThrow('Failed to fetch')
    const setError = stateSlots[3][1]
    expect(setError).toHaveBeenCalled()
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  test('reads activeSessionId from localStorage on init', () => {
    ;(localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue('s-saved')
    const result = useSessions()
    expect(result.activeSessionId).toBe('s-saved')
  })

  test('activeSession matches session from list', () => {
    const result = useSessions()
    expect(result.activeSession).toBeUndefined()
    expect(result.sessions).toEqual([])
  })
})

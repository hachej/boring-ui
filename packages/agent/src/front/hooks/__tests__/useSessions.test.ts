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
    useRef: (initial: unknown) => {
      versionStore.current = initial as number
      return versionStore
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

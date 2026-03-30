import { describe, expect, it, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSessionState, resetSessionStore } from '../useSessionState'

describe('useSessionState', () => {
  beforeEach(() => {
    resetSessionStore()
  })

  it('activeSessionId starts as null', () => {
    const { result } = renderHook(() => useSessionState())
    expect(result.current.activeSessionId).toBe(null)
  })

  it('switchSession(id) updates activeSessionId', () => {
    const { result } = renderHook(() => useSessionState())

    // First add a session so we can switch to it
    act(() => {
      result.current.addSession({ id: 'session-1', title: 'First', lastModified: Date.now(), status: 'active' })
    })

    act(() => {
      result.current.switchSession('session-1')
    })

    expect(result.current.activeSessionId).toBe('session-1')
  })

  it('switchSession does NOT clear artifact state (Surface persists)', () => {
    const { result } = renderHook(() => useSessionState())

    // Add two sessions
    act(() => {
      result.current.addSession({ id: 'session-1', title: 'First', lastModified: Date.now(), status: 'active' })
      result.current.addSession({ id: 'session-2', title: 'Second', lastModified: Date.now(), status: 'active' })
    })

    act(() => {
      result.current.switchSession('session-1')
    })

    // switchSession is session-state only — it returns nothing artifact-related
    // and the hook shape does NOT include any artifact fields.
    // This test verifies the contract: session store only manages session pointers.
    expect(result.current.activeSessionId).toBe('session-1')
    expect(result.current).not.toHaveProperty('artifacts')
    expect(result.current).not.toHaveProperty('artifactIds')
    expect(result.current).not.toHaveProperty('openArtifacts')

    act(() => {
      result.current.switchSession('session-2')
    })

    expect(result.current.activeSessionId).toBe('session-2')
    // Still no artifact contamination
    expect(result.current).not.toHaveProperty('artifacts')
  })

  it('createNewSession() generates a new ID and sets it active', () => {
    const { result } = renderHook(() => useSessionState())

    act(() => {
      result.current.createNewSession()
    })

    expect(result.current.activeSessionId).not.toBe(null)
    expect(typeof result.current.activeSessionId).toBe('string')
    expect(result.current.activeSessionId.length).toBeGreaterThan(0)
    expect(result.current.sessions).toHaveLength(1)
    expect(result.current.sessions[0].id).toBe(result.current.activeSessionId)
  })

  it('sessions list returns sessions sorted by recency (most recent first)', () => {
    const { result } = renderHook(() => useSessionState())

    const now = Date.now()

    act(() => {
      result.current.addSession({ id: 'old', title: 'Old Session', lastModified: now - 2000, status: 'active' })
      result.current.addSession({ id: 'mid', title: 'Mid Session', lastModified: now - 1000, status: 'active' })
      result.current.addSession({ id: 'new', title: 'New Session', lastModified: now, status: 'active' })
    })

    expect(result.current.sessions).toHaveLength(3)
    expect(result.current.sessions[0].id).toBe('new')
    expect(result.current.sessions[1].id).toBe('mid')
    expect(result.current.sessions[2].id).toBe('old')
  })

  it('session list updates when a session is added', () => {
    const { result } = renderHook(() => useSessionState())

    expect(result.current.sessions).toHaveLength(0)

    act(() => {
      result.current.addSession({ id: 'session-1', title: 'First', lastModified: Date.now(), status: 'active' })
    })

    expect(result.current.sessions).toHaveLength(1)
    expect(result.current.sessions[0].id).toBe('session-1')
    expect(result.current.sessions[0].title).toBe('First')

    act(() => {
      result.current.addSession({ id: 'session-2', title: 'Second', lastModified: Date.now() + 1000, status: 'active' })
    })

    expect(result.current.sessions).toHaveLength(2)
    // Most recent first
    expect(result.current.sessions[0].id).toBe('session-2')
  })
})

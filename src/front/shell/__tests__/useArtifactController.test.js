import { describe, expect, it, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useArtifactController, resetArtifactStore } from '../useArtifactController'

/**
 * Helper to create a minimal SurfaceArtifact for testing.
 */
function makeArtifact(overrides = {}) {
  const id = overrides.id || `art-${Math.random().toString(36).slice(2, 8)}`
  return {
    id,
    canonicalKey: overrides.canonicalKey || `src/${id}.js`,
    kind: overrides.kind || 'code',
    title: overrides.title || `${id}.js`,
    source: overrides.source || 'tool',
    sourceSessionId: overrides.sourceSessionId || 'session-1',
    rendererKey: overrides.rendererKey || null,
    params: overrides.params || {},
    status: overrides.status || 'ready',
    dirty: overrides.dirty || false,
    createdAt: overrides.createdAt || Date.now(),
  }
}

describe('useArtifactController', () => {
  beforeEach(() => {
    resetArtifactStore()
  })

  it('open() adds artifact to openArtifacts and sets it active', () => {
    const { result } = renderHook(() => useArtifactController())
    const artifact = makeArtifact({ canonicalKey: 'src/auth.js', kind: 'code', title: 'auth.js' })

    act(() => {
      result.current.open(artifact)
    })

    expect(result.current.activeArtifactId).toBe(artifact.id)
    expect(result.current.orderedIds).toContain(artifact.id)
    expect(result.current.artifacts.get(artifact.id)).toEqual(artifact)
  })

  it('opening same canonicalKey twice focuses existing, does NOT duplicate', () => {
    const { result } = renderHook(() => useArtifactController())

    const art1 = makeArtifact({ id: 'art-1', canonicalKey: 'src/auth.js', title: 'auth.js' })
    const art2 = makeArtifact({ id: 'art-2', canonicalKey: 'src/auth.js', title: 'auth.js (v2)' })

    act(() => {
      result.current.open(art1)
    })

    act(() => {
      result.current.open(art2)
    })

    // Should still only have one artifact
    expect(result.current.orderedIds).toHaveLength(1)
    expect(result.current.orderedIds[0]).toBe('art-1')
    // activeArtifactId should be the original
    expect(result.current.activeArtifactId).toBe('art-1')
  })

  it('close(id) removes artifact and activates the most recently active sibling', () => {
    const { result } = renderHook(() => useArtifactController())

    const art1 = makeArtifact({ id: 'art-1', canonicalKey: 'src/a.js' })
    const art2 = makeArtifact({ id: 'art-2', canonicalKey: 'src/b.js' })
    const art3 = makeArtifact({ id: 'art-3', canonicalKey: 'src/c.js' })

    act(() => {
      result.current.open(art1)
      result.current.open(art2)
      result.current.open(art3)
    })

    // art3 is active (last opened)
    expect(result.current.activeArtifactId).toBe('art-3')

    // Close the active artifact
    act(() => {
      result.current.close('art-3')
    })

    // art3 removed, art2 should be activated (next most recent sibling)
    expect(result.current.orderedIds).not.toContain('art-3')
    expect(result.current.activeArtifactId).toBe('art-2')
  })

  it('focus(id) sets activeArtifactId without changing order', () => {
    const { result } = renderHook(() => useArtifactController())

    const art1 = makeArtifact({ id: 'art-1', canonicalKey: 'src/a.js' })
    const art2 = makeArtifact({ id: 'art-2', canonicalKey: 'src/b.js' })
    const art3 = makeArtifact({ id: 'art-3', canonicalKey: 'src/c.js' })

    act(() => {
      result.current.open(art1)
      result.current.open(art2)
      result.current.open(art3)
    })

    const orderBefore = [...result.current.orderedIds]

    act(() => {
      result.current.focus('art-1')
    })

    expect(result.current.activeArtifactId).toBe('art-1')
    expect(result.current.orderedIds).toEqual(orderBefore) // order unchanged
  })

  it('openArtifacts maintains insertion order', () => {
    const { result } = renderHook(() => useArtifactController())

    const art1 = makeArtifact({ id: 'art-1', canonicalKey: 'src/a.js' })
    const art2 = makeArtifact({ id: 'art-2', canonicalKey: 'src/b.js' })
    const art3 = makeArtifact({ id: 'art-3', canonicalKey: 'src/c.js' })

    act(() => {
      result.current.open(art1)
      result.current.open(art2)
      result.current.open(art3)
    })

    expect(result.current.orderedIds).toEqual(['art-1', 'art-2', 'art-3'])
  })

  it('closing the last artifact sets activeArtifactId to null', () => {
    const { result } = renderHook(() => useArtifactController())

    const art = makeArtifact({ id: 'only', canonicalKey: 'src/only.js' })

    act(() => {
      result.current.open(art)
    })

    expect(result.current.activeArtifactId).toBe('only')

    act(() => {
      result.current.close('only')
    })

    expect(result.current.activeArtifactId).toBe(null)
    expect(result.current.orderedIds).toHaveLength(0)
  })

  it('surfaceOpen becomes true when first artifact opens', () => {
    const { result } = renderHook(() => useArtifactController())

    expect(result.current.surfaceOpen).toBe(false)

    const art = makeArtifact({ id: 'first', canonicalKey: 'src/first.js' })

    act(() => {
      result.current.open(art)
    })

    expect(result.current.surfaceOpen).toBe(true)
  })

  it('surfaceOpen becomes false when last artifact closes', () => {
    const { result } = renderHook(() => useArtifactController())

    const art1 = makeArtifact({ id: 'art-1', canonicalKey: 'src/a.js' })
    const art2 = makeArtifact({ id: 'art-2', canonicalKey: 'src/b.js' })

    act(() => {
      result.current.open(art1)
      result.current.open(art2)
    })

    expect(result.current.surfaceOpen).toBe(true)

    act(() => {
      result.current.close('art-2')
    })

    // Still one artifact open
    expect(result.current.surfaceOpen).toBe(true)

    act(() => {
      result.current.close('art-1')
    })

    // All artifacts closed
    expect(result.current.surfaceOpen).toBe(false)
  })
})

// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import {
  currentFrontendEntry,
  shouldReloadForFrontendEntry,
} from '../vitePreloadRecovery.js'

describe('vite preload recovery', () => {
  it('uses the hashed built app entry to scope reload attempts', () => {
    document.head.innerHTML = ''
    const preload = document.createElement('script')
    preload.type = 'module'
    preload.src = 'https://example.test/assets/index-new.js'
    document.head.appendChild(preload)

    const other = document.createElement('script')
    other.type = 'module'
    other.src = 'https://example.test/runtime-plugin.js'
    document.head.appendChild(other)

    expect(currentFrontendEntry(document, 'fallback')).toBe('https://example.test/assets/index-new.js')
  })

  it('allows one reload per built app entry', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value)
      }),
    }

    expect(shouldReloadForFrontendEntry(storage, 'entry-a')).toBe(true)
    expect(shouldReloadForFrontendEntry(storage, 'entry-a')).toBe(false)
    expect(shouldReloadForFrontendEntry(storage, 'entry-b')).toBe(true)
  })
})

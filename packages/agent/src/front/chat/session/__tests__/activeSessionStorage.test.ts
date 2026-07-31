import { describe, expect, test, vi } from 'vitest'
import {
  activeSessionStorageKey,
  bootResumeSessionStorageKey,
  clearActiveSessionId,
  readActiveSessionId,
  readBootResumeSessionId,
  writeActiveSessionId,
  writeBootResumeSessionId,
  type ActiveSessionStorageLike,
} from '../activeSessionStorage'

function memoryStorage(): ActiveSessionStorageLike & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value) }),
    removeItem: vi.fn((key: string) => { values.delete(key) }),
  }
}

describe('activeSessionStorage', () => {
  test('uses scoped v2 active-session keys without legacy transcript storage', () => {
    expect(activeSessionStorageKey('workspace-a:user-opaque')).toBe('boring-agent:v2:workspace-a:user-opaque:activeSessionId')
    expect(activeSessionStorageKey()).toBe('boring-agent:v2:default:activeSessionId')
    expect(bootResumeSessionStorageKey('workspace-a:user-opaque')).toBe('boring-agent:v2:workspace-a:user-opaque:bootResumeSessionId')
  })

  test('reads, writes, and clears only the active session id', () => {
    const storage = memoryStorage()

    writeActiveSessionId('pi-running', { storageScope: 'scope-a', storage })
    expect(storage.setItem).toHaveBeenCalledWith('boring-agent:v2:scope-a:activeSessionId', 'pi-running')
    expect(readActiveSessionId({ storageScope: 'scope-a', storage })).toBe('pi-running')

    clearActiveSessionId({ storageScope: 'scope-a', storage })
    expect(storage.removeItem).toHaveBeenCalledWith('boring-agent:v2:scope-a:activeSessionId')
    expect(readActiveSessionId({ storageScope: 'scope-a', storage })).toBeUndefined()
  })

  test('keeps boot resume ownership in its separate storage seam', () => {
    const activeStorage = memoryStorage()
    const tabStorage = memoryStorage()

    writeActiveSessionId('pi-empty', { storageScope: 'scope-a', storage: activeStorage })
    writeBootResumeSessionId('pi-empty', { storageScope: 'scope-a', storage: tabStorage })

    expect(readActiveSessionId({ storageScope: 'scope-a', storage: activeStorage })).toBe('pi-empty')
    expect(readBootResumeSessionId({ storageScope: 'scope-a', storage: tabStorage })).toBe('pi-empty')
    expect(readBootResumeSessionId({ storageScope: 'scope-a', storage: activeStorage })).toBeUndefined()
  })

  test('storage failures are non-fatal', () => {
    const storage: ActiveSessionStorageLike = {
      getItem: vi.fn(() => { throw new Error('blocked') }),
      setItem: vi.fn(() => { throw new Error('blocked') }),
      removeItem: vi.fn(() => { throw new Error('blocked') }),
    }

    expect(readActiveSessionId({ storageScope: 'scope-a', storage })).toBeUndefined()
    expect(() => writeActiveSessionId('pi-1', { storageScope: 'scope-a', storage })).not.toThrow()
    expect(() => clearActiveSessionId({ storageScope: 'scope-a', storage })).not.toThrow()
  })
})

import { describe, expect, test } from 'vitest'
import {
  RUNTIME_READONLY_FILESYSTEM_POLICY_INVALID_CODE,
  normalizeRuntimeReadonlyFilesystemPolicy,
  resolveRuntimeReadonlyFilesystemAccess,
} from '../readonlyFilesystemPolicy'

describe('normalizeRuntimeReadonlyFilesystemPolicy', () => {
  test('normalizes, deduplicates descendants, freezes, and revisions stably', () => {
    const first = normalizeRuntimeReadonlyFilesystemPolicy([
      'docs/private/child', '.agents\\nested\\', './docs/private', '.agents', 'ordinary/../shared', 'shared',
    ])
    const second = normalizeRuntimeReadonlyFilesystemPolicy(['shared', 'docs/private', '.agents'])
    expect(first.readonlyPaths).toEqual(['.agents', 'docs/private', 'shared'])
    expect(first.revision).toBe(second.revision)
    expect(Object.isFrozen(first) && Object.isFrozen(first.readonlyPaths)).toBe(true)
  })

  test.each(['', '.', '..', '../escape', '/absolute', 'C:\\absolute', 'file:resource', '\\server\\share', 'nul\0path'])
  ('rejects invalid path %j with a stable safe code', (path) => {
    try {
      normalizeRuntimeReadonlyFilesystemPolicy([path])
      throw new Error('expected policy rejection')
    } catch (error) {
      expect(error).toMatchObject({ code: RUNTIME_READONLY_FILESYSTEM_POLICY_INVALID_CODE })
      expect(error).not.toHaveProperty('path')
      if (path) expect(String(error)).not.toContain(path)
    }
  })
})

describe('resolveRuntimeReadonlyFilesystemAccess', () => {
  const policy = normalizeRuntimeReadonlyFilesystemPolicy(['.agents/private'])

  test.each([
    ['.agents/private', false], ['.agents/private/child.txt', false], ['.agents/private-old', true], ['ordinary.txt', true],
  ] as const)('uses complete path segments for %s', (path, writable) => {
    const decision = resolveRuntimeReadonlyFilesystemAccess(policy, { filesystem: 'user', normalizedPath: path })
    expect(decision.capabilities.write).toBe(writable)
    expect(decision.capabilities['create-child']).toBe(writable)
  })

  test.each(['.agents/private/', './.agents/private', '.agents//private', '.agents\\private'])
  ('normalizes resolver input %j', (path) => {
    expect(resolveRuntimeReadonlyFilesystemAccess(policy, { filesystem: 'user', normalizedPath: path }))
      .toMatchObject({ normalizedPath: '.agents/private', access: 'readonly', capabilities: { write: false } })
  })

  test('allows scheme-like relative filenames in access queries', () => {
    expect(resolveRuntimeReadonlyFilesystemAccess(policy, { filesystem: 'user', normalizedPath: 'backup:2026.tar' }))
      .toMatchObject({ normalizedPath: 'backup:2026.tar', access: 'readwrite', capabilities: { write: true } })
  })

  test.each([
    ['', { write: false, 'create-child': true, delete: false, 'move-from': false }],
    ['.agents', { write: false, 'create-child': true, delete: false, 'move-from': false }],
  ] as const)('protects readonly descendants when resolving ancestor %j', (path, expected) => {
    expect(resolveRuntimeReadonlyFilesystemAccess(policy, { filesystem: 'user', normalizedPath: path }))
      .toMatchObject({ access: 'readonly', capabilities: expected })
  })
})

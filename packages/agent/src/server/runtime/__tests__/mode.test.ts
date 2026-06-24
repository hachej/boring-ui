import { describe, expect, test, vi } from 'vitest'

import type { FileSearch } from '../../../shared/file-search'
import type { Sandbox } from '../../../shared/sandbox'
import type { Workspace } from '../../../shared/workspace'
import { getOptionalRuntimeBundleStorageRoot, getRuntimeBundleStorageRoot, type RuntimeBundle } from '../mode'

function workspace(root = '/workspace'): Workspace {
  return {
    root,
    runtimeContext: { runtimeCwd: root },
    readFile: vi.fn(async () => ''),
    writeFile: vi.fn(async () => {}),
    unlink: vi.fn(async () => {}),
    readdir: vi.fn(async () => []),
    stat: vi.fn(async () => ({ size: 0, mtimeMs: 0, kind: 'file' as const })),
    mkdir: vi.fn(async () => {}),
    rename: vi.fn(async () => {}),
  }
}

function sandbox(provider: string): Sandbox {
  return {
    id: provider,
    provider,
    placement: 'remote',
    capabilities: ['exec'],
    runtimeContext: { runtimeCwd: '/workspace' },
    exec: vi.fn(async () => ({ stdout: new Uint8Array(), stderr: new Uint8Array(), exitCode: 0, durationMs: 1, truncated: false })),
  }
}

function bundle(overrides: Partial<RuntimeBundle> = {}): RuntimeBundle {
  return {
    workspace: workspace(),
    sandbox: sandbox('custom-remote'),
    fileSearch: { search: vi.fn(async () => []) } satisfies FileSearch,
    ...overrides,
  }
}

describe('runtime mode helpers', () => {
  test('returns explicit storage root when present', () => {
    expect(getRuntimeBundleStorageRoot(bundle({ storageRoot: '/host/workspace' }))).toBe('/host/workspace')
  })

  test('returns undefined from the optional helper when no host storage root exists', () => {
    expect(getOptionalRuntimeBundleStorageRoot(bundle())).toBeUndefined()
  })

  test('throws provider-neutrally when no host storage root exists', () => {
    expect(() => getRuntimeBundleStorageRoot(bundle())).toThrow('RuntimeBundle.storageRoot is required')
  })
})

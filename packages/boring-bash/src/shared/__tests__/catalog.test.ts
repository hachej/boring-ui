import { describe, expect, it } from 'vitest'

import {
  FILESYSTEM_CATALOG_CAPABILITIES,
  isFilesystemCatalogCapabilities,
  parseFilesystemCatalog,
} from '../catalog'

const BASE_CAPABILITIES = {
  read: true,
  list: true,
  search: true,
  write: false,
  delete: false,
  move: false,
  mkdir: false,
}

function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    filesystem: 'knowledge',
    label: 'Knowledge',
    rootDir: '/knowledge',
    access: 'readonly',
    capabilities: { ...BASE_CAPABILITIES, execute: false },
    ...overrides,
  }
}

describe('filesystem catalog execute capability (gh-1123)', () => {
  it('includes execute in the capability vocabulary', () => {
    expect(FILESYSTEM_CATALOG_CAPABILITIES).toContain('execute')
  })

  it('accepts capabilities with an explicit execute boolean', () => {
    expect(isFilesystemCatalogCapabilities({ ...BASE_CAPABILITIES, execute: true })).toBe(true)
    expect(isFilesystemCatalogCapabilities({ ...BASE_CAPABILITIES, execute: false })).toBe(true)
  })

  it('tolerates payloads predating execute, defaulting it to false', () => {
    expect(isFilesystemCatalogCapabilities(BASE_CAPABILITIES)).toBe(true)

    const parsed = parseFilesystemCatalog({
      filesystems: [entry({ capabilities: BASE_CAPABILITIES })],
    })
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.capabilities.execute).toBe(false)
  })

  it('parses an explicit execute grant through', () => {
    const parsed = parseFilesystemCatalog({
      filesystems: [entry({ capabilities: { ...BASE_CAPABILITIES, execute: true } })],
    })
    expect(parsed[0]?.capabilities.execute).toBe(true)
  })

  it('still rejects non-boolean execute values', () => {
    expect(isFilesystemCatalogCapabilities({ ...BASE_CAPABILITIES, execute: 'yes' })).toBe(false)
  })
})

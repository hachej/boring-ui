import { describe, expect, test } from 'vitest'

import { DEFAULT_IGNORED_DIR_NAMES, isIgnoredDirName } from '../ignore'

describe('isIgnoredDirName', () => {
  test('matches every default ignored name', () => {
    for (const name of DEFAULT_IGNORED_DIR_NAMES) {
      expect(isIgnoredDirName(name)).toBe(true)
    }
  })

  test('matches heavy directories that amplify on multi-worktree repos', () => {
    expect(isIgnoredDirName('node_modules')).toBe(true)
    expect(isIgnoredDirName('.worktrees')).toBe(true)
    expect(isIgnoredDirName('.git')).toBe(true)
    expect(isIgnoredDirName('dist')).toBe(true)
  })

  test('matches any .tsbuildinfo file', () => {
    expect(isIgnoredDirName('tsconfig.tsbuildinfo')).toBe(true)
    expect(isIgnoredDirName('packages.tsbuildinfo')).toBe(true)
  })

  test('does not match ordinary source names', () => {
    expect(isIgnoredDirName('src')).toBe(false)
    expect(isIgnoredDirName('packages')).toBe(false)
    expect(isIgnoredDirName('README.md')).toBe(false)
    expect(isIgnoredDirName('index.ts')).toBe(false)
    expect(isIgnoredDirName('my-node_modules')).toBe(false)
    expect(isIgnoredDirName('distribution')).toBe(false)
  })
})

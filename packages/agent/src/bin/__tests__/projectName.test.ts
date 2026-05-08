import { describe, expect, test } from 'vitest'

import { projectNameFromWorkspaceRoot } from '../projectName'

describe('projectNameFromWorkspaceRoot', () => {
  test('uses the current workspace folder basename', () => {
    expect(projectNameFromWorkspaceRoot('/Users/alice/work/my-app')).toBe('my-app')
  })

  test('uses the explicit --workspace folder basename even when relative', () => {
    expect(projectNameFromWorkspaceRoot('fixtures/macro-project')).toBe('macro-project')
  })

  test('falls back for filesystem roots with no basename', () => {
    expect(projectNameFromWorkspaceRoot('/')).toBe('workspace')
  })
})

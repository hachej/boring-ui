import assert from 'node:assert/strict'
import test from 'node:test'

import { categorize, isDefaultSankeyCategory } from './present-pr-files.mjs'

test('classifies every excluded test and docs path convention', () => {
  const cases = [
    ['src/__tests__/feature.ts', 'test'],
    ['src/feature.test.tsx', 'test'],
    ['src/feature.spec.mjs', 'test'],
    ['e2e/feature.ts', 'test'],
    ['docs/architecture/flow.ts', 'docs'],
    ['notes/change.md', 'docs'],
    ['README', 'docs'],
    ['packages/widget/README.generated', 'docs'],
  ]

  for (const [path, expected] of cases) assert.equal(categorize(path), expected, path)
})

test('defaults the Sankey to non-test, non-doc branches only', () => {
  assert.equal(isDefaultSankeyCategory('prod'), true)
  assert.equal(isDefaultSankeyCategory('config'), true)
  assert.equal(isDefaultSankeyCategory('generated'), true)
  assert.equal(isDefaultSankeyCategory('test'), false)
  assert.equal(isDefaultSankeyCategory('docs'), false)
})

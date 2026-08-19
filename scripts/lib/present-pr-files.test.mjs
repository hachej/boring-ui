import assert from 'node:assert/strict'
import test from 'node:test'

import { categorize, createSankeyRows, filterSankeyRows, isDefaultSankeyCategory } from './present-pr-files.mjs'

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

test('the Sankey view model toggles supplemental rows without removing them from its dataset', () => {
  const files = ['prod', 'test', 'docs'].map((cat, index) => ({
    index,
    path: `${cat}/file-${index}.ts`,
    cat,
    area: cat,
    pkg: cat,
    additions: 1,
    deletions: 0,
    rank: index + 1,
  }))
  const rows = createSankeyRows(files)
  const enabled = { prod: true, test: true, docs: true }

  assert.equal(rows.length, 3)
  assert.deepEqual(filterSankeyRows(rows, enabled).map((row) => row.cat), ['prod'])
  assert.deepEqual(filterSankeyRows(rows, enabled, true).map((row) => row.cat), ['prod', 'test', 'docs'])
  assert.deepEqual(filterSankeyRows(rows.slice(1), enabled), [])
  assert.deepEqual(filterSankeyRows(rows, { ...enabled, test: false }, true).map((row) => row.cat), ['prod', 'docs'])
})

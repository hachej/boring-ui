import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { test, expect } from 'vitest'

const packageRoot = path.resolve(__dirname, '..', '..')
const repoRoot = path.resolve(packageRoot, '..', '..')
const scriptPath = path.resolve(repoRoot, 'scripts', 'check-invariants.sh')

test('invariant checker passes against the package source tree', () => {
  expect(() =>
    execFileSync('bash', [scriptPath, packageRoot], {
      encoding: 'utf-8',
    }),
  ).not.toThrow()
})

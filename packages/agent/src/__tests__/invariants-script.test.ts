import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { test, expect } from 'vitest'

const packageRoot = path.resolve(__dirname, '..', '..')
const repoRoot = path.resolve(packageRoot, '..', '..')
const scriptPath = path.resolve(repoRoot, 'scripts', 'check-invariants.sh')
const fixturesRoot = path.resolve(packageRoot, 'test-fixtures')

const badFixtures = [
  'invariants-bad/no-node-import-shared',
  'invariants-bad/no-buffer-shared',
  'invariants-bad/no-node-import-routes-catalog',
  'invariants-bad/no-front-server-bleed',
  'invariants-bad/no-console-server',
  'invariants-bad/no-process-env-server',
  'invariants-bad/no-hardcoded-colors',
  'invariants-bad/no-raw-error-codes',
]

test('good fixtures pass invariant checks', () => {
  const target = path.resolve(fixturesRoot, 'invariants-good')
  expect(() =>
    execFileSync('bash', [scriptPath, target], {
      encoding: 'utf-8',
    }),
  ).not.toThrow()
})

for (const fixture of badFixtures) {
  test(`bad fixture fails invariant checks: ${fixture}`, () => {
    const target = path.resolve(fixturesRoot, fixture)

    expect(() =>
      execFileSync('bash', [scriptPath, target], {
        encoding: 'utf-8',
      }),
    ).toThrow()
  })
}

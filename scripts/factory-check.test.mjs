import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { checkManifest, classifySeatStatus } from './factory-check.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')
const scriptPath = resolve(scriptDir, 'factory-check.mjs')
const tsxBin = resolve(repoRoot, 'node_modules/.bin/tsx')

function runFactoryCheck(definitionId, extraArgs = []) {
  const args = [scriptPath, ...(definitionId ? [definitionId] : []), '--json', ...extraArgs]
  const result = spawnSync(tsxBin, args, { cwd: repoRoot, encoding: 'utf8' })
  let report
  try {
    report = JSON.parse(result.stdout)
  } catch {
    report = null
  }
  return { ...result, report }
}

test('a real seated definition (boring-worker) reports SEATED and a resolved model tier', () => {
  const { status, report } = runFactoryCheck('boring-worker')
  assert.ok(report, 'expected JSON report')
  assert.equal(report.ok, true, JSON.stringify(report, null, 2))
  assert.equal(status, 0)
  const byName = Object.fromEntries(report.checks.map((c) => [c.name, c]))
  assert.match(byName['seat-status'].detail, /SEATED as "worker"/)
  assert.match(byName['model-policy'].detail, /tier T3/)
})

test('a discovered-but-unseated definition is a PASS state', () => {
  const result = classifySeatStatus({
    seatName: undefined,
    composed: false,
    hasUnseatedMarker: true,
    realFailureCount: 0,
  })
  assert.equal(result.ok, true)
  assert.match(result.detail, /DISCOVERED-BUT-UNSEATED.*PASS/)
})

test('an unknown definitionId FAILs with a clear reason and non-zero exit', () => {
  const { status, report } = runFactoryCheck('boring-totally-made-up-id')
  assert.ok(report, 'expected JSON report')
  assert.equal(report.ok, false)
  assert.notEqual(status, 0)
  const byName = Object.fromEntries(report.checks.map((c) => [c.name, c]))
  assert.equal(byName.manifest.ok, false)
  assert.match(byName.manifest.detail, /no \.agents\/personas.*declares/)
  assert.equal(byName['seat-status'].ok, false)
})

test('missing definitionId argument FAILs with a usage message', () => {
  const { status, report } = runFactoryCheck(undefined)
  assert.ok(report)
  assert.equal(report.ok, false)
  assert.notEqual(status, 0)
  assert.match(report.checks[0].detail, /usage: pnpm factory:check/)
})

test('a manifest missing definitionId fails validation', async () => {
  const fixtureDir = await mkdtemp(join(tmpdir(), 'factory-check-missing-definition-'))
  try {
    await writeFile(
      join(fixtureDir, 'package.json'),
      JSON.stringify({
        name: '@hachej/boring-persona-broken-fixture-test',
        boring: {
          agent: {
            version: '1.0.0',
            label: 'Broken Fixture',
            instructionsRef: 'instructions.md',
          },
        },
        pi: { skills: [] },
      }, null, 2),
    )
    await writeFile(join(fixtureDir, 'instructions.md'), 'placeholder instructions for the broken fixture.\n')
    const result = await checkManifest(fixtureDir)
    assert.equal(result.ok, false)
    assert.match(result.errors.join('; '), /boring\.agent\.definitionId must be a non-empty string/)
  } finally {
    await rm(fixtureDir, { recursive: true, force: true })
  }
})

test('a broken fixture package with invalid JSON FAILs on manifest', async () => {
  const fixtureDir = await mkdtemp(join(tmpdir(), 'factory-check-bad-json-'))
  try {
    await writeFile(join(fixtureDir, 'package.json'), '{ not valid json')
    const result = await checkManifest(fixtureDir)
    assert.equal(result.ok, false)
    assert.match(result.errors.join('; '), /package\.json is not valid JSON/)
  } finally {
    await rm(fixtureDir, { recursive: true, force: true })
  }
})

test('a manifest missing pi.skills fails validation', async () => {
  const fixtureDir = await mkdtemp(join(tmpdir(), 'factory-check-missing-skills-'))
  try {
    await writeFile(
      join(fixtureDir, 'package.json'),
      JSON.stringify({
        boring: {
          agent: {
            definitionId: 'boring-missing-skills-fixture',
            version: '1.0.0',
            label: 'Missing Skills Fixture',
            instructionsRef: 'instructions.md',
          },
        },
      }),
    )
    await writeFile(join(fixtureDir, 'instructions.md'), 'fixture instructions\n')
    const result = await checkManifest(fixtureDir)
    assert.equal(result.ok, false)
    assert.match(result.errors.join('; '), /pi\.skills must be an array of strings/)
  } finally {
    await rm(fixtureDir, { recursive: true, force: true })
  }
})

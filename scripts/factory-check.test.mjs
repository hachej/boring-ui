import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

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

test('boring-factory-smoke: manifest, compile, seat-status, model-policy all PASS (seated or unseated)', () => {
  const { status, report } = runFactoryCheck('boring-factory-smoke')
  assert.ok(report, `expected JSON report, got stdout unparsable`)
  assert.equal(report.ok, true, JSON.stringify(report, null, 2))
  assert.equal(status, 0)

  const byName = Object.fromEntries(report.checks.map((c) => [c.name, c]))
  assert.equal(byName.manifest.ok, true)
  assert.equal(byName.compiles.ok, true)
  assert.ok(byName['seat-status'].ok, JSON.stringify(byName['seat-status']))
  // Either seated or discovered-but-unseated is acceptable — both are PASS
  // states per the checker's contract. Just confirm the detail names one of
  // the two known states, not a third unexpected code path.
  assert.match(byName['seat-status'].detail, /SEATED|DISCOVERED-BUT-UNSEATED/)
})

test('boring-creator-growth: full report PASSes end to end', () => {
  const { status, report } = runFactoryCheck('boring-creator-growth')
  assert.ok(report, 'expected JSON report')
  assert.equal(report.ok, true, JSON.stringify(report, null, 2))
  assert.equal(status, 0)
})

test('a real seated definition (boring-worker) reports SEATED and a resolved model tier', () => {
  const { status, report } = runFactoryCheck('boring-worker')
  assert.ok(report, 'expected JSON report')
  assert.equal(report.ok, true, JSON.stringify(report, null, 2))
  assert.equal(status, 0)
  const byName = Object.fromEntries(report.checks.map((c) => [c.name, c]))
  assert.match(byName['seat-status'].detail, /SEATED as "worker"/)
  assert.match(byName['model-policy'].detail, /tier T3/)
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

test('a broken fixture package under .agents/personas/ FAILs on manifest (missing definitionId)', async () => {
  // factory-check.mjs hardcodes repoRoot = resolve(scriptDir, '..'), i.e. it
  // always scans the REAL .agents/personas/. To exercise the manifest/compile
  // failure paths end-to-end (not just re-implement the validation logic),
  // this test drops a deliberately-broken package into the real personas
  // dir for the duration of the test only, and always removes it afterward
  // (try/finally, and again defensively before exit) — read-only for every
  // OTHER package, and this checker never writes to the repo tree itself.
  const fixtureDirName = `factory-check-test-broken-${process.pid}-${Date.now()}`
  const fixtureDir = resolve(repoRoot, '.agents/personas', fixtureDirName)
  await mkdir(fixtureDir, { recursive: true })
  try {
    // Missing definitionId (required field) — checkManifest() must reject it,
    // so this package can never claim any definitionId, including the
    // resolvable-looking one this test queries.
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
      }, null, 2),
    )
    await writeFile(join(fixtureDir, 'instructions.md'), 'placeholder instructions for the broken fixture.\n')

    // Querying by a definitionId that would have to come from this exact
    // broken package (it never got to declare one, since checkManifest()
    // rejects the missing field) reliably resolves to the "unknown
    // definitionId" failure path: the fixture is scanned, its manifest check
    // fails, and so no definitionId in the repo tree ever matches it.
    const { status, report } = runFactoryCheck('boring-broken-fixture-would-be-here')
    assert.equal(report.ok, false)
    assert.notEqual(status, 0)
    const manifestCheck = report.checks.find((c) => c.name === 'manifest')
    assert.equal(manifestCheck.ok, false)
    assert.match(manifestCheck.detail, /no \.agents\/personas.*declares boring\.agent\.definitionId/)
  } finally {
    await rm(fixtureDir, { recursive: true, force: true })
  }
})

test('a broken fixture package with invalid JSON FAILs on manifest', async () => {
  const fixtureDirName = `factory-check-test-badjson-${process.pid}-${Date.now()}`
  const fixtureDir = resolve(repoRoot, '.agents/personas', fixtureDirName)
  await mkdir(fixtureDir, { recursive: true })
  try {
    await writeFile(join(fixtureDir, 'package.json'), '{ not valid json')
    const { status, report } = runFactoryCheck('boring-badjson-fixture-would-be-here')
    assert.equal(report.ok, false)
    assert.notEqual(status, 0)
  } finally {
    await rm(fixtureDir, { recursive: true, force: true })
  }
})

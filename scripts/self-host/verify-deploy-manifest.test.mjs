import test from 'node:test'
import assert from 'node:assert/strict'
import { validateDeployManifest } from './verify-deploy-manifest.mjs'

const validManifest = {
  schemaVersion: 2,
  repository: 'hachej/boring-ui',
  ref: 'refs/tags/prod-2026-06-21-001',
  tag: 'prod-2026-06-21-001',
  commit: '0123456789abcdef0123456789abcdef01234567',
  workflow: 'Self-host full-app image',
  workflowRunId: '1234567890',
  image: 'ghcr.io/hachej/boring-ui-full-app',
  digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  target: 'web-runtime',
  role: 'web',
  migration: {
    classification: 'none',
    rollbackCompatible: true,
    migrationSetDigest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    currentEpoch: 20,
  },
}

const options = {
  repository: 'hachej/boring-ui',
  image: 'ghcr.io/hachej/boring-ui-full-app',
  workflow: 'Self-host full-app image',
}

test('accepts a valid v2 deploy manifest and returns migration evidence', () => {
  const result = validateDeployManifest(validManifest, options)
  assert.equal(result.ok, true)
  assert.equal(result.digest, validManifest.digest)
  assert.equal(result.migrationSetDigest, validManifest.migration.migrationSetDigest)
  assert.equal(result.currentEpoch, validManifest.migration.currentEpoch)
})

test('accepts a standalone v3 manifest without agent-host migration evidence', () => {
  const { migration: _migration, ...base } = validManifest
  const manifest = { ...base, schemaVersion: 3, mode: 'standalone-app' }
  const result = validateDeployManifest(manifest, options)
  assert.equal(result.ok, true)
  assert.equal(result.mode, 'standalone-app')
  assert.equal('migrationSetDigest' in result, false)
  assert.equal('currentEpoch' in result, false)
})

test('rejects invalid or agent-host-coupled standalone v3 manifests', () => {
  const { migration: _migration, ...base } = validManifest
  const wrongMode = validateDeployManifest({ ...base, schemaVersion: 3, mode: 'agent-host' }, options)
  assert.equal(wrongMode.ok, false)
  assert.match(wrongMode.errors.join('\n'), /mode must be standalone-app/)

  const coupled = validateDeployManifest({
    ...base,
    schemaVersion: 3,
    mode: 'standalone-app',
    migration: validManifest.migration,
  }, options)
  assert.equal(coupled.ok, false)
  assert.match(coupled.errors.join('\n'), /must not contain agent-host migration evidence/)
})

test('accepts the pre-v1 no-live-authority schema namespace clean break as rollback-incompatible', () => {
  const manifest = {
    ...validManifest,
    migration: {
      ...validManifest.migration,
      classification: 'schema-namespace-rename-pre-v1-no-live-authority',
      rollbackCompatible: false,
      currentEpoch: 23,
    },
  }
  const result = validateDeployManifest(manifest, options)
  assert.equal(result.ok, true)
  assert.equal(result.currentEpoch, 23)
})

test('rejects a rollback-incompatible migration without the exact clean-break premise', () => {
  const result = validateDeployManifest({
    ...validManifest,
    migration: { ...validManifest.migration, classification: 'schema-namespace-rename', rollbackCompatible: false },
  }, options)
  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /pre-v1 no-live-authority schema namespace clean break/)
})

test('retains the v1 manifest contract without requiring migration evidence', () => {
  const manifest = {
    ...validManifest,
    schemaVersion: 1,
    migration: { classification: 'none', rollbackCompatible: true },
  }
  const result = validateDeployManifest(manifest, options)
  assert.equal(result.ok, true)
  assert.equal('migrationSetDigest' in result, false)
  assert.equal('currentEpoch' in result, false)

  const cleanBreak = validateDeployManifest({
    ...manifest,
    migration: {
      classification: 'schema-namespace-rename-pre-v1-no-live-authority',
      rollbackCompatible: false,
    },
  }, options)
  assert.equal(cleanBreak.ok, false)
})

test('rejects non-prod tags and mismatched refs', () => {
  const result = validateDeployManifest(
    { ...validManifest, tag: 'latest', ref: 'refs/heads/main' },
    options,
  )
  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /tag must match prod-/)
  assert.match(result.errors.join('\n'), /ref must equal/)
})

test('rejects repository image and digest mismatches', () => {
  const result = validateDeployManifest(
    {
      ...validManifest,
      repository: 'attacker/repo',
      image: 'ghcr.io/attacker/boring-ui-full-app',
      digest: 'sha256:not-a-digest',
    },
    options,
  )
  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /repository mismatch/)
  assert.match(result.errors.join('\n'), /image mismatch/)
  assert.match(result.errors.join('\n'), /digest must be a sha256 digest/)
})

test('rejects unsafe target role or v2 migration policy', () => {
  const result = validateDeployManifest(
    {
      ...validManifest,
      target: 'worker-runtime',
      role: 'worker',
      migration: { classification: '', rollbackCompatible: false, migrationSetDigest: 'not-a-digest', currentEpoch: -1 },
    },
    options,
  )
  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /target must be web-runtime/)
  assert.match(result.errors.join('\n'), /role must be web/)
  assert.match(result.errors.join('\n'), /rollbackCompatible must be true/)
  assert.match(result.errors.join('\n'), /classification must be a non-empty string/)
  assert.match(result.errors.join('\n'), /migrationSetDigest must be a sha256 digest/)
  assert.match(result.errors.join('\n'), /currentEpoch must be a non-negative safe integer/)
})

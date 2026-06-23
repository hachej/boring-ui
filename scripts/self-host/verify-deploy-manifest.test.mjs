import test from 'node:test'
import assert from 'node:assert/strict'
import { validateDeployManifest } from './verify-deploy-manifest.mjs'

const validManifest = {
  schemaVersion: 1,
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
  },
}

const options = {
  repository: 'hachej/boring-ui',
  image: 'ghcr.io/hachej/boring-ui-full-app',
  workflow: 'Self-host full-app image',
}

test('accepts a valid deploy manifest', () => {
  const result = validateDeployManifest(validManifest, options)
  assert.equal(result.ok, true)
  assert.equal(result.digest, validManifest.digest)
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

test('rejects unsafe target role or migration policy', () => {
  const result = validateDeployManifest(
    {
      ...validManifest,
      target: 'worker-runtime',
      role: 'worker',
      migration: { classification: '', rollbackCompatible: false },
    },
    options,
  )
  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /target must be web-runtime/)
  assert.match(result.errors.join('\n'), /role must be web/)
  assert.match(result.errors.join('\n'), /rollbackCompatible must be true/)
  assert.match(result.errors.join('\n'), /classification must be a non-empty string/)
})

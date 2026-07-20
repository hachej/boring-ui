import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, test } from 'vitest'

import { getBoringAgentRuntimePaths } from '@agent-test-host'
import {
  createNodeRuntimeFingerprint,
  createPythonRuntimeFingerprint,
  createRuntimeFingerprint,
  readFingerprint,
  shouldInstallRuntime,
  writeFingerprint,
  writeFingerprintAfterSuccessfulInstall,
} from '../fingerprint'

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'boring-agent-fingerprint-'))
}

test('runtime fingerprint hashing is stable for object key order', () => {
  const one = createRuntimeFingerprint({ b: 2, a: { d: 4, c: 3 } })
  const two = createRuntimeFingerprint({ a: { c: 3, d: 4 }, b: 2 })

  expect(one).toMatch(/^sha256:[a-f0-9]{64}$/)
  expect(two).toBe(one)
})

test('matching fingerprint still reinstalls when an expected output is missing', async () => {
  const root = await tempRoot()
  const paths = getBoringAgentRuntimePaths(root)
  const fingerprintPath = join(paths.node, '.fingerprint')
  const fingerprint = createRuntimeFingerprint({ packages: ['cli'] })

  await writeFingerprint(fingerprintPath, fingerprint)

  await expect(shouldInstallRuntime({
    fingerprintPath,
    desiredFingerprint: fingerprint,
    expectedOutputs: [join(paths.nodeBin, 'boring-ui')],
  })).resolves.toBe(true)
})

test('matching fingerprint and present outputs skip install', async () => {
  const root = await tempRoot()
  const paths = getBoringAgentRuntimePaths(root)
  const fingerprintPath = join(paths.node, '.fingerprint')
  const expectedBin = join(paths.nodeBin, 'boring-ui')
  const fingerprint = createRuntimeFingerprint({ packages: ['cli'] })

  await writeFingerprint(fingerprintPath, fingerprint)
  await mkdir(paths.nodeBin, { recursive: true })
  await writeFile(expectedBin, '#!/usr/bin/env node\n', { flag: 'w' })

  await expect(shouldInstallRuntime({
    fingerprintPath,
    desiredFingerprint: fingerprint,
    expectedOutputs: [expectedBin],
  })).resolves.toBe(false)
})

test('invalid fingerprint text is treated as missing', async () => {
  const root = await tempRoot()
  const paths = getBoringAgentRuntimePaths(root)
  const fingerprintPath = join(paths.venv, '.fingerprint')

  await mkdir(paths.venv, { recursive: true })
  await writeFile(fingerprintPath, 'not-a-valid-fingerprint\n', { flag: 'w' })

  await expect(readFingerprint(fingerprintPath)).resolves.toBeNull()
  await expect(shouldInstallRuntime({
    fingerprintPath,
    desiredFingerprint: createRuntimeFingerprint({ packages: ['macro'] }),
    expectedOutputs: [],
  })).resolves.toBe(true)
})

test('node runtime fingerprint changes when node, npm, package source, or version changes', () => {
  const base = {
    nodeVersion: 'v20.11.0',
    npmVersion: '10.2.4',
    packages: [{
      id: 'cli',
      packageName: '@hachej/boring-ui-cli',
      packageRoot: new URL('file:///tmp/boring cli/'),
      version: '1.0.0',
      expectedBins: ['boring-ui'],
    }],
  }

  const fingerprint = createNodeRuntimeFingerprint(base)

  expect(createNodeRuntimeFingerprint({ ...base, nodeVersion: 'v20.12.0' })).not.toBe(fingerprint)
  expect(createNodeRuntimeFingerprint({ ...base, npmVersion: '10.5.0' })).not.toBe(fingerprint)
  expect(createNodeRuntimeFingerprint({
    ...base,
    packages: [{ ...base.packages[0], packageRoot: '/tmp/other cli' }],
  })).not.toBe(fingerprint)
  expect(createNodeRuntimeFingerprint({
    ...base,
    packages: [{ ...base.packages[0], version: '1.0.1' }],
  })).not.toBe(fingerprint)
})

test('python runtime fingerprint changes when python, uv, extraLibs, source, or version changes', () => {
  const base = {
    pythonVersion: 'Python 3.12.1',
    uvVersion: 'uv 0.5.0',
    packages: [{
      id: 'macro-sdk',
      packageName: 'boring-macro-sdk',
      projectFile: new URL('file:///tmp/macro sdk/pyproject.toml'),
      packageRoot: new URL('file:///tmp/macro sdk/'),
      version: '0.1.0',
      extraLibs: ['pandas==2.2.3'],
      env: { BORING_MACRO_API_URL: 'http://localhost:3000' },
      expectedBins: ['bm'],
    }],
  }

  const fingerprint = createPythonRuntimeFingerprint(base)

  expect(createPythonRuntimeFingerprint({ ...base, pythonVersion: 'Python 3.12.2' })).not.toBe(fingerprint)
  expect(createPythonRuntimeFingerprint({ ...base, uvVersion: 'uv 0.5.1' })).not.toBe(fingerprint)
  expect(createPythonRuntimeFingerprint({
    ...base,
    packages: [{ ...base.packages[0], extraLibs: ['pandas==2.2.3', 'duckdb==1.1.3'] }],
  })).not.toBe(fingerprint)
  expect(createPythonRuntimeFingerprint({
    ...base,
    packages: [{ ...base.packages[0], packageRoot: '/tmp/other macro sdk' }],
  })).not.toBe(fingerprint)
  expect(createPythonRuntimeFingerprint({
    ...base,
    packages: [{ ...base.packages[0], version: '0.1.1' }],
  })).not.toBe(fingerprint)
})

test('fingerprint is written only after successful install callback', async () => {
  const root = await tempRoot()
  const paths = getBoringAgentRuntimePaths(root)
  const fingerprintPath = join(paths.node, '.fingerprint')
  const fingerprint = createRuntimeFingerprint({ packages: ['cli'] })

  await expect(writeFingerprintAfterSuccessfulInstall({
    fingerprintPath,
    fingerprint,
    install: async () => {
      throw new Error('install failed')
    },
  })).rejects.toThrow('install failed')

  await expect(readFingerprint(fingerprintPath)).resolves.toBeNull()

  await writeFingerprintAfterSuccessfulInstall({
    fingerprintPath,
    fingerprint,
    install: async () => {},
  })

  await expect(readFile(fingerprintPath, 'utf8')).resolves.toBe(`${fingerprint}\n`)
})

test('fingerprint helpers only use runtime-local fingerprint files, not root state files', async () => {
  const root = await tempRoot()
  const paths = getBoringAgentRuntimePaths(root)

  expect(join(paths.node, '.fingerprint')).toContain('.boring-agent/node/.fingerprint')
  expect(join(paths.venv, '.fingerprint')).toContain('.boring-agent/venv/.fingerprint')
  expect(Object.values(paths).join('\n')).not.toContain('.boring-agent/state')
})

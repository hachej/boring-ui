import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'

import { getEnv, restoreEnvForTest, setEnvForTest } from '../../config/env'
import {
  autoDetectMode,
  hasBwrap,
  resolveMode,
} from '../resolveMode'

const tempDirs: string[] = []
const ORIGINAL_MODE = getEnv('BORING_AGENT_MODE')
const ORIGINAL_VERCEL_OIDC_TOKEN = getEnv('VERCEL_OIDC_TOKEN')
const ORIGINAL_VERCEL_ACCESS_TOKEN = getEnv('VERCEL_ACCESS_TOKEN')
const ORIGINAL_VERCEL_TOKEN = getEnv('VERCEL_TOKEN')
const ORIGINAL_VERCEL_TEAM_ID = getEnv('VERCEL_TEAM_ID')

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true })
    }),
  )
  restoreEnvForTest('BORING_AGENT_MODE', ORIGINAL_MODE)
  restoreEnvForTest('VERCEL_OIDC_TOKEN', ORIGINAL_VERCEL_OIDC_TOKEN)
  restoreEnvForTest('VERCEL_ACCESS_TOKEN', ORIGINAL_VERCEL_ACCESS_TOKEN)
  restoreEnvForTest('VERCEL_TOKEN', ORIGINAL_VERCEL_TOKEN)
  restoreEnvForTest('VERCEL_TEAM_ID', ORIGINAL_VERCEL_TEAM_ID)
})

async function makeContext() {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'boring-ui-runtime-mode-'))
  tempDirs.push(workspaceRoot)
  return { workspaceRoot, sessionId: 'session-1' as const }
}

test('resolveMode("direct") returns NodeWorkspace + DirectSandbox with shared substrate', async () => {
  const ctx = await makeContext()
  const bundle = await resolveMode('direct').create(ctx)

  expect(bundle.runtimeContext.runtimeCwd).toBe(ctx.workspaceRoot)
  expect(bundle.workspace.root).toBe(ctx.workspaceRoot)
  expect(bundle.workspace.runtimeContext.runtimeCwd).toBe(ctx.workspaceRoot)
  expect(bundle.sandbox.runtimeContext.runtimeCwd).toBe(ctx.workspaceRoot)
  expect(bundle.workspace.root).toBe(bundle.sandbox.runtimeContext.runtimeCwd)
  expect(bundle.sandbox.id).toBe('direct')

  await bundle.workspace.writeFile('direct.txt', 'direct-mode-ok')
  const result = await bundle.sandbox.exec('cat direct.txt')

  expect(Buffer.from(result.stdout).toString('utf-8')).toBe('direct-mode-ok')
  expect(result.exitCode).toBe(0)
})

test('resolveMode("local") returns NodeWorkspace + BwrapSandbox or errors gracefully when unsupported', async () => {
  const ctx = await makeContext()

  if (process.platform !== 'linux') {
    await expect(resolveMode('local').create(ctx)).rejects.toThrow(
      'local mode requires Linux',
    )
    return
  }

  if (!hasBwrap()) {
    await expect(resolveMode('local').create(ctx)).rejects.toThrow(
      'not found on PATH',
    )
    return
  }

  const bundle = await resolveMode('local').create(ctx)
  expect(bundle.runtimeContext.runtimeCwd).toBe('/workspace')
  expect(bundle.workspace.root).toBe('/workspace')
  expect(bundle.workspace.runtimeContext.runtimeCwd).toBe('/workspace')
  expect(bundle.sandbox.runtimeContext.runtimeCwd).toBe('/workspace')
  expect(bundle.workspace.root).toBe(bundle.sandbox.runtimeContext.runtimeCwd)
  expect(bundle.sandbox.id).toBe('bwrap')

  await bundle.workspace.writeFile('local.txt', 'local-mode-ok')
  const result = await bundle.sandbox.exec('cat local.txt')

  expect(Buffer.from(result.stdout).toString('utf-8')).toBe('local-mode-ok')
  expect(result.exitCode).toBe(0)
})

test('autoDetectMode honors BORING_AGENT_MODE override', () => {
  setEnvForTest('BORING_AGENT_MODE', 'direct')
  expect(autoDetectMode()).toBe('direct')

  setEnvForTest('BORING_AGENT_MODE', 'local')
  expect(autoDetectMode()).toBe('local')
})

test('autoDetectMode rejects invalid BORING_AGENT_MODE values', () => {
  setEnvForTest('BORING_AGENT_MODE', 'invalid-mode')
  expect(() => autoDetectMode()).toThrow('Invalid BORING_AGENT_MODE')
})

test('resolveMode explains that custom modes require an adapter', () => {
  expect(() => resolveMode('custom-sandbox')).toThrow('runtimeModeAdapter')
})

test('autoDetectMode defaults to linux+bwrap -> local, else direct', () => {
  setEnvForTest('BORING_AGENT_MODE', undefined)

  const expected = process.platform === 'linux' && hasBwrap()
    ? 'local'
    : 'direct'

  expect(autoDetectMode()).toBe(expected)
})

test('vercel-sandbox mode validates required env vars', async () => {
  const ctx = await makeContext()

  setEnvForTest('VERCEL_OIDC_TOKEN', undefined)
  setEnvForTest('VERCEL_ACCESS_TOKEN', undefined)
  setEnvForTest('VERCEL_TOKEN', undefined)

  await expect(resolveMode('vercel-sandbox').create(ctx)).rejects.toThrow(
    'VERCEL_OIDC_TOKEN or VERCEL_ACCESS_TOKEN or VERCEL_TOKEN is required for vercel-sandbox mode',
  )

  setEnvForTest('VERCEL_TOKEN', 'token')

  await expect(resolveMode('vercel-sandbox').create(ctx)).rejects.toThrow(
    'VERCEL_TEAM_ID is required for vercel-sandbox mode',
  )
})

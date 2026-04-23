import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'

import {
  autoDetectMode,
  hasBwrap,
  resolveMode,
} from '../resolveMode'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true })
    }),
  )
  delete process.env.BORING_AGENT_MODE
})

async function makeContext() {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'boring-ui-runtime-mode-'))
  tempDirs.push(workspaceRoot)
  return { workspaceRoot, sessionId: 'session-1' as const }
}

test('resolveMode("direct") returns NodeWorkspace + DirectSandbox with shared substrate', async () => {
  const ctx = await makeContext()
  const bundle = await resolveMode('direct').create(ctx)

  expect(bundle.workspace.root).toBe(ctx.workspaceRoot)
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
  expect(bundle.workspace.root).toBe(ctx.workspaceRoot)
  expect(bundle.sandbox.id).toBe('bwrap')

  await bundle.workspace.writeFile('local.txt', 'local-mode-ok')
  const result = await bundle.sandbox.exec('cat local.txt')

  expect(Buffer.from(result.stdout).toString('utf-8')).toBe('local-mode-ok')
  expect(result.exitCode).toBe(0)
})

test('autoDetectMode honors BORING_AGENT_MODE override', () => {
  process.env.BORING_AGENT_MODE = 'direct'
  expect(autoDetectMode()).toBe('direct')

  process.env.BORING_AGENT_MODE = 'local'
  expect(autoDetectMode()).toBe('local')
})

test('autoDetectMode rejects invalid BORING_AGENT_MODE values', () => {
  process.env.BORING_AGENT_MODE = 'invalid-mode'
  expect(() => autoDetectMode()).toThrow('Invalid BORING_AGENT_MODE')
})

test('autoDetectMode defaults to linux+bwrap -> local, else direct', () => {
  delete process.env.BORING_AGENT_MODE

  const expected = process.platform === 'linux' && hasBwrap()
    ? 'local'
    : 'direct'

  expect(autoDetectMode()).toBe(expected)
})

test('vercel-sandbox mode exists but is not available in M1', async () => {
  const ctx = await makeContext()

  await expect(resolveMode('vercel-sandbox').create(ctx)).rejects.toThrow(
    'not available in M1',
  )
})

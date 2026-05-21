import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'

import { createDirectSandbox } from '../createDirectSandbox'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true })
    }),
  )
})

async function initSandbox() {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'boring-ui-direct-sandbox-'))
  tempDirs.push(workspaceRoot)

  const runtimeContext = { runtimeCwd: workspaceRoot }
  const sandbox = createDirectSandbox({ runtimeContext })
  await sandbox.init?.({
    workspace: {
      root: runtimeContext.runtimeCwd,
      runtimeContext,
      async readFile() {
        throw new Error('not implemented in test')
      },
      async writeFile() {
        throw new Error('not implemented in test')
      },
      async unlink() {
        throw new Error('not implemented in test')
      },
      async readdir() {
        throw new Error('not implemented in test')
      },
      async stat() {
        throw new Error('not implemented in test')
      },
      async mkdir() {
        throw new Error('not implemented in test')
      },
      async rename() {
        throw new Error('not implemented in test')
      },
    },
    sessionId: 'session-1',
  })

  return { sandbox, workspaceRoot }
}

test('exec captures UTF-8 output and defaults cwd/env roots to workspace root', async () => {
  const { sandbox, workspaceRoot } = await initSandbox()

  const result = await sandbox.exec(
    'printf "%s\\n%s\\n%s" "$(pwd)" "$PWD" "$BORING_AGENT_WORKSPACE_ROOT"; printf "stderr-ok" >&2',
  )

  const [pwd, envPwd, boringRoot] = Buffer.from(result.stdout).toString('utf-8').split('\n')
  expect(pwd).toBe(workspaceRoot)
  expect(envPwd).toBe(workspaceRoot)
  expect(boringRoot).toBe(workspaceRoot)
  expect([pwd, envPwd, boringRoot]).not.toContain('/workspace')
  expect(Buffer.from(result.stderr).toString('utf-8')).toBe('stderr-ok')
  expect(result.stdoutEncoding).toBe('utf-8')
  expect(result.stderrEncoding).toBe('utf-8')
  expect(result.truncated).toBe(false)
})

test('exec enforces timeout and kill-after-grace', async () => {
  const { sandbox } = await initSandbox()

  const result = await sandbox.exec(
    `node -e "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"`,
    { timeoutMs: 100 },
  )

  expect(result.exitCode).toBe(124)
  expect(result.durationMs).toBeGreaterThanOrEqual(100)
  expect(result.durationMs).toBeLessThan(8_000)
}, 15_000)

test('exec kills process when abort signal fires', async () => {
  const { sandbox } = await initSandbox()
  const ac = new AbortController()

  const execPromise = sandbox.exec(
    `node -e "setInterval(() => {}, 1000)"`,
    { signal: ac.signal },
  )

  // Give process time to start
  await new Promise((r) => setTimeout(r, 100))
  ac.abort()

  const result = await execPromise
  expect(result.exitCode).not.toBe(0)
  expect(result.durationMs).toBeLessThan(5_000)
}, 10_000)

test('exec handles already-aborted signal', async () => {
  const { sandbox } = await initSandbox()
  const ac = new AbortController()
  ac.abort()

  const result = await sandbox.exec(
    `node -e "setInterval(() => {}, 1000)"`,
    { signal: ac.signal },
  )

  expect(result.exitCode).not.toBe(0)
  expect(result.durationMs).toBeLessThan(5_000)
}, 10_000)

test('exec caps output at maxOutputBytes and marks truncated', async () => {
  const { sandbox } = await initSandbox()

  const result = await sandbox.exec(
    `node -e "process.stdout.write('x'.repeat(5000)); process.stderr.write('y'.repeat(5000))"`,
    { maxOutputBytes: 256 },
  )

  expect(result.truncated).toBe(true)
  expect(result.stdout.length + result.stderr.length).toBeLessThanOrEqual(256)
})

test('exec forces managed env roots and appends plugin PATH after runtime bins', async () => {
  const { sandbox, workspaceRoot } = await initSandbox()

  const result = await sandbox.exec(
    'printf "%s\\n%s\\n%s\\n%s\\n%s" "$BORING_AGENT_WORKSPACE_ROOT" "$HOME" "$VIRTUAL_ENV" "$PYTHONHOME" "$PATH"',
    {
      env: {
        BORING_AGENT_WORKSPACE_ROOT: '/plugin-root',
        HOME: '/plugin-home',
        PATH: '/plugin/bin:/usr/bin',
        PYTHONHOME: '/plugin-python-home',
        VIRTUAL_ENV: '/plugin-venv',
      },
    },
  )

  const [root, home, venv, pythonHome, pathValue] = Buffer.from(result.stdout).toString('utf-8').split('\n')
  expect(root).toBe(workspaceRoot)
  expect(home).toBe(workspaceRoot)
  expect(venv).toBe(join(workspaceRoot, '.boring-agent', 'venv'))
  expect(pythonHome).toBe('')
  expect(pathValue.split(':').slice(0, 4)).toEqual([
    join(workspaceRoot, '.boring-agent', 'bin'),
    join(workspaceRoot, '.boring-agent', 'venv', 'bin'),
    '/plugin/bin',
    '/usr/bin',
  ])
})

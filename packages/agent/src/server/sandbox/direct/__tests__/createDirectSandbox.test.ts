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

  const sandbox = createDirectSandbox()
  await sandbox.init({
    workspace: {
      root: workspaceRoot,
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

test('exec captures UTF-8 output and uses workspace root as cwd', async () => {
  const { sandbox, workspaceRoot } = await initSandbox()

  const result = await sandbox.exec(
    `node -e "process.stdout.write(process.cwd()); process.stderr.write('stderr-ok')"`,
  )

  expect(Buffer.from(result.stdout).toString('utf-8')).toBe(workspaceRoot)
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

test('exec caps output at maxOutputBytes and marks truncated', async () => {
  const { sandbox } = await initSandbox()

  const result = await sandbox.exec(
    `node -e "process.stdout.write('x'.repeat(5000)); process.stderr.write('y'.repeat(5000))"`,
    { maxOutputBytes: 256 },
  )

  expect(result.truncated).toBe(true)
  expect(result.stdout.length + result.stderr.length).toBeLessThanOrEqual(256)
})

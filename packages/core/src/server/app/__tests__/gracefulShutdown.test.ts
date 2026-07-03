import { spawn, type ChildProcess } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { withTaskId } from '../../__tests__/_setup'

const TASK_ID = 'boring-ui-v2-r8u5'
const __dirname = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(__dirname, '../../../../')
const harnessPath = resolve(__dirname, 'fixtures/shutdownHarness.ts')
const tsxBin = resolve(packageRoot, 'node_modules/.bin/tsx')
const DEFAULT_BOOT_TIMEOUT_MS = 15_000
const DEFAULT_EXIT_TIMEOUT_MS = 50_000
const SHUTDOWN_GRACE_MS = 30_000

const activeChildren = new Set<ChildProcess>()

afterEach(() => {
  for (const child of activeChildren) {
    if (!child.killed) {
      child.kill('SIGKILL')
    }
  }
  activeChildren.clear()
})

function spawnHarness(mode: 'clean' | 'slow'): {
  child: ChildProcess
  readOutput: () => string
} {
  let output = ''
  const child = spawn(
    tsxBin,
    [harnessPath, mode],
    {
      cwd: packageRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  activeChildren.add(child)

  child.stdout.on('data', (chunk: Buffer | string) => {
    output += chunk.toString()
  })
  child.stderr.on('data', (chunk: Buffer | string) => {
    output += chunk.toString()
  })
  child.once('exit', () => {
    activeChildren.delete(child)
  })

  return {
    child,
    readOutput: () => output,
  }
}

async function waitForOutput(
  readOutput: () => string,
  needle: string,
  timeoutMs = DEFAULT_BOOT_TIMEOUT_MS,
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (readOutput().includes(needle)) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(
    `Timed out waiting for output "${needle}" after ${timeoutMs}ms.\nOutput:\n${readOutput()}`,
  )
}

async function waitForExit(
  child: ChildProcess,
  timeoutMs = DEFAULT_EXIT_TIMEOUT_MS,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`Child did not exit within ${timeoutMs}ms`))
    }, timeoutMs)

    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal })
    })
  })
}

describe('graceful shutdown (SIGTERM/SIGINT)', () => {
  it(
    'clean drain: exits 0 on SIGTERM and closes db pool',
    withTaskId(TASK_ID, async ({ logger, assertionPassed }) => {
      logger.info({ event: 'shutdown.test.start', mode: 'clean' })
      const { child, readOutput } = spawnHarness('clean')

      await waitForOutput(readOutput, 'ready:http://')
      logger.info({ event: 'shutdown.signal.send', signal: 'SIGTERM' })
      child.kill('SIGTERM')

      const exit = await waitForExit(child, 15_000)
      const output = readOutput()
      logger.info({
        event: 'shutdown.test.complete',
        mode: 'clean',
        exitCode: exit.code,
        exitSignal: exit.signal,
      })

      expect(exit.code).toBe(0)
      expect(exit.signal).toBeNull()
      expect(output).toContain('db-closed')
      expect(output).not.toContain('shutdown:grace-exceeded')
      assertionPassed('sigterm-clean-drain-exit-0')
    }),
    20_000,
  )

  it(
    'timeout path: exits 1 and logs shutdown:grace-exceeded after ~30s',
    withTaskId(TASK_ID, async ({ logger, assertionPassed }) => {
      logger.info({ event: 'shutdown.test.start', mode: 'slow' })
      const { child, readOutput } = spawnHarness('slow')

      await waitForOutput(readOutput, 'ready:http://')
      await waitForOutput(readOutput, 'inflight-started')

      const signalAt = Date.now()
      logger.info({ event: 'shutdown.signal.send', signal: 'SIGTERM' })
      child.kill('SIGTERM')

      const exit = await waitForExit(child, 45_000)
      const elapsedMs = Date.now() - signalAt
      const output = readOutput()
      logger.info({
        event: 'shutdown.test.complete',
        mode: 'slow',
        elapsedMs,
        exitCode: exit.code,
        exitSignal: exit.signal,
      })

      expect(exit.code).toBe(1)
      expect(exit.signal).toBeNull()
      expect(elapsedMs).toBeGreaterThanOrEqual(SHUTDOWN_GRACE_MS - 1_000)
      expect(output).toContain('shutdown:grace-exceeded')
      expect(output).toContain('db-closed')
      assertionPassed('sigterm-timeout-exit-1')
    }),
    50_000,
  )
})

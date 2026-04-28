import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'

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
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'boring-ui-stream-'))
  tempDirs.push(workspaceRoot)

  const sandbox = createDirectSandbox()
  await sandbox.init?.({
    workspace: {
      root: workspaceRoot,
      async readFile() { throw new Error('not implemented') },
      async writeFile() { throw new Error('not implemented') },
      async unlink() { throw new Error('not implemented') },
      async readdir() { throw new Error('not implemented') },
      async stat() { throw new Error('not implemented') },
      async mkdir() { throw new Error('not implemented') },
      async rename() { throw new Error('not implemented') },
    },
    sessionId: 'stream-test',
  })

  return { sandbox, workspaceRoot }
}

test('onStdout is called incrementally (at least twice for large output)', async () => {
  const { sandbox } = await initSandbox()
  const chunks: Uint8Array[] = []

  const result = await sandbox.exec(
    `node -e "for(let i=0;i<100;i++){process.stdout.write('x'.repeat(1000)+'\\n')}"`,
    { onStdout: (chunk) => chunks.push(chunk) },
  )

  expect(chunks.length).toBeGreaterThanOrEqual(2)
  expect(result.exitCode).toBe(0)
  expect(result.stdout.length).toBeGreaterThan(0)
}, 10_000)

test('buffered ExecResult.stdout matches streamed chunks concatenated', async () => {
  const { sandbox } = await initSandbox()
  const chunks: Uint8Array[] = []

  const result = await sandbox.exec(
    'for i in $(seq 1 50); do echo "line $i"; done',
    { onStdout: (chunk) => chunks.push(chunk) },
  )

  const streamedTotal = Buffer.concat(chunks.map(c => Buffer.from(c)))
  expect(Buffer.from(result.stdout).toString()).toBe(streamedTotal.toString())
}, 10_000)

test('onStderr receives stderr output', async () => {
  const { sandbox } = await initSandbox()
  const stderrChunks: Uint8Array[] = []

  const result = await sandbox.exec(
    'echo "err1" >&2; echo "err2" >&2',
    { onStderr: (chunk) => stderrChunks.push(chunk) },
  )

  expect(stderrChunks.length).toBeGreaterThanOrEqual(1)
  const stderrText = Buffer.concat(stderrChunks.map(c => Buffer.from(c))).toString()
  expect(stderrText).toContain('err1')
  expect(Buffer.from(result.stderr).toString()).toBe(stderrText)
}, 10_000)

test('maxOutputBytes truncation stops streaming callbacks', async () => {
  const { sandbox } = await initSandbox()
  const chunks: Uint8Array[] = []
  let totalStreamedBytes = 0

  const result = await sandbox.exec(
    `node -e "process.stdout.write('x'.repeat(10000))"`,
    {
      maxOutputBytes: 256,
      onStdout: (chunk) => {
        chunks.push(chunk)
        totalStreamedBytes += chunk.length
      },
    },
  )

  expect(result.truncated).toBe(true)
  expect(totalStreamedBytes).toBeLessThanOrEqual(256)
  expect(result.stdout.length).toBeLessThanOrEqual(256)
}, 10_000)

test('abort stops streaming callbacks', async () => {
  const { sandbox } = await initSandbox()
  const ac = new AbortController()
  const chunks: Uint8Array[] = []

  const execPromise = sandbox.exec(
    `node -e "setInterval(() => process.stdout.write('tick\\n'), 50)"`,
    {
      signal: ac.signal,
      onStdout: (chunk) => chunks.push(chunk),
    },
  )

  await new Promise((r) => setTimeout(r, 200))
  const chunkCountBeforeAbort = chunks.length
  ac.abort()

  await execPromise
  await new Promise((r) => setTimeout(r, 100))

  expect(chunks.length - chunkCountBeforeAbort).toBeLessThanOrEqual(2)
}, 10_000)

test('backward compat: omitting onStdout/onStderr produces identical ExecResult', async () => {
  const { sandbox } = await initSandbox()

  const result = await sandbox.exec('echo hello')

  expect(Buffer.from(result.stdout).toString().trim()).toBe('hello')
  expect(result.exitCode).toBe(0)
  expect(result.truncated).toBe(false)
}, 10_000)

import { expect, test } from 'vitest'

import type { Sandbox } from '../../../shared/sandbox'
import type { Workspace } from '../../../shared/workspace'
import { createServerFileSearch } from '../createServerFileSearch'

const encoder = new TextEncoder()

function createWorkspace(root = '/workspace-root'): Workspace {
  return {
    root,
    async readFile() {
      throw new Error('not used in test')
    },
    async writeFile() {
      throw new Error('not used in test')
    },
    async unlink() {
      throw new Error('not used in test')
    },
    async readdir() {
      throw new Error('not used in test')
    },
    async stat() {
      throw new Error('not used in test')
    },
    async mkdir() {
      throw new Error('not used in test')
    },
    async rename() {
      throw new Error('not used in test')
    },
  }
}

function createSandbox(
  execImpl: Sandbox['exec'],
): Sandbox {
  return {
    id: 'direct',
    placement: 'server',
    capabilities: ['exec'],
    async init() {},
    exec: execImpl,
  }
}

test('returns workspace-relative paths from find output', async () => {
  const sandbox = createSandbox(async () => ({
    stdout: encoder.encode('./a.ts\n./nested/b.ts\n'),
    stderr: new Uint8Array(),
    exitCode: 0,
    durationMs: 1,
    truncated: false,
    stdoutEncoding: 'utf-8',
    stderrEncoding: 'utf-8',
  }))
  const fileSearch = createServerFileSearch(createWorkspace(), sandbox)

  await expect(fileSearch.search('*.ts')).resolves.toEqual(['a.ts', 'nested/b.ts'])
})

test('shell-quotes glob and applies default limit/options', async () => {
  let receivedCmd = ''
  let receivedCwd: string | undefined
  let receivedTimeout: number | undefined
  let receivedMaxOutput: number | undefined

  const sandbox = createSandbox(async (cmd, opts) => {
    receivedCmd = cmd
    receivedCwd = opts?.cwd
    receivedTimeout = opts?.timeoutMs
    receivedMaxOutput = opts?.maxOutputBytes
    return {
      stdout: encoder.encode(''),
      stderr: new Uint8Array(),
      exitCode: 0,
      durationMs: 1,
      truncated: false,
      stdoutEncoding: 'utf-8',
      stderrEncoding: 'utf-8',
    }
  })

  const workspace = createWorkspace('/tmp/workspace')
  const fileSearch = createServerFileSearch(workspace, sandbox)
  await fileSearch.search("*'; rm -rf /")

  expect(receivedCmd).toContain('find . -maxdepth 10')
  expect(receivedCmd).toContain("-name '*'\\''; rm -rf /'")
  expect(receivedCmd).toContain('| head -n 500')
  expect(receivedCmd).not.toContain("-name *'; rm -rf /")
  expect(receivedCwd).toBe('/tmp/workspace')
  expect(receivedTimeout).toBe(5_000)
  expect(receivedMaxOutput).toBe(256_000)
})

test('normalizes limit and preserves timeout/maxOutput bounds', async () => {
  let receivedCmd = ''
  const sandbox = createSandbox(async (cmd) => {
    receivedCmd = cmd
    return {
      stdout: encoder.encode(''),
      stderr: new Uint8Array(),
      exitCode: 0,
      durationMs: 1,
      truncated: false,
      stdoutEncoding: 'utf-8',
      stderrEncoding: 'utf-8',
    }
  })
  const fileSearch = createServerFileSearch(createWorkspace(), sandbox)

  await fileSearch.search('*.log', 9_999)
  expect(receivedCmd).toContain('head -n 5000')

  await fileSearch.search('*.log', 0)
  expect(receivedCmd).toContain('head -n 500')
})

test('throws when sandbox.exec returns non-zero exit code', async () => {
  const sandbox = createSandbox(async () => ({
    stdout: new Uint8Array(),
    stderr: encoder.encode('boom'),
    exitCode: 2,
    durationMs: 5,
    truncated: false,
    stdoutEncoding: 'utf-8',
    stderrEncoding: 'utf-8',
  }))
  const fileSearch = createServerFileSearch(createWorkspace(), sandbox)

  await expect(fileSearch.search('*.txt')).rejects.toThrow(
    'file-search failed: exit 2',
  )
})

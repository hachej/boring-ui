import { expect, test } from 'vitest'

import type { Sandbox } from '../../../shared/sandbox'
import type { Workspace } from '../../../shared/workspace'
import { createServerFileSearch } from '../createServerFileSearch'

const encoder = new TextEncoder()

function createWorkspace(root = '/workspace-root'): Workspace {
  const runtimeContext = { runtimeCwd: root }
  return {
    root: runtimeContext.runtimeCwd,
    runtimeContext,
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
    provider: 'direct',
    capabilities: ['exec'],
    runtimeContext: { runtimeCwd: '/workspace-root' },
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

test('preserves meaningful leading/trailing spaces in filenames', async () => {
  const sandbox = createSandbox(async () => ({
    stdout: encoder.encode('./ leading.txt\n./trailing.txt \n'),
    stderr: new Uint8Array(),
    exitCode: 0,
    durationMs: 1,
    truncated: false,
    stdoutEncoding: 'utf-8',
    stderrEncoding: 'utf-8',
  }))
  const fileSearch = createServerFileSearch(createWorkspace(), sandbox)

  await expect(fileSearch.search('*')).resolves.toEqual([
    ' leading.txt',
    'trailing.txt ',
  ])
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
  // The injected payload contains `/` so it routes through -ipath
  // (path-shaped). Either way, the glob is single-quoted with `'`
  // → `'\''` escape so the shell can't break out of the quoted string
  // — the `;` and `rm -rf /` payload is inside the quotes, not a
  // separate command.
  expect(receivedCmd).toContain("-ipath '*'\\''; rm -rf /'")
  expect(receivedCmd).toContain('| head -n 500')
  // Unquoted (i.e. shell-interpreted) form must NOT appear.
  expect(receivedCmd).not.toContain("'; rm -rf /'  ")
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

test('uses -iname for bare basename globs', async () => {
  let cmd = ''
  const sandbox = createSandbox(async (c) => {
    cmd = c
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

  await fileSearch.search('*.ts')
  expect(cmd).toContain("-iname '*.ts'")
  expect(cmd).not.toContain('-ipath')

  await fileSearch.search('package.json')
  expect(cmd).toContain("-iname 'package.json'")
})

test('translates path-shaped globs (**/*.ts, src/foo) to -ipath', async () => {
  let cmd = ''
  const sandbox = createSandbox(async (c) => {
    cmd = c
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

  // Globstar — the LLM-default that used to silently match nothing
  // because `find -iname '**/*.ts'` only checks basenames.
  await fileSearch.search('**/*.ts')
  expect(cmd).toContain("-ipath '*/*.ts'")

  // Anchored under a directory.
  await fileSearch.search('src/**/foo.tsx')
  expect(cmd).toContain("-ipath '*src/*/foo.tsx'")

  // Plain subdir/file (no globstar) — still goes through -ipath.
  await fileSearch.search('apps/full-app/package.json')
  expect(cmd).toContain("-ipath '*apps/full-app/package.json'")
})

test('search command is bounded to the workspace root', async () => {
  // Three properties together keep the search inside the workspace:
  //   1. cwd: workspace.root → find starts there, never ascends
  //   2. `find . ...` → relative cwd, no traversal upward
  //   3. -maxdepth 10 → bounded recursion
  // Plus find does NOT follow symlinks unless -L is passed (it isn't),
  // so symlinks pointing outside the workspace are listed but not
  // dereferenced.
  let capturedCmd = ''
  let capturedCwd: string | undefined
  const sandbox = createSandbox(async (cmd, opts) => {
    capturedCmd = cmd
    capturedCwd = opts?.cwd
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

  const workspace = createWorkspace('/sandboxed/workspace')
  const fileSearch = createServerFileSearch(workspace, sandbox)

  // Even an LLM-crafted escape attempt — `..`-relative glob — can't
  // walk outside the cwd because find . never traverses upward.
  await fileSearch.search('../../etc/passwd')

  expect(capturedCwd).toBe('/sandboxed/workspace')
  expect(capturedCmd).toMatch(/^find \./)
  expect(capturedCmd).toContain('-maxdepth 10')
  // No -L (follow-symlinks) flag.
  expect(capturedCmd).not.toMatch(/find\s+-L\s/)
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

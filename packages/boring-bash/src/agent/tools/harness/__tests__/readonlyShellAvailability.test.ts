import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'

import { buildBwrapArgs } from '../../../runtime/buildBwrapArgs'
import type { RuntimeBundle } from '../../../runtime/types'
import { buildHarnessAgentTools } from '../index'

function bundle(overrides: Partial<RuntimeBundle> = {}): RuntimeBundle {
  return {
    storageRoot: '/tmp/workspace',
    workspace: {
      root: '/workspace',
      runtimeContext: { runtimeCwd: '/workspace' },
      async readFile() { return '' },
      async writeFile() {},
      async unlink() {},
      async readdir() { return [] },
      async stat() { return { kind: 'dir', size: 0, mtimeMs: 0 } },
      async mkdir() {},
      async rename() {},
    },
    sandbox: {
      id: 'shell-claim-test',
      placement: 'server',
      provider: 'bwrap',
      capabilities: ['exec', 'isolated-code'],
      runtimeContext: { runtimeCwd: '/workspace' },
      async exec() { throw new Error('not executed') },
      async executeIsolatedCode() { throw new Error('not executed') },
    },
    fileSearch: {} as RuntimeBundle['fileSearch'],
    runtimeHost: {
      buildBwrapArgs: vi.fn(() => ['--']),
      withWorkspacePythonEnv: vi.fn(() => ({})),
    },
    bash: { kind: 'local-sandbox', sandboxRoot: '/workspace' },
    filesystem: { kind: 'host' },
    ...overrides,
  }
}

const HAS_BWRAP = (() => {
  const result = spawnSync('bwrap', ['--version'], { stdio: 'ignore' })
  return !result.error && result.status === 0
})()

describe('readonly workspace shell availability', () => {
  test('preserves legacy shell tools when no readonly policy exists', () => {
    expect(buildHarnessAgentTools(bundle()).map((tool) => tool.name)).toEqual([
      'bash',
      'execute_isolated_code',
    ])
  })

  test.each([undefined, 'operations'] as const)(
    'withholds every mutation-capable shell for an absent/operations claim (%s)',
    (readonlyWorkspacePathEnforcement) => {
      expect(buildHarnessAgentTools(bundle({
        readonlyWorkspacePolicy: { readonlyPaths: ['locked'], revision: 'v1' },
        readonlyWorkspacePathEnforcement,
      }))).toEqual([])
    },
  )

  test('exposes shell tools only for the resolved strong claim', () => {
    expect(buildHarnessAgentTools(bundle({
      readonlyWorkspacePolicy: { readonlyPaths: ['locked'], revision: 'v1' },
      readonlyWorkspacePathEnforcement: 'operations-and-shell',
    })).map((tool) => tool.name)).toEqual(['bash', 'execute_isolated_code'])
  })

  test.skipIf(!HAS_BWRAP)('enforces the strong claim through the actual bash tool spawn path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'boring-bash-readonly-shell-'))
    try {
      await mkdir(join(root, 'mixed/protected'), { recursive: true })
      await writeFile(join(root, 'mixed/protected/locked.txt'), 'locked')
      await writeFile(join(root, 'mixed/free.txt'), 'free')
      const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
      const runtime = bundle({
        storageRoot: root,
        readonlyWorkspacePolicy: { readonlyPaths: ['mixed/protected'], revision: 'v1' },
        readonlyWorkspacePathEnforcement: 'operations-and-shell',
        runtimeHost: {
          buildBwrapArgs,
          withWorkspacePythonEnv: ({ env: input }) => ({ ...env, ...input }),
        },
      })
      const bash = buildHarnessAgentTools(runtime).find((tool) => tool.name === 'bash')!
      const ctx = { abortSignal: new AbortController().signal, toolCallId: 'readonly-shell' }
      for (const command of [
        'echo x > /workspace/mixed/protected/locked.txt',
        'echo x > /workspace/mixed/replacement && mv -f /workspace/mixed/replacement /workspace/mixed/protected/locked.txt',
        'mv /workspace/mixed /workspace/mixed-moved',
      ]) {
        await expect(bash.execute({ command }, ctx)).resolves.toMatchObject({ isError: true })
        expect(await readFile(join(root, 'mixed/protected/locked.txt'), 'utf8')).toBe('locked')
      }
      await expect(bash.execute({ command: 'echo ok > /workspace/mixed/free.txt' }, ctx)).resolves.toMatchObject({ isError: false })
      expect(await readFile(join(root, 'mixed/free.txt'), 'utf8')).toContain('ok')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

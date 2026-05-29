import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, test } from 'vitest'

import { getBoringAgentRuntimePaths } from '../../runtimeLayout'
import { readFingerprint } from '../fingerprint'
import { ensureNodeRuntime } from '../node'
import type { WorkspaceProvisioningAdapter, WorkspaceProvisioningExecResult } from '../types'

interface FakeAdapterState {
  commands: Array<{ command: string; args: string[]; cwd?: string; env?: Record<string, string> }>
  resolved: Array<{ source: string | URL; kind: string; id: string; fingerprint: string }>
  failNpmInstall?: boolean
}

function createFakeAdapter(workspaceRoot: string, state: FakeAdapterState): WorkspaceProvisioningAdapter {
  const toAbs = (rel: string) => join(workspaceRoot, rel)
  return {
    mode: 'direct',
    async exec(command, args, opts): Promise<WorkspaceProvisioningExecResult | void> {
      state.commands.push({ command, args, cwd: opts?.cwd, env: opts?.env })
      if (command === 'node' && args[0] === '--version') return { stdout: 'v20.11.0\n' }
      if (command === 'npm' && args[0] === '--version') return { stdout: '10.2.4\n' }
      if (command === 'npm' && args[0] === 'install') {
        if (state.failNpmInstall) throw new Error('npm install failed')
        const prefix = args[args.indexOf('--prefix') + 1]
        await mkdir(join(prefix, 'node_modules', '.bin'), { recursive: true })
        await writeFile(join(prefix, 'package-lock.json'), '{"lockfileVersion":3}\n')
        await writeFile(join(prefix, 'node_modules', '.bin', 'boring-ui'), '#!/usr/bin/env node\n')
      }
    },
    async resolveInstallSource(source, opts) {
      state.resolved.push({ source, ...opts })
      return String(source)
    },
    workspaceFs: {
      async exists(rel) {
        try {
          await readFile(toAbs(rel))
          return true
        } catch {
          return false
        }
      },
      async rm(rel) {
        await rm(toAbs(rel), { recursive: true, force: true })
      },
      async mkdir(rel) {
        await mkdir(toAbs(rel), { recursive: true })
      },
      async writeText(rel, content) {
        await mkdir(join(toAbs(rel), '..'), { recursive: true })
        await writeFile(toAbs(rel), content)
      },
      async readText(rel) {
        try {
          return await readFile(toAbs(rel), 'utf8')
        } catch {
          return null
        }
      },
      async copyFromHost() {},
    },
    getRuntimeCacheRoot() {
      return join(workspaceRoot, '.boring-agent', 'cache')
    },
  }
}

async function tempWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'boring-node-runtime-'))
}

test('installs fake boring-ui bin with npm --prefix and dummy package.json', async () => {
  const workspaceRoot = await tempWorkspace()
  const paths = getBoringAgentRuntimePaths(workspaceRoot)
  const state: FakeAdapterState = { commands: [], resolved: [] }

  const result = await ensureNodeRuntime({
    adapter: createFakeAdapter(workspaceRoot, state),
    runtimeLayout: paths,
    packages: [{
      id: 'cli',
      packageName: '@hachej/boring-ui-cli',
      version: '0.1.0',
      expectedBins: ['boring-ui'],
    }],
  })

  expect(result.changed).toBe(true)
  expect(result.pathEntries).toEqual([paths.nodeBin])
  await expect(readFile(join(paths.nodeBin, 'boring-ui'), 'utf8')).resolves.toContain('node')
  await expect(readFile(join(paths.node, 'package.json'), 'utf8').then(JSON.parse)).resolves.toEqual({
    name: 'boring-agent-runtime',
    private: true,
  })
  const npmInstall = state.commands.find((cmd) => cmd.command === 'npm' && cmd.args[0] === 'install')
  expect(npmInstall?.args).toEqual([
    'install',
    '--prefix',
    paths.node,
    '@hachej/boring-ui-cli@0.1.0',
  ])
  expect(npmInstall?.cwd).toBe(paths.workspaceRoot)
  expect(npmInstall?.env?.npm_config_cache).toBe(join(workspaceRoot, '.boring-agent', 'cache', 'npm'))
})

test('skips install when composite fingerprint matches and expected bin exists', async () => {
  const workspaceRoot = await tempWorkspace()
  const paths = getBoringAgentRuntimePaths(workspaceRoot)
  const state: FakeAdapterState = { commands: [], resolved: [] }
  const adapter = createFakeAdapter(workspaceRoot, state)
  const packages = [{ id: 'cli', packageName: '@hachej/boring-ui-cli', expectedBins: ['boring-ui'] }]

  const first = await ensureNodeRuntime({ adapter, runtimeLayout: paths, packages })
  const second = await ensureNodeRuntime({ adapter, runtimeLayout: paths, packages })

  expect(first.changed).toBe(true)
  expect(second.changed).toBe(false)
  expect(state.commands.filter((cmd) => cmd.command === 'npm' && cmd.args[0] === 'install')).toHaveLength(1)
})

test('reinstalls when expected bin is missing even if fingerprint exists', async () => {
  const workspaceRoot = await tempWorkspace()
  const paths = getBoringAgentRuntimePaths(workspaceRoot)
  const state: FakeAdapterState = { commands: [], resolved: [] }
  const adapter = createFakeAdapter(workspaceRoot, state)
  const packages = [{ id: 'cli', packageName: '@hachej/boring-ui-cli', expectedBins: ['boring-ui'] }]

  await ensureNodeRuntime({ adapter, runtimeLayout: paths, packages })
  await rm(join(paths.nodeBin, 'boring-ui'), { force: true })
  const second = await ensureNodeRuntime({ adapter, runtimeLayout: paths, packages })

  expect(second.changed).toBe(true)
  expect(state.commands.filter((cmd) => cmd.command === 'npm' && cmd.args[0] === 'install')).toHaveLength(2)
})

test('changed package version or node/npm version changes fingerprint and reinstalls', async () => {
  const workspaceRoot = await tempWorkspace()
  const paths = getBoringAgentRuntimePaths(workspaceRoot)
  const state: FakeAdapterState = { commands: [], resolved: [] }
  const adapter = createFakeAdapter(workspaceRoot, state)

  const first = await ensureNodeRuntime({
    adapter,
    runtimeLayout: paths,
    packages: [{ id: 'cli', packageName: '@hachej/boring-ui-cli', version: '0.1.0', expectedBins: ['boring-ui'] }],
  })
  const second = await ensureNodeRuntime({
    adapter,
    runtimeLayout: paths,
    packages: [{ id: 'cli', packageName: '@hachej/boring-ui-cli', version: '0.1.1', expectedBins: ['boring-ui'] }],
  })

  expect(second.changed).toBe(true)
  expect(second.fingerprint).not.toBe(first.fingerprint)
})

test('local package roots use adapter.resolveInstallSource and paths with spaces stay one arg', async () => {
  const workspaceRoot = await tempWorkspace()
  const sourceRoot = await mkdtemp(join(tmpdir(), 'boring node package with spaces-'))
  const paths = getBoringAgentRuntimePaths(workspaceRoot)
  const state: FakeAdapterState = { commands: [], resolved: [] }

  await ensureNodeRuntime({
    adapter: createFakeAdapter(workspaceRoot, state),
    runtimeLayout: paths,
    packages: [{
      id: 'cli',
      packageName: '@hachej/boring-ui-cli',
      packageRoot: sourceRoot,
      expectedBins: ['boring-ui'],
    }],
  })

  expect(state.resolved).toHaveLength(1)
  const npmInstall = state.commands.find((cmd) => cmd.command === 'npm' && cmd.args[0] === 'install')
  expect(npmInstall?.args.at(-1)).toBe(sourceRoot)
})

test('failed npm install does not write fingerprint', async () => {
  const workspaceRoot = await tempWorkspace()
  const paths = getBoringAgentRuntimePaths(workspaceRoot)
  const state: FakeAdapterState = { commands: [], resolved: [], failNpmInstall: true }

  await expect(ensureNodeRuntime({
    adapter: createFakeAdapter(workspaceRoot, state),
    runtimeLayout: paths,
    packages: [{ id: 'cli', packageName: '@hachej/boring-ui-cli', expectedBins: ['boring-ui'] }],
  })).rejects.toThrow('npm install failed')

  await expect(readFingerprint(join(paths.node, '.fingerprint'))).resolves.toBeNull()
})

test('does not create or mutate user workspace package.json', async () => {
  const workspaceRoot = await tempWorkspace()
  const paths = getBoringAgentRuntimePaths(workspaceRoot)
  const state: FakeAdapterState = { commands: [], resolved: [] }
  await writeFile(join(workspaceRoot, 'package.json'), '{"name":"user-workspace"}\n')

  await ensureNodeRuntime({
    adapter: createFakeAdapter(workspaceRoot, state),
    runtimeLayout: paths,
    packages: [{ id: 'cli', packageName: '@hachej/boring-ui-cli', expectedBins: ['boring-ui'] }],
  })

  await expect(readFile(join(workspaceRoot, 'package.json'), 'utf8')).resolves.toBe('{"name":"user-workspace"}\n')
})

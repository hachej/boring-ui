import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, test } from 'vitest'

import { getBoringAgentRuntimePaths } from '../../runtimeLayout'
import { readFingerprint } from '../fingerprint'
import { ensurePythonRuntime, ensureUv } from '../python'
import type { WorkspaceProvisioningAdapter, WorkspaceProvisioningExecResult } from '../types'

interface FakeAdapterState {
  commands: Array<{ command: string; args: string[]; cwd?: string; env?: Record<string, string> }>
  resolved: Array<{ source: string | URL; kind: string; id: string; fingerprint: string }>
  systemUv?: boolean
  failPipInstall?: boolean
}

function createFakeAdapter(workspaceRoot: string, state: FakeAdapterState): WorkspaceProvisioningAdapter {
  const toAbs = (rel: string) => join(workspaceRoot, rel)
  return {
    mode: 'direct',
    async exec(command, args, opts): Promise<WorkspaceProvisioningExecResult | void> {
      state.commands.push({ command, args, cwd: opts?.cwd, env: opts?.env })
      if (command === 'python3' && args[0] === '--version') return { stdout: 'Python 3.12.1\n' }
      if (command === 'uv' && args[0] === '--version') {
        if (!state.systemUv) throw new Error('uv missing')
        return { stdout: 'uv 0.5.0\n' }
      }
      if (command.endsWith('/uv') && args[0] === '--version') return { stdout: 'uv 0.5.1\n' }
      if (command === 'chmod') return {}
      if (args[0] === 'venv') {
        await mkdir(join(args[1], 'bin'), { recursive: true })
        await writeFile(join(args[1], 'bin', 'python'), '#!/usr/bin/env python\n')
        return {}
      }
      if (args[0] === 'pip' && args[1] === 'install') {
        if (state.failPipInstall) throw new Error('uv pip install failed')
        const pythonPath = args[args.indexOf('--python') + 1]
        await mkdir(dirname(pythonPath), { recursive: true })
        await writeFile(join(dirname(pythonPath), 'bm'), '#!/usr/bin/env python\n')
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
        await mkdir(dirname(toAbs(rel)), { recursive: true })
        await writeFile(toAbs(rel), content)
      },
      async readText(rel) {
        try {
          return await readFile(toAbs(rel), 'utf8')
        } catch {
          return null
        }
      },
      async copyFromHost(source, rel) {
        const sourcePath = source instanceof URL ? source.pathname : source
        await mkdir(dirname(toAbs(rel)), { recursive: true })
        await writeFile(toAbs(rel), await readFile(sourcePath))
      },
    },
    getRuntimeCacheRoot() {
      return join(workspaceRoot, '.boring-agent', 'cache')
    },
  }
}

async function tempWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'boring-python-runtime-'))
}

async function fakePyprojectRoot(prefix = 'boring macro sdk-'): Promise<{ root: string; pyproject: string }> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  const pyproject = join(root, 'pyproject.toml')
  await writeFile(pyproject, '[project]\nname = "boring-macro-sdk"\n')
  return { root, pyproject }
}

test('installs fake bm bin into final venv with uv venv and uv pip install', async () => {
  const workspaceRoot = await tempWorkspace()
  const paths = getBoringAgentRuntimePaths(workspaceRoot)
  const { pyproject } = await fakePyprojectRoot()
  const state: FakeAdapterState = { commands: [], resolved: [], systemUv: true }

  const result = await ensurePythonRuntime({
    adapter: createFakeAdapter(workspaceRoot, state),
    runtimeLayout: paths,
    packages: [{
      id: 'macro-sdk',
      packageName: 'boring-macro-sdk',
      projectFile: pyproject,
      expectedBins: ['bm'],
      extraLibs: ['pandas==2.2.3'],
      env: { BORING_MACRO_API_URL: 'http://localhost:3000' },
    }],
  })

  expect(result.changed).toBe(true)
  expect(result.pathEntries).toEqual([paths.venvBin, paths.uvBin])
  expect(result.env).toEqual({ BORING_MACRO_API_URL: 'http://localhost:3000' })
  await expect(readFile(join(paths.venvBin, 'bm'), 'utf8')).resolves.toContain('python')
  const venvCommand = state.commands.find((cmd) => cmd.args[0] === 'venv')
  const pipCommand = state.commands.find((cmd) => cmd.args[0] === 'pip')
  expect(venvCommand?.args).toEqual(['venv', paths.venv])
  expect(pipCommand?.args).toContain('--python')
  expect(pipCommand?.args).toContain(paths.venvPython)
  expect(pipCommand?.args).toContain('pandas==2.2.3')
  expect(pipCommand?.env?.BORING_MACRO_API_URL).toBe('http://localhost:3000')
})

test('skips install when composite fingerprint matches and bm exists', async () => {
  const workspaceRoot = await tempWorkspace()
  const paths = getBoringAgentRuntimePaths(workspaceRoot)
  const { pyproject } = await fakePyprojectRoot()
  const state: FakeAdapterState = { commands: [], resolved: [], systemUv: true }
  const packages = [{ id: 'macro-sdk', packageName: 'boring-macro-sdk', projectFile: pyproject, expectedBins: ['bm'] }]
  const adapter = createFakeAdapter(workspaceRoot, state)

  const first = await ensurePythonRuntime({ adapter, runtimeLayout: paths, packages })
  const second = await ensurePythonRuntime({ adapter, runtimeLayout: paths, packages })

  expect(first.changed).toBe(true)
  expect(second.changed).toBe(false)
  expect(state.commands.filter((cmd) => cmd.args[0] === 'pip')).toHaveLength(1)
})

test('missing bin or changed extraLibs causes reinstall', async () => {
  const workspaceRoot = await tempWorkspace()
  const paths = getBoringAgentRuntimePaths(workspaceRoot)
  const { pyproject } = await fakePyprojectRoot()
  const state: FakeAdapterState = { commands: [], resolved: [], systemUv: true }
  const adapter = createFakeAdapter(workspaceRoot, state)

  await ensurePythonRuntime({
    adapter,
    runtimeLayout: paths,
    packages: [{ id: 'macro-sdk', packageName: 'boring-macro-sdk', projectFile: pyproject, expectedBins: ['bm'] }],
  })
  await rm(join(paths.venvBin, 'bm'), { force: true })
  const missingBinRun = await ensurePythonRuntime({
    adapter,
    runtimeLayout: paths,
    packages: [{ id: 'macro-sdk', packageName: 'boring-macro-sdk', projectFile: pyproject, expectedBins: ['bm'] }],
  })
  const extraLibRun = await ensurePythonRuntime({
    adapter,
    runtimeLayout: paths,
    packages: [{ id: 'macro-sdk', packageName: 'boring-macro-sdk', projectFile: pyproject, expectedBins: ['bm'], extraLibs: ['duckdb==1.1.3'] }],
  })

  expect(missingBinRun.changed).toBe(true)
  expect(extraLibRun.changed).toBe(true)
  expect(state.commands.filter((cmd) => cmd.args[0] === 'pip')).toHaveLength(3)
})

test('package paths with spaces use resolveInstallSource and remain one pip arg', async () => {
  const workspaceRoot = await tempWorkspace()
  const paths = getBoringAgentRuntimePaths(workspaceRoot)
  const { root, pyproject } = await fakePyprojectRoot('boring macro sdk with spaces-')
  const state: FakeAdapterState = { commands: [], resolved: [], systemUv: true }

  await ensurePythonRuntime({
    adapter: createFakeAdapter(workspaceRoot, state),
    runtimeLayout: paths,
    packages: [{ id: 'macro-sdk', packageName: 'boring-macro-sdk', packageRoot: root, projectFile: pyproject, expectedBins: ['bm'] }],
  })

  expect(state.resolved).toHaveLength(1)
  const pipCommand = state.commands.find((cmd) => cmd.args[0] === 'pip')
  expect(pipCommand?.args.at(-1)).toBe(root)
})

test('workspace-local uv fallback copies standalone binary and marks it executable', async () => {
  const workspaceRoot = await tempWorkspace()
  const paths = getBoringAgentRuntimePaths(workspaceRoot)
  const standaloneRoot = await mkdtemp(join(tmpdir(), 'boring-uv-standalone-'))
  const standaloneUv = join(standaloneRoot, 'uv')
  await writeFile(standaloneUv, '#!/bin/sh\n')
  const state: FakeAdapterState = { commands: [], resolved: [], systemUv: false }

  const result = await ensureUv({
    adapter: createFakeAdapter(workspaceRoot, state),
    runtimeLayout: paths,
    uvStandaloneSource: standaloneUv,
  })

  expect(result.installedWorkspaceUv).toBe(true)
  expect(result.uvBin).toBe(join(paths.uvBin, 'uv'))
  await expect(readFile(join(paths.uvBin, 'uv'), 'utf8')).resolves.toBe('#!/bin/sh\n')
  expect(state.commands).toContainEqual(expect.objectContaining({
    command: 'chmod',
    args: ['+x', join(paths.uvBin, 'uv')],
  }))
})

test('failed uv pip install does not write fingerprint', async () => {
  const workspaceRoot = await tempWorkspace()
  const paths = getBoringAgentRuntimePaths(workspaceRoot)
  const { pyproject } = await fakePyprojectRoot()
  const state: FakeAdapterState = { commands: [], resolved: [], systemUv: true, failPipInstall: true }

  await expect(ensurePythonRuntime({
    adapter: createFakeAdapter(workspaceRoot, state),
    runtimeLayout: paths,
    packages: [{ id: 'macro-sdk', packageName: 'boring-macro-sdk', projectFile: pyproject, expectedBins: ['bm'] }],
  })).rejects.toThrow('uv pip install failed')

  await expect(readFingerprint(join(paths.venv, '.fingerprint'))).resolves.toBeNull()
})

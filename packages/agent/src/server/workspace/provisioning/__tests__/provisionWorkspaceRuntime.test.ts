import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, test } from 'vitest'

import {
  getBoringAgentRuntimeEnv,
  getBoringAgentRuntimePaths,
  testRuntimeHostOperations,
} from '@agent-test-host'
import { provisionWorkspaceRuntime as provisionWorkspaceRuntimeBase } from '../provisionWorkspaceRuntime'
import type { WorkspaceProvisioningAdapter, WorkspaceProvisioningExecResult } from '../types'

function provisionWorkspaceRuntime(
  options: Omit<Parameters<typeof provisionWorkspaceRuntimeBase>[0], 'runtimeHost'>,
) {
  return provisionWorkspaceRuntimeBase({ ...options, runtimeHost: testRuntimeHostOperations })
}

interface FakeState {
  commands: Array<{ command: string; args: string[]; cwd?: string; env?: Record<string, string> }>
  failCommand?: string
}

function createAdapter(workspaceRoot: string, state: FakeState): WorkspaceProvisioningAdapter {
  const toAbs = (rel: string) => join(workspaceRoot, rel)
  return {
    mode: 'direct',
    async exec(command, args, opts): Promise<WorkspaceProvisioningExecResult | void> {
      state.commands.push({ command, args, cwd: opts?.cwd, env: opts?.env })
      if (state.failCommand === command || state.failCommand === args[0]) throw new Error(`failed ${command}`)
      if (command === 'node' && args[0] === '--version') return { stdout: 'v20.11.0\n' }
      if (command === 'npm' && args[0] === '--version') return { stdout: '10.2.4\n' }
      if (command === 'python3' && args[0] === '--version') return { stdout: 'Python 3.12.1\n' }
      if (command === 'uv' && args[0] === '--version') return { stdout: 'uv 0.5.0\n' }
      if (command === 'npm' && args[0] === 'install') {
        const prefix = args[args.indexOf('--prefix') + 1]
        await mkdir(join(prefix, 'node_modules', '.bin'), { recursive: true })
        await writeFile(join(prefix, 'node_modules', '.bin', 'boring-ui'), '#!/usr/bin/env node\n')
      }
      if (args[0] === 'venv') {
        await mkdir(join(args[1], 'bin'), { recursive: true })
        await writeFile(join(args[1], 'bin', 'python'), '#!/usr/bin/env python\n')
      }
      if (args[0] === 'pip') {
        const pythonPath = args[args.indexOf('--python') + 1]
        await mkdir(dirname(pythonPath), { recursive: true })
        await writeFile(join(dirname(pythonPath), 'bm'), '#!/usr/bin/env python\n')
      }
    },
    async resolveInstallSource(source) {
      return String(source)
    },
    workspaceFs: {
      async exists(rel) {
        try {
          await stat(toAbs(rel))
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
        const sourceStat = await stat(sourcePath)
        if (sourceStat.isDirectory()) {
          await mkdir(toAbs(rel), { recursive: true })
          return
        }
        await writeFile(toAbs(rel), await readFile(sourcePath))
      },
    },
    getRuntimeCacheRoot() {
      return join(workspaceRoot, '.boring-agent', 'cache')
    },
  }
}

async function tempWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'boring-provision-runtime-'))
}

async function sourceFile(name: string, content: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'boring-provision-source-'))
  const path = join(root, name)
  await writeFile(path, content)
  return path
}

test('empty plugin list ensures layout, gitignore, env, pathEntries, and skill paths', async () => {
  const workspaceRoot = await tempWorkspace()
  const paths = getBoringAgentRuntimePaths(workspaceRoot)
  const state: FakeState = { commands: [] }
  const adapter = createAdapter(workspaceRoot, state)

  const first = await provisionWorkspaceRuntime({ plugins: [], adapter, runtimeLayout: paths })
  const second = await provisionWorkspaceRuntime({ plugins: [], adapter, runtimeLayout: paths })

  expect(first.changed).toBe(true)
  expect(second.changed).toBe(false)
  await expect(readFile(join(paths.agentDir, '.gitignore'), 'utf8')).resolves.toBe('*\n')
  expect(second.env).toEqual(getBoringAgentRuntimeEnv(paths, adapter.getRuntimeCacheRoot()))
  expect(second.pathEntries).toEqual([paths.nodeBin, paths.venvBin, paths.uvBin])
  expect(second.skillPaths).toEqual([paths.skills, join(paths.workspaceRoot, '.agents/skills')])
})

test('emits provisioning telemetry phase timings', async () => {
  const workspaceRoot = await tempWorkspace()
  const paths = getBoringAgentRuntimePaths(workspaceRoot)
  const events: Array<{ name: string; properties?: Record<string, unknown> }> = []

  const result = await provisionWorkspaceRuntime({
    plugins: [],
    adapter: createAdapter(workspaceRoot, { commands: [] }),
    runtimeLayout: paths,
    telemetry: { capture: (event) => { events.push(event) } },
    telemetryContext: {
      workspaceId: 'workspace_1',
      sessionId: 'session_1',
      requestId: 'request_1',
      runtimeMode: 'direct',
    },
  })

  expect(result.changed).toBe(true)
  expect(events.map((event) => event.name)).toEqual([
    'agent.runtime.provisioning.started',
    'agent.runtime.provisioning.step',
    'agent.runtime.provisioning.step',
    'agent.runtime.provisioning.step',
    'agent.runtime.provisioning.step',
    'agent.runtime.provisioning.step',
    'agent.runtime.provisioning.completed',
  ])
  expect(events.filter((event) => event.name === 'agent.runtime.provisioning.step').map((event) => event.properties?.phase)).toEqual([
    'layout',
    'skills-mirror',
    'workspace-files',
    'node-packages',
    'python-packages',
  ])
  for (const event of events) {
    expect(event.properties).toMatchObject({
      workspaceId: 'workspace_1',
      sessionId: 'session_1',
      requestId: 'request_1',
      runtimeMode: 'direct',
    })
    if (event.name.endsWith('.step') || event.name.endsWith('.completed')) {
      expect(event.properties?.durationMs).toEqual(expect.any(Number))
    }
  }
})

test('handles only skills and only templates', async () => {
  const workspaceRoot = await tempWorkspace()
  const paths = getBoringAgentRuntimePaths(workspaceRoot)
  const skill = await sourceFile('SKILL.md', '# Skill\n')
  const template = await sourceFile('intro.md', '# Intro\n')

  const result = await provisionWorkspaceRuntime({
    plugins: [
      { id: 'skill-plugin', skills: [{ name: 'readme', source: skill }] },
      { id: 'template-plugin', provisioning: { templateDirs: [{ id: 'intro', path: template, target: 'deck/intro.md' }] } },
    ],
    adapter: createAdapter(workspaceRoot, { commands: [] }),
    runtimeLayout: paths,
  })

  expect(result.changed).toBe(true)
  await expect(readFile(join(paths.skills, 'skill-plugin', 'readme', 'SKILL.md'), 'utf8')).resolves.toBe('# Skill\n')
  await expect(readFile(join(workspaceRoot, 'deck', 'intro.md'), 'utf8')).resolves.toBe('# Intro\n')
})

test('handles node package, python package, mixed plugins, and trusted env contribution', async () => {
  const workspaceRoot = await tempWorkspace()
  const paths = getBoringAgentRuntimePaths(workspaceRoot)
  const pyproject = await sourceFile('pyproject.toml', '[project]\nname = "boring-macro-sdk"\n')
  const state: FakeState = { commands: [] }

  const result = await provisionWorkspaceRuntime({
    plugins: [{
      id: 'macro',
      provisioning: {
        nodePackages: [{ id: 'cli', packageName: '@hachej/boring-ui-cli', expectedBins: ['boring-ui'] }],
        python: [{
          id: 'macro-sdk',
          packageName: 'boring-macro-sdk',
          projectFile: pyproject,
          expectedBins: ['bm'],
          env: { BORING_MACRO_API_URL: 'http://localhost:3000' },
        }],
      },
    }],
    adapter: createAdapter(workspaceRoot, state),
    runtimeLayout: paths,
  })

  expect(result.env.BORING_MACRO_API_URL).toBe('http://localhost:3000')
  expect(result.pathEntries).toEqual([paths.nodeBin, paths.venvBin, paths.uvBin])
  await expect(readFile(join(paths.nodeBin, 'boring-ui'), 'utf8')).resolves.toContain('node')
  await expect(readFile(join(paths.venvBin, 'bm'), 'utf8')).resolves.toContain('python')
  expect(state.commands.some((cmd) => cmd.command === 'npm' && cmd.args[0] === 'install')).toBe(true)
  expect(state.commands.some((cmd) => cmd.args[0] === 'pip')).toBe(true)
})

test('fails synchronously before caller can declare runtime ready', async () => {
  const workspaceRoot = await tempWorkspace()
  const paths = getBoringAgentRuntimePaths(workspaceRoot)

  await expect(provisionWorkspaceRuntime({
    plugins: [{ id: 'plugin', provisioning: { nodePackages: [{ id: 'cli', packageName: '@hachej/boring-ui-cli' }] } }],
    adapter: createAdapter(workspaceRoot, { commands: [], failCommand: 'npm' }),
    runtimeLayout: paths,
  })).rejects.toThrow('failed npm')
})

test('does not require forbidden plan-layer abstractions in the provisioning source', async () => {
  const source = await readFile('src/server/workspace/provisioning/provisionWorkspaceRuntime.ts', 'utf8')
  expect(source).not.toContain('WorkspaceSetupPlan')
  expect(source).not.toContain('RuntimeProvisioningPlugin')
  expect(source).not.toContain('buildSystemPrompt')
})

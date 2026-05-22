import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Writable } from 'node:stream'

import type { Sandbox as VercelSandbox } from '@vercel/sandbox'
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { SandboxHandleRecord, SandboxHandleStore } from '../../../shared/sandbox-handle-store'
import { provisionRuntimeWorkspace, type RuntimeProvisioningContribution } from '../../workspace/provisionRuntime'
import { createVercelSandboxModeAdapter } from '../modes/vercel-sandbox'
import { directModeAdapter } from '../modes/direct'
import { localModeAdapter } from '../modes/local'
import type { RuntimeBundle } from '../mode'
import {
  resetSandboxHandleCacheForTests,
  type VercelSandboxClient,
} from '../../sandbox/vercel-sandbox/resolveSandboxHandle'

const decoder = new TextDecoder()
const tempDirs: string[] = []
const HAS_BWRAP = (() => {
  const result = spawnSync('bwrap', ['--version'], { stdio: 'ignore' })
  return !result.error && result.status === 0
})()

const MATRIX_COMMANDS = {
  pwd: 'pwd',
  envPwd: 'echo $PWD',
  boringRoot: 'echo $BORING_AGENT_WORKSPACE_ROOT',
  virtualEnv: 'echo $VIRTUAL_ENV',
  whichPython: 'which python',
  whichPip: 'which pip',
  pythonExecutable: "python -c 'import sys; print(sys.executable)'",
  pythonConsoleScriptHelp: 'matrix-tool --help',
  boringUiHelp: 'boring-ui --help',
  literalCommand: [
    "python - <<'PY'",
    'literal = "/vercel/sandbox"',
    'expected = "/" + "vercel" + "/" + "sandbox"',
    'print("literal-ok" if literal == expected else "literal-rewritten")',
    'PY',
  ].join('\n'),
} as const

type MatrixCommandName = keyof typeof MATRIX_COMMANDS
type MatrixObservations = Record<MatrixCommandName, string>

afterEach(async () => {
  resetSandboxHandleCacheForTests()
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function makeMatrixPythonPackage(): Promise<string> {
  const packageRoot = await makeTempDir('boring-runtime-matrix-python-')
  await mkdir(join(packageRoot, 'src', 'boring_matrix_sdk'), { recursive: true })
  await writeFile(
    join(packageRoot, 'pyproject.toml'),
    [
      '[build-system]',
      'requires = ["setuptools>=68"]',
      'build-backend = "setuptools.build_meta"',
      '',
      '[project]',
      'name = "boring-runtime-matrix-sdk"',
      'version = "0.0.0"',
      '',
      '[project.scripts]',
      'matrix-tool = "boring_matrix_sdk.cli:main"',
      '',
      '[tool.setuptools.packages.find]',
      'where = ["src"]',
      '',
    ].join('\n'),
    'utf8',
  )
  await writeFile(join(packageRoot, 'src', 'boring_matrix_sdk', '__init__.py'), '__all__ = []\n', 'utf8')
  await writeFile(
    join(packageRoot, 'src', 'boring_matrix_sdk', 'cli.py'),
    [
      'import argparse',
      '',
      'def main(argv=None):',
      '    parser = argparse.ArgumentParser(prog="matrix-tool", description="matrix fixture console script")',
      '    parser.add_argument("--version", action="store_true")',
      '    parser.parse_args(argv)',
      '',
    ].join('\n'),
    'utf8',
  )
  return packageRoot
}

async function makeBoringUiCliPackage(): Promise<string> {
  const packageRoot = await makeTempDir('boring-runtime-matrix-cli-')
  await mkdir(join(packageRoot, 'dist'), { recursive: true })
  await writeFile(
    join(packageRoot, 'package.json'),
    `${JSON.stringify({
      name: '@example/boring-ui-cli',
      version: '0.0.0',
      type: 'module',
      bin: { 'boring-ui': 'dist/index.js' },
    })}\n`,
    'utf8',
  )
  await writeFile(
    join(packageRoot, 'dist', 'index.js'),
    '#!/usr/bin/env node\nif (process.argv.includes("--help")) { process.stdout.write("Usage: boring-ui matrix fixture\\n"); } else { process.stdout.write("boring-ui fixture\\n"); }\n',
    'utf8',
  )
  return packageRoot
}

async function makeMatrixContribution(): Promise<{ id: string; provisioning: RuntimeProvisioningContribution }> {
  const pythonRoot = await makeMatrixPythonPackage()
  const cliRoot = await makeBoringUiCliPackage()
  return {
    id: 'runtime-matrix-fixture',
    provisioning: {
      python: [{ id: 'matrix-sdk', projectFile: join(pythonRoot, 'pyproject.toml') }],
      nodePackages: [{
        id: 'boring-ui-cli',
        packageName: '@example/boring-ui-cli',
        packageRoot: cliRoot,
        bins: { 'boring-ui': 'dist/index.js' },
      }],
    },
  }
}

async function runMatrix(bundle: RuntimeBundle): Promise<MatrixObservations> {
  const entries = await Promise.all(
    Object.entries(MATRIX_COMMANDS).map(async ([name, command]) => {
      const result = await bundle.sandbox.exec(command, {
        cwd: bundle.runtimeContext.runtimeCwd,
        timeoutMs: 30_000,
      })
      const stdout = decoder.decode(result.stdout)
      const stderr = decoder.decode(result.stderr)
      expect(result.exitCode, `${name} stderr: ${stderr}`).toBe(0)
      return [name, stdout.trimEnd()] as const
    }),
  )
  return Object.fromEntries(entries) as MatrixObservations
}

function assertMatrixObservations(opts: {
  mode: 'direct' | 'local' | 'vercel-sandbox'
  bundle: RuntimeBundle
  observations: MatrixObservations
  hostWorkspaceRoot: string
}): void {
  const { mode, bundle, observations, hostWorkspaceRoot } = opts
  const runtimeCwd = bundle.runtimeContext.runtimeCwd
  const output = Object.values(observations).join('\n')

  expect(bundle.workspace.root).toBe(runtimeCwd)
  expect(bundle.workspace.root).toBe(bundle.sandbox.runtimeContext.runtimeCwd)
  expect(observations.pwd).toBe(runtimeCwd)
  expect(observations.envPwd).toBe(runtimeCwd)
  expect(observations.boringRoot).toBe(runtimeCwd)
  expect(observations.virtualEnv).toBe(`${runtimeCwd}/.boring-agent/venv`)
  expect(observations.whichPython).toBe(`${runtimeCwd}/.boring-agent/bin/python`)
  expect(observations.whichPip).toBe(`${runtimeCwd}/.boring-agent/bin/pip`)
  expect(observations.pythonExecutable).toBe(`${runtimeCwd}/.boring-agent/venv/bin/python`)
  expect(observations.pythonConsoleScriptHelp).toContain('matrix fixture console script')
  expect(observations.boringUiHelp).toContain('Usage: boring-ui matrix fixture')
  expect(observations.literalCommand).toBe('literal-ok')

  if (mode === 'direct') {
    expect(runtimeCwd).toBe(hostWorkspaceRoot)
    return
  }

  expect(runtimeCwd).toBe('/workspace')
  expect(output).not.toContain(hostWorkspaceRoot)
  if (mode === 'vercel-sandbox') {
    expect(output).not.toContain('/vercel/sandbox')
  }
}

async function createStore(): Promise<SandboxHandleStore> {
  const records = new Map<string, SandboxHandleRecord>()
  return {
    async get(workspaceId) {
      return records.get(workspaceId) ?? null
    },
    async put(record) {
      records.set(record.workspaceId, record)
    },
    async delete(workspaceId) {
      records.delete(workspaceId)
    },
    async list() {
      return [...records.values()]
    },
  }
}

function emitToWritable(writable: Writable | undefined, text: string): void {
  if (writable) {
    if (text) writable.write(Buffer.from(text, 'utf8'))
    writable.end()
  }
}

function mockVercelStdout(script: string, cwd: string, env: Record<string, string>): string | null {
  switch (script) {
    case MATRIX_COMMANDS.pwd:
      return `${cwd}\n`
    case MATRIX_COMMANDS.envPwd:
      return `${cwd}\n`
    case MATRIX_COMMANDS.boringRoot:
      return `${env.BORING_AGENT_WORKSPACE_ROOT ?? ''}\n`
    case MATRIX_COMMANDS.virtualEnv:
      return `${env.VIRTUAL_ENV ?? ''}\n`
    case MATRIX_COMMANDS.whichPython:
      return `${env.BORING_AGENT_WORKSPACE_ROOT}/.boring-agent/bin/python\n`
    case MATRIX_COMMANDS.whichPip:
      return `${env.BORING_AGENT_WORKSPACE_ROOT}/.boring-agent/bin/pip\n`
    case MATRIX_COMMANDS.pythonExecutable:
      return `${env.BORING_AGENT_WORKSPACE_ROOT}/.boring-agent/venv/bin/python\n`
    case MATRIX_COMMANDS.pythonConsoleScriptHelp:
      return 'usage: matrix-tool [-h] [--version]\n\nmatrix fixture console script\n'
    case MATRIX_COMMANDS.boringUiHelp:
      return 'Usage: boring-ui matrix fixture\n'
    case MATRIX_COMMANDS.literalCommand:
      return 'literal-ok\n'
    default:
      return null
  }
}

function createMockVercelSandboxRecorder(): {
  sandbox: VercelSandbox
  commands: Array<{ cmd: string; args: string[]; cwd?: string; env?: Record<string, string> }>
} {
  const commands: Array<{ cmd: string; args: string[]; cwd?: string; env?: Record<string, string> }> = []
  const sandbox = {
    sandboxId: 'sb-runtime-matrix',
    status: 'running',
    sourceSnapshotId: 'snap-runtime-matrix',
    fs: {
      async mkdir() {},
    },
    async runCommand(params: {
      cmd: string
      args?: string[]
      cwd?: string
      env?: Record<string, string>
      stdout?: Writable
      stderr?: Writable
    }) {
      const args = params.args ?? []
      commands.push({ cmd: params.cmd, args, cwd: params.cwd, env: params.env ? { ...params.env } : undefined })
      const script = params.cmd === 'sh' && args[0] === '-c'
        ? args[1] ?? ''
        : [params.cmd, ...args].join(' ').trim()

      if (script.includes('install -d') && script.includes('/workspace')) {
        emitToWritable(params.stdout, '')
        emitToWritable(params.stderr, '')
        return { exitCode: 0 }
      }

      const stdout = mockVercelStdout(script, params.cwd ?? '/workspace', params.env ?? {})
      if (stdout != null) {
        emitToWritable(params.stdout, stdout)
        emitToWritable(params.stderr, '')
        return { exitCode: 0 }
      }

      emitToWritable(params.stdout, '')
      emitToWritable(params.stderr, `unsupported mock command: ${script}`)
      return { exitCode: 127 }
    },
  } as unknown as VercelSandbox
  return { sandbox, commands }
}

test('direct runtime satisfies the unified cwd/provisioning/PATH command matrix', async () => {
  const workspaceRoot = await makeTempDir('boring-runtime-matrix-direct-')
  const contribution = await makeMatrixContribution()
  const bundle = await directModeAdapter.create({
    workspaceRoot,
    sessionId: 'matrix-direct',
  })

  await provisionRuntimeWorkspace({
    workspaceRoot,
    runtimeMode: 'direct',
    runtimeCwd: bundle.runtimeContext.runtimeCwd,
    sandbox: bundle.sandbox,
    contributions: [contribution],
  })

  const observations = await runMatrix(bundle)
  assertMatrixObservations({ mode: 'direct', bundle, observations, hostWorkspaceRoot: workspaceRoot })
}, 90_000)

const describeIfBwrap = HAS_BWRAP ? describe : describe.skip

describeIfBwrap('local/bwrap runtime matrix', () => {
  test('local runtime satisfies the unified cwd/provisioning/PATH command matrix without host path leaks', async () => {
    const workspaceRoot = await makeTempDir('boring-runtime-matrix-local-')
    const contribution = await makeMatrixContribution()
    const bundle = await localModeAdapter.create({
      workspaceRoot,
      sessionId: 'matrix-local',
    })

    await provisionRuntimeWorkspace({
      workspaceRoot,
      runtimeMode: 'local',
      runtimeCwd: bundle.runtimeContext.runtimeCwd,
      sandbox: bundle.sandbox,
      contributions: [contribution],
    })

    const observations = await runMatrix(bundle)
    assertMatrixObservations({ mode: 'local', bundle, observations, hostWorkspaceRoot: workspaceRoot })
  }, 120_000)
})

test('mocked Vercel runtime satisfies the unified cwd/PATH command matrix without private path leaks or command rewriting', async () => {
  const storageRoot = await makeTempDir('boring-runtime-matrix-vercel-storage-')
  const recorder = createMockVercelSandboxRecorder()
  const client: VercelSandboxClient = {
    create: vi.fn(async () => recorder.sandbox),
    get: vi.fn(),
  }
  const adapter = createVercelSandboxModeAdapter({
    store: await createStore(),
    vercelClient: client,
    logger: { info: vi.fn() },
    getEnvVar(name) {
      if (name === 'VERCEL_TOKEN') return 'token-1'
      if (name === 'VERCEL_TEAM_ID') return 'team-1'
      return undefined
    },
  })

  const bundle = await adapter.create({
    workspaceRoot: storageRoot,
    workspaceId: 'matrix-vercel-workspace',
    sessionId: 'matrix-vercel',
  })
  const observations = await runMatrix(bundle)

  assertMatrixObservations({ mode: 'vercel-sandbox', bundle, observations, hostWorkspaceRoot: storageRoot })
  const executedScripts = recorder.commands
    .map((entry) => (entry.cmd === 'sh' && entry.args[0] === '-c' ? entry.args[1] : null))
    .filter((entry): entry is string => entry != null)
  expect(executedScripts).toEqual(expect.arrayContaining(Object.values(MATRIX_COMMANDS)))
  expect(executedScripts).toContain(MATRIX_COMMANDS.literalCommand)
  expect(recorder.commands.filter((entry) => executedScripts.includes(entry.args[1] ?? ''))).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        cwd: '/workspace',
        env: expect.objectContaining({
          BORING_AGENT_WORKSPACE_ROOT: '/workspace',
          VIRTUAL_ENV: '/workspace/.boring-agent/venv',
        }),
      }),
    ]),
  )
})

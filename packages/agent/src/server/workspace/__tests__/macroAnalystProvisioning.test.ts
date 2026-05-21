import { execFile, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, posix } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, test } from 'vitest'

import type { ExecOptions, ExecResult, Sandbox } from '../../../shared/sandbox'
import type { Entry, Stat, Workspace } from '../../../shared/workspace'
import { createBwrapSandbox } from '../../sandbox/bwrap/createBwrapSandbox'
import { createNodeWorkspace } from '../createNodeWorkspace'
import { provisionRuntimeWorkspace, type RuntimeProvisioningContribution } from '../provisionRuntime'
import { getBoringAgentRuntimePaths } from '../runtimeLayout'

const execFileAsync = promisify(execFile)
const encoder = new TextEncoder()
const decoder = new TextDecoder()
const tempDirs: string[] = []
const MACRO_API_URL = 'https://macro.example.test/api'
const HAS_BWRAP = (() => {
  const result = spawnSync('bwrap', ['--version'], { stdio: 'ignore' })
  return !result.error && result.status === 0
})()

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

async function makeMacroPythonPackage(): Promise<string> {
  const sdkRoot = await makeTempDir('boring-macro-sdk-')
  await mkdir(join(sdkRoot, 'src', 'boring_macro_sdk'), { recursive: true })
  await mkdir(join(sdkRoot, 'transforms', 'builtins'), { recursive: true })
  await writeFile(
    join(sdkRoot, 'pyproject.toml'),
    [
      '[build-system]',
      'requires = ["setuptools>=68"]',
      'build-backend = "setuptools.build_meta"',
      '',
      '[project]',
      'name = "boring-macro-sdk"',
      'version = "0.0.0"',
      '',
      '[project.scripts]',
      'bm = "boring_macro_sdk.cli:main"',
      '',
      '[tool.setuptools.packages.find]',
      'where = ["src"]',
      '',
    ].join('\n'),
    'utf8',
  )
  await writeFile(join(sdkRoot, 'src', 'boring_macro_sdk', '__init__.py'), '__all__ = []\n', 'utf8')
  await writeFile(
    join(sdkRoot, 'src', 'boring_macro_sdk', 'cli.py'),
    String.raw`import argparse
import json
import os
from pathlib import Path


def list_tools(_args):
    print("builtin:yoy")
    print(f"api={os.environ.get('BORING_MACRO_API_URL', '')}")
    print(f"builtins={os.environ.get('BORING_MACRO_BUILTINS_ROOT', '')}")


def run_tool(args):
    if args.tool != "builtin:yoy":
        raise SystemExit(f"unknown tool: {args.tool}")
    workspace_root = Path(os.environ.get("BORING_AGENT_WORKSPACE_ROOT") or os.getcwd())
    output_dir = workspace_root / "artifacts"
    output_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "api_url": os.environ.get("BORING_MACRO_API_URL", ""),
        "input": args.input,
        "output": args.output,
        "title": args.title,
        "tool": args.tool,
    }
    (output_dir / f"{args.output}.json").write_text(json.dumps(payload, sort_keys=True) + "\n", encoding="utf-8")
    print(f"wrote {args.output}")


def main(argv=None):
    parser = argparse.ArgumentParser(prog="bm")
    subcommands = parser.add_subparsers(dest="command", required=True)
    list_parser = subcommands.add_parser("list")
    list_parser.set_defaults(func=list_tools)
    run_parser = subcommands.add_parser("run")
    run_parser.add_argument("--tool", required=True)
    run_parser.add_argument("--input", required=True)
    run_parser.add_argument("--output", required=True)
    run_parser.add_argument("--title", required=True)
    run_parser.set_defaults(func=run_tool)
    args = parser.parse_args(argv)
    args.func(args)
`,
    'utf8',
  )
  await writeFile(join(sdkRoot, 'transforms', 'builtins', 'yoy.py'), '# builtin:yoy fixture\n', 'utf8')
  return sdkRoot
}

async function makeMacroTemplate(): Promise<string> {
  const templateRoot = await makeTempDir('boring-macro-template-')
  await mkdir(join(templateRoot, '.agents', 'skills', 'macro'), { recursive: true })
  await mkdir(join(templateRoot, 'docs'), { recursive: true })
  await mkdir(join(templateRoot, 'seeds'), { recursive: true })
  await writeFile(join(templateRoot, '.agents', 'skills', 'macro', 'SKILL.md'), '# Macro skill\n', 'utf8')
  await writeFile(join(templateRoot, 'docs', 'macro.md'), '# Macro docs\n', 'utf8')
  await writeFile(join(templateRoot, 'seeds', 'series.json'), '["FYOIGDA188S"]\n', 'utf8')
  return templateRoot
}

async function makeMacroProvisioning(): Promise<{ sdkRoot: string; templateRoot: string; contribution: { id: string; provisioning: RuntimeProvisioningContribution } }> {
  const sdkRoot = await makeMacroPythonPackage()
  const templateRoot = await makeMacroTemplate()
  return {
    sdkRoot,
    templateRoot,
    contribution: {
      id: 'boring-macro',
      provisioning: {
        templateDirs: [{ id: 'macro-workspace-template', path: templateRoot, target: '.' }],
        python: [
          {
            id: 'boring-macro-sdk',
            projectFile: join(sdkRoot, 'pyproject.toml'),
            env: {
              BORING_MACRO_API_URL: MACRO_API_URL,
              BORING_MACRO_BUILTINS_ROOT: pathToFileURL(`${join(sdkRoot, 'transforms', 'builtins')}/`),
            },
          },
        ],
      },
    },
  }
}

async function expectMacroTemplateSeeded(workspaceRoot: string): Promise<void> {
  await expect(readFile(join(workspaceRoot, '.agents', 'skills', 'macro', 'SKILL.md'), 'utf8')).resolves.toContain('Macro skill')
  await expect(readFile(join(workspaceRoot, 'docs', 'macro.md'), 'utf8')).resolves.toContain('Macro docs')
  await expect(readFile(join(workspaceRoot, 'seeds', 'series.json'), 'utf8')).resolves.toContain('FYOIGDA188S')
}

test('MacroAnalyst bm is exposed from python[] console scripts and templates seed skills docs and seeds', async () => {
  const workspaceRoot = await makeTempDir('boring-macro-workspace-')
  const { sdkRoot, contribution } = await makeMacroProvisioning()

  const result = await provisionRuntimeWorkspace({
    workspaceRoot,
    runtimeMode: 'direct',
    runtimeCwd: workspaceRoot,
    contributions: [contribution],
  })

  expect(result.env.BORING_MACRO_API_URL).toBe(MACRO_API_URL)
  await expectMacroTemplateSeeded(workspaceRoot)

  const paths = getBoringAgentRuntimePaths(workspaceRoot)
  expect(result.env.BORING_MACRO_BUILTINS_ROOT).toBe(join(paths.sdk, 'python', 'boring-macro-sdk', 'transforms', 'builtins'))
  const bmShim = await readFile(join(paths.bin, 'bm'), 'utf8')
  expect(bmShim).toContain('TARGET="$VENV_BIN"')
  expect(bmShim).not.toContain(sdkRoot)

  const env = { ...process.env, PATH: `${paths.bin}:${process.env.PATH ?? ''}` }
  const list = await execFileAsync('bm', ['list'], { cwd: workspaceRoot, env })
  expect(list.stdout).toContain('builtin:yoy')
  expect(list.stdout).toContain(`api=${MACRO_API_URL}`)

  const run = await execFileAsync('bm', [
    'run',
    '--tool', 'builtin:yoy',
    '--input', 'FYOIGDA188S',
    '--output', 'FYOIGDA188S_YOY2',
    '--title', 'FYOIGDA188S YoY 2',
  ], { cwd: workspaceRoot, env })
  expect(run.stdout).toContain('wrote FYOIGDA188S_YOY2')
  await expect(readFile(join(workspaceRoot, 'artifacts', 'FYOIGDA188S_YOY2.json'), 'utf8')).resolves.toContain('FYOIGDA188S YoY 2')
}, 60_000)

const describeIfBwrap = HAS_BWRAP ? describe : describe.skip

describeIfBwrap('MacroAnalyst local/bwrap provisioning', () => {
  test('bm runs from the initial /workspace cwd with no host prefix', async () => {
    const workspaceRoot = await makeTempDir('boring-macro-bwrap-')
    const { contribution } = await makeMacroProvisioning()
    const runtimeContext = { runtimeCwd: '/workspace' }
    const workspace = createNodeWorkspace(workspaceRoot, { runtimeContext })
    const sandbox = createBwrapSandbox({ hostWorkspaceRoot: workspaceRoot, runtimeContext })
    await sandbox.init?.({ workspace, sessionId: 'macro-bwrap' })

    await provisionRuntimeWorkspace({
      workspaceRoot,
      runtimeMode: 'local',
      runtimeCwd: '/workspace',
      sandbox,
      contributions: [contribution],
    })

    const list = await sandbox.exec('bm list', { cwd: '/workspace', timeoutMs: 30_000 })
    const listOutput = decoder.decode(list.stdout)
    expect(list.exitCode).toBe(0)
    expect(listOutput).toContain('builtin:yoy')
    expect(listOutput).toContain('builtins=/workspace/.boring-agent/sdk/python/boring-macro-sdk/transforms/builtins')
    expect(listOutput).not.toContain(workspaceRoot)

    const run = await sandbox.exec([
      'bm run',
      '--tool builtin:yoy',
      '--input FYOIGDA188S',
      '--output FYOIGDA188S_YOY2',
      `--title ${shellQuote('FYOIGDA188S YoY 2')}`,
    ].join(' '), { cwd: '/workspace', timeoutMs: 30_000 })
    expect(run.exitCode).toBe(0)
    expect(decoder.decode(run.stdout)).toContain('wrote FYOIGDA188S_YOY2')
    await expect(readFile(join(workspaceRoot, 'artifacts', 'FYOIGDA188S_YOY2.json'), 'utf8')).resolves.toContain('FYOIGDA188S')
  }, 60_000)
})

function okResult(): ExecResult {
  return {
    stdout: new Uint8Array(),
    stderr: new Uint8Array(),
    exitCode: 0,
    durationMs: 0,
    truncated: false,
    stdoutEncoding: 'utf-8',
    stderrEncoding: 'utf-8',
  }
}

class MemoryWorkspace implements Workspace {
  readonly root = '/workspace'
  readonly runtimeContext = { runtimeCwd: '/workspace' }
  readonly fsCapability = 'best-effort' as const
  readonly files = new Map<string, Uint8Array>()
  readonly dirs = new Set<string>(['.'])

  private normalize(path: string): string {
    const normalized = posix.normalize(path || '.')
    return normalized === '.' ? '.' : normalized.replace(/^\.\//, '')
  }

  private mkdirSync(path: string): void {
    const normalized = this.normalize(path)
    if (normalized === '.') {
      this.dirs.add('.')
      return
    }
    let current = ''
    for (const part of normalized.split('/')) {
      current = current ? `${current}/${part}` : part
      this.dirs.add(current)
    }
  }

  private ensureParent(path: string): void {
    this.mkdirSync(this.normalize(posix.dirname(path)))
  }

  async readFile(path: string): Promise<string> {
    const data = this.files.get(this.normalize(path))
    if (!data) throw new Error('not found')
    return decoder.decode(data)
  }

  async readBinaryFile(path: string): Promise<Uint8Array> {
    const data = this.files.get(this.normalize(path))
    if (!data) throw new Error('not found')
    return data
  }

  async writeFile(path: string, data: string): Promise<void> {
    const normalized = this.normalize(path)
    this.ensureParent(normalized)
    this.files.set(normalized, encoder.encode(data))
  }

  async writeBinaryFile(path: string, data: Uint8Array): Promise<void> {
    const normalized = this.normalize(path)
    this.ensureParent(normalized)
    this.files.set(normalized, data)
  }

  async unlink(path: string): Promise<void> {
    this.files.delete(this.normalize(path))
  }

  removeTree(path: string): void {
    const normalized = this.normalize(path)
    const prefix = normalized === '.' ? '' : `${normalized}/`
    for (const file of Array.from(this.files.keys())) {
      if (file === normalized || file.startsWith(prefix)) this.files.delete(file)
    }
    for (const dir of Array.from(this.dirs)) {
      if (dir === normalized || dir.startsWith(prefix)) this.dirs.delete(dir)
    }
  }

  async readdir(path: string): Promise<Entry[]> {
    const normalized = this.normalize(path)
    if (!this.dirs.has(normalized)) throw new Error('not found')
    const prefix = normalized === '.' ? '' : `${normalized}/`
    const entries = new Map<string, Entry>()
    for (const dir of this.dirs) {
      if (dir === normalized || !dir.startsWith(prefix)) continue
      const name = dir.slice(prefix.length).split('/')[0]
      entries.set(name, { name, kind: 'dir' })
    }
    for (const file of this.files.keys()) {
      if (!file.startsWith(prefix)) continue
      const rest = file.slice(prefix.length)
      const name = rest.split('/')[0]
      if (!entries.has(name)) entries.set(name, { name, kind: rest.includes('/') ? 'dir' : 'file' })
    }
    return Array.from(entries.values()).sort((a, b) => a.name.localeCompare(b.name))
  }

  async stat(path: string): Promise<Stat> {
    const normalized = this.normalize(path)
    const data = this.files.get(normalized)
    if (data) return { kind: 'file', size: data.byteLength, mtimeMs: 0 }
    if (this.dirs.has(normalized)) return { kind: 'dir', size: 0, mtimeMs: 0 }
    throw new Error('not found')
  }

  async mkdir(path: string): Promise<void> {
    this.mkdirSync(path)
  }

  async rename(fromRelPath: string, toRelPath: string): Promise<void> {
    const from = this.normalize(fromRelPath)
    const to = this.normalize(toRelPath)
    const data = this.files.get(from)
    if (!data) throw new Error('not found')
    this.ensureParent(to)
    this.files.set(to, data)
    this.files.delete(from)
  }
}

function createMockVercelSandbox(workspace: MemoryWorkspace): Sandbox & { history: Array<{ cmd: string; opts?: ExecOptions }> } {
  const history: Array<{ cmd: string; opts?: ExecOptions }> = []
  return {
    id: 'vercel-sandbox',
    placement: 'remote',
    provider: 'vercel-sandbox',
    capabilities: ['exec'],
    runtimeContext: { runtimeCwd: '/workspace' },
    history,
    async exec(cmd, opts) {
      history.push({ cmd, opts: opts ? { ...opts, env: opts.env ? { ...opts.env } : undefined } : undefined })
      if (cmd.includes('rm -rf --') && cmd.includes('/workspace/.boring-agent/sdk/python/boring-macro-sdk')) {
        workspace.removeTree('.boring-agent/sdk/python/boring-macro-sdk')
      }
      if (cmd.includes('pip install') && cmd.includes('/workspace/.boring-agent/sdk/python/boring-macro-sdk')) {
        await workspace.writeFile('.boring-agent/venv/bin/bm', '#!/workspace/.boring-agent/venv/bin/python\n')
      }
      return okResult()
    },
  }
}

test('MacroAnalyst Vercel provisioning uses templateDirs and remote python[] SDK paths', async () => {
  const storageRoot = await makeTempDir('boring-macro-vercel-storage-')
  const { sdkRoot, contribution } = await makeMacroProvisioning()
  const workspace = new MemoryWorkspace()
  await workspace.writeFile('.boring-agent/sdk/python/boring-macro-sdk/stale.py', '# stale source that must be cleared\n')
  const sandbox = createMockVercelSandbox(workspace)

  const result = await provisionRuntimeWorkspace({
    workspaceRoot: storageRoot,
    storageRoot,
    runtimeMode: 'vercel-sandbox',
    runtimeCwd: '/workspace',
    workspace,
    sandbox,
    contributions: [contribution],
  })

  expect(result.binDir).toBe('/workspace/.boring-agent/bin')
  expect(result.env.BORING_MACRO_API_URL).toBe(MACRO_API_URL)
  expect(result.env.BORING_MACRO_BUILTINS_ROOT).toBe('/workspace/.boring-agent/sdk/python/boring-macro-sdk/transforms/builtins')
  await expect(workspace.readFile('.agents/skills/macro/SKILL.md')).resolves.toContain('Macro skill')
  await expect(workspace.readFile('docs/macro.md')).resolves.toContain('Macro docs')
  await expect(workspace.readFile('seeds/series.json')).resolves.toContain('FYOIGDA188S')
  await expect(workspace.readFile('.boring-agent/sdk/python/boring-macro-sdk/pyproject.toml')).resolves.toContain('boring-macro-sdk')
  await expect(workspace.readFile('.boring-agent/sdk/python/boring-macro-sdk/stale.py')).rejects.toThrow('not found')
  const bmShim = await workspace.readFile('.boring-agent/bin/bm')
  expect(bmShim).toContain('TARGET="$VENV_BIN"')
  expect(bmShim).not.toContain(sdkRoot)
  expect(sandbox.history.every((entry) => entry.opts?.cwd === '/workspace')).toBe(true)
  expect(sandbox.history.some((entry) => entry.cmd.includes('rm -rf --') && entry.cmd.includes('/workspace/.boring-agent/sdk/python/boring-macro-sdk'))).toBe(true)
  expect(sandbox.history.some((entry) => entry.cmd.includes('uv pip install --python') && entry.cmd.includes('/workspace/.boring-agent/venv/bin/python'))).toBe(true)
  expect(sandbox.history.some((entry) => entry.cmd.includes('/workspace/.boring-agent/sdk/python/boring-macro-sdk'))).toBe(true)
})

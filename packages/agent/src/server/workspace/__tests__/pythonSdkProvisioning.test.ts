import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, posix } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, expect, test } from 'vitest'

import type { ExecOptions, ExecResult, Sandbox } from '../../../shared/sandbox'
import type { Entry, Stat, Workspace } from '../../../shared/workspace'
import { provisionRuntimeWorkspace, type RuntimeProvisioningContribution } from '../provisionRuntime'
import { getBoringAgentRuntimePaths } from '../runtimeLayout'

const execFileAsync = promisify(execFile)
const encoder = new TextEncoder()
const decoder = new TextDecoder()
const tempDirs: string[] = []
const FIXTURE_API_URL = 'https://fixture.example.test/api'
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function makeFixturePythonPackage(): Promise<string> {
  const sdkRoot = await makeTempDir('boring-fixture-sdk-')
  await mkdir(join(sdkRoot, 'src', 'boring_fixture_sdk'), { recursive: true })
  await mkdir(join(sdkRoot, 'transforms', 'builtins'), { recursive: true })
  await writeFile(
    join(sdkRoot, 'pyproject.toml'),
    [
      '[build-system]',
      'requires = ["setuptools>=68"]',
      'build-backend = "setuptools.build_meta"',
      '',
      '[project]',
      'name = "boring-fixture-sdk"',
      'version = "0.0.0"',
      '',
      '[project.scripts]',
      'fixture-tool = "boring_fixture_sdk.cli:main"',
      '',
      '[tool.setuptools.packages.find]',
      'where = ["src"]',
      '',
    ].join('\n'),
    'utf8',
  )
  await writeFile(join(sdkRoot, 'src', 'boring_fixture_sdk', '__init__.py'), '__all__ = []\n', 'utf8')
  await writeFile(
    join(sdkRoot, 'src', 'boring_fixture_sdk', 'cli.py'),
    String.raw`import argparse
import json
import os
from pathlib import Path


def list_tools(_args):
    print("builtin:echo")
    print(f"api={os.environ.get('BORING_FIXTURE_API_URL', '')}")
    print(f"assets={os.environ.get('BORING_FIXTURE_ASSETS_ROOT', '')}")


def run_tool(args):
    if args.tool != "builtin:echo":
        raise SystemExit(f"unknown tool: {args.tool}")
    workspace_root = Path(os.environ.get("BORING_AGENT_WORKSPACE_ROOT") or os.getcwd())
    output_dir = workspace_root / "artifacts"
    output_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "api_url": os.environ.get("BORING_FIXTURE_API_URL", ""),
        "input": args.input,
        "output": args.output,
        "title": args.title,
        "tool": args.tool,
    }
    (output_dir / f"{args.output}.json").write_text(json.dumps(payload, sort_keys=True) + "\n", encoding="utf-8")
    print(f"wrote {args.output}")


def main(argv=None):
    parser = argparse.ArgumentParser(prog="fixture-tool")
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
  await writeFile(join(sdkRoot, 'transforms', 'builtins', 'echo.py'), '# builtin:echo fixture\n', 'utf8')
  return sdkRoot
}

async function makeFixtureTemplate(): Promise<string> {
  const templateRoot = await makeTempDir('boring-fixture-template-')
  await mkdir(join(templateRoot, '.agents', 'skills', 'fixture'), { recursive: true })
  await mkdir(join(templateRoot, 'docs'), { recursive: true })
  await mkdir(join(templateRoot, 'seeds'), { recursive: true })
  await writeFile(join(templateRoot, '.agents', 'skills', 'fixture', 'SKILL.md'), '# Fixture skill\n', 'utf8')
  await writeFile(join(templateRoot, 'docs', 'fixture.md'), '# Fixture docs\n', 'utf8')
  await writeFile(join(templateRoot, 'seeds', 'series.json'), '["fixture-input"]\n', 'utf8')
  return templateRoot
}

async function makeFixtureProvisioning(): Promise<{ sdkRoot: string; templateRoot: string; contribution: { id: string; provisioning: RuntimeProvisioningContribution } }> {
  const sdkRoot = await makeFixturePythonPackage()
  const templateRoot = await makeFixtureTemplate()
  return {
    sdkRoot,
    templateRoot,
    contribution: {
      id: 'boring-fixture',
      provisioning: {
        templateDirs: [{ id: 'fixture-workspace-template', path: templateRoot, target: '.' }],
        python: [
          {
            id: 'boring-fixture-sdk',
            projectFile: join(sdkRoot, 'pyproject.toml'),
            env: {
              BORING_FIXTURE_API_URL: FIXTURE_API_URL,
              BORING_FIXTURE_ASSETS_ROOT: pathToFileURL(`${join(sdkRoot, 'transforms', 'builtins')}/`),
            },
          },
        ],
      },
    },
  }
}

async function expectFixtureTemplateSeeded(workspaceRoot: string): Promise<void> {
  await expect(readFile(join(workspaceRoot, '.agents', 'skills', 'fixture', 'SKILL.md'), 'utf8')).resolves.toContain('Fixture skill')
  await expect(readFile(join(workspaceRoot, 'docs', 'fixture.md'), 'utf8')).resolves.toContain('Fixture docs')
  await expect(readFile(join(workspaceRoot, 'seeds', 'series.json'), 'utf8')).resolves.toContain('fixture-input')
}

test('python[] console scripts are exposed and templates seed skills docs and seeds', async () => {
  const workspaceRoot = await makeTempDir('boring-fixture-workspace-')
  const { sdkRoot, contribution } = await makeFixtureProvisioning()

  const result = await provisionRuntimeWorkspace({
    workspaceRoot,
    runtimeMode: 'direct',
    runtimeCwd: workspaceRoot,
    contributions: [contribution],
  })

  expect(result.env.BORING_FIXTURE_API_URL).toBe(FIXTURE_API_URL)
  await expectFixtureTemplateSeeded(workspaceRoot)

  const paths = getBoringAgentRuntimePaths(workspaceRoot)
  expect(result.env.BORING_FIXTURE_ASSETS_ROOT).toBe(join(paths.sdk, 'python', 'boring-fixture-sdk', 'transforms', 'builtins'))
  const fixtureToolShim = await readFile(join(paths.bin, 'fixture-tool'), 'utf8')
  expect(fixtureToolShim).toContain('TARGET="$VENV_BIN"')
  expect(fixtureToolShim).not.toContain(sdkRoot)

  const env = { ...process.env, PATH: `${paths.bin}:${process.env.PATH ?? ''}` }
  const list = await execFileAsync('fixture-tool', ['list'], { cwd: workspaceRoot, env })
  expect(list.stdout).toContain('builtin:echo')
  expect(list.stdout).toContain(`api=${FIXTURE_API_URL}`)

  const run = await execFileAsync('fixture-tool', [
    'run',
    '--tool', 'builtin:echo',
    '--input', 'fixture-input',
    '--output', 'fixture-output',
    '--title', 'Fixture Output',
  ], { cwd: workspaceRoot, env })
  expect(run.stdout).toContain('wrote fixture-output')
  await expect(readFile(join(workspaceRoot, 'artifacts', 'fixture-output.json'), 'utf8')).resolves.toContain('Fixture Output')

  await provisionRuntimeWorkspace({ workspaceRoot, force: true, contributions: [] })
  await expect(stat(join(paths.bin, 'fixture-tool'))).rejects.toThrow()
  await expect(stat(join(paths.bin, 'python'))).rejects.toThrow()
  await expect(stat(join(paths.bin, 'pip'))).rejects.toThrow()
}, 60_000)

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

function notFound(path: string): NodeJS.ErrnoException {
  const error = new Error(`not found: ${path}`) as NodeJS.ErrnoException
  error.code = 'ENOENT'
  return error
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
    const normalized = this.normalize(path)
    const data = this.files.get(normalized)
    if (!data) throw notFound(normalized)
    return decoder.decode(data)
  }

  async readBinaryFile(path: string): Promise<Uint8Array> {
    const normalized = this.normalize(path)
    const data = this.files.get(normalized)
    if (!data) throw notFound(normalized)
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
    if (!this.dirs.has(normalized)) throw notFound(normalized)
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
    throw notFound(normalized)
  }

  async mkdir(path: string): Promise<void> {
    this.mkdirSync(path)
  }

  async rename(fromRelPath: string, toRelPath: string): Promise<void> {
    const from = this.normalize(fromRelPath)
    const to = this.normalize(toRelPath)
    const data = this.files.get(from)
    if (!data) throw notFound(from)
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
      if (cmd.includes('rm -rf --') && cmd.includes('/workspace/.boring-agent/sdk/python/boring-fixture-sdk')) {
        workspace.removeTree('.boring-agent/sdk/python/boring-fixture-sdk')
      }
      if (cmd.includes('pip install') && cmd.includes('/workspace/.boring-agent/sdk/python/boring-fixture-sdk')) {
        await workspace.writeFile('.boring-agent/venv/bin/fixture-tool', '#!/workspace/.boring-agent/venv/bin/python\n')
      }
      return okResult()
    },
  }
}

test('vercel provisioning uses templateDirs and remote python[] SDK paths', async () => {
  const storageRoot = await makeTempDir('boring-fixture-vercel-storage-')
  const { sdkRoot, contribution } = await makeFixtureProvisioning()
  const workspace = new MemoryWorkspace()
  await workspace.writeFile('.boring-agent/sdk/python/boring-fixture-sdk/stale.py', '# stale source that must be cleared\n')
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
  expect(result.env.BORING_FIXTURE_API_URL).toBe(FIXTURE_API_URL)
  expect(result.env.BORING_FIXTURE_ASSETS_ROOT).toBe('/workspace/.boring-agent/sdk/python/boring-fixture-sdk/transforms/builtins')
  await expect(workspace.readFile('.agents/skills/fixture/SKILL.md')).resolves.toContain('Fixture skill')
  await expect(workspace.readFile('docs/fixture.md')).resolves.toContain('Fixture docs')
  await expect(workspace.readFile('seeds/series.json')).resolves.toContain('fixture-input')
  await expect(workspace.readFile('.boring-agent/sdk/python/boring-fixture-sdk/pyproject.toml')).resolves.toContain('boring-fixture-sdk')
  await expect(workspace.readFile('.boring-agent/sdk/python/boring-fixture-sdk/stale.py')).rejects.toThrow('not found')
  const fixtureToolShim = await workspace.readFile('.boring-agent/bin/fixture-tool')
  expect(fixtureToolShim).toContain('TARGET="$VENV_BIN"')
  expect(fixtureToolShim).not.toContain(sdkRoot)
  expect(sandbox.history.every((entry) => entry.opts?.cwd === '/workspace')).toBe(true)
  expect(sandbox.history.some((entry) => entry.cmd.includes('rm -rf --') && entry.cmd.includes('/workspace/.boring-agent/sdk/python/boring-fixture-sdk'))).toBe(true)
  expect(sandbox.history.some((entry) => entry.cmd.includes('uv pip install --python') && entry.cmd.includes('/workspace/.boring-agent/venv/bin/python'))).toBe(true)
  expect(sandbox.history.some((entry) => entry.cmd.includes('/workspace/.boring-agent/sdk/python/boring-fixture-sdk'))).toBe(true)
})

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, posix } from 'node:path'
import { afterEach, expect, test } from 'vitest'

import type { ExecOptions, ExecResult, Sandbox } from '../../../shared/sandbox'
import type { Entry, Stat, Workspace } from '../../../shared/workspace'
import { provisionRuntimeWorkspace } from '../provisionRuntime'
import { getBoringAgentRuntimePaths } from '../runtimeLayout'

const tempDirs: string[] = []
const encoder = new TextEncoder()
const decoder = new TextDecoder()

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

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

function createRecordingSandbox(provider: string, placement: Sandbox['placement']): Sandbox & { history: Array<{ cmd: string; opts?: ExecOptions }> } {
  const history: Array<{ cmd: string; opts?: ExecOptions }> = []
  return {
    id: provider,
    placement,
    provider,
    capabilities: ['exec'],
    runtimeContext: { runtimeCwd: '/workspace' },
    history,
    async exec(cmd, opts) {
      history.push({ cmd, opts: opts ? { ...opts, env: opts.env ? { ...opts.env } : undefined } : undefined })
      return okResult()
    },
  }
}

class MemoryWorkspace implements Workspace {
  readonly root = '/workspace'
  readonly runtimeContext = { runtimeCwd: '/workspace' }
  readonly files = new Map<string, Uint8Array>()
  readonly dirs = new Set<string>(['.'])
  readonly fsCapability = 'best-effort' as const

  private normalize(path: string): string {
    const normalized = posix.normalize(path || '.')
    return normalized === '.' ? '.' : normalized.replace(/^\.\//, '')
  }

  private ensureParent(path: string): void {
    const parent = this.normalize(posix.dirname(path))
    this.mkdirSync(parent)
  }

  private mkdirSync(path: string): void {
    const normalized = this.normalize(path)
    if (normalized === '.') {
      this.dirs.add('.')
      return
    }
    const parts = normalized.split('/')
    let current = ''
    for (const part of parts) {
      current = current ? `${current}/${part}` : part
      this.dirs.add(current)
    }
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

  async readdir(path: string): Promise<Entry[]> {
    const normalized = this.normalize(path)
    if (!this.dirs.has(normalized)) throw new Error('not found')
    const prefix = normalized === '.' ? '' : `${normalized}/`
    const entries = new Map<string, Entry>()
    for (const dir of this.dirs) {
      if (dir === normalized || !dir.startsWith(prefix)) continue
      const rest = dir.slice(prefix.length)
      const name = rest.split('/')[0]
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
    const file = this.files.get(normalized)
    if (file) return { kind: 'file', size: file.byteLength, mtimeMs: 0 }
    if (this.dirs.has(normalized)) return { kind: 'dir', size: 0, mtimeMs: 0 }
    throw new Error('not found')
  }

  async mkdir(path: string): Promise<void> {
    this.mkdirSync(path)
  }

  async rename(fromRelPath: string, toRelPath: string): Promise<void> {
    const from = this.normalize(fromRelPath)
    const to = this.normalize(toRelPath)
    const file = this.files.get(from)
    if (!file) throw new Error('not found')
    this.ensureParent(to)
    this.files.set(to, file)
    this.files.delete(from)
  }
}

test('direct provisioning records direct runtime state without sandbox validation', async () => {
  const workspaceRoot = await makeTempDir('boring-runtime-direct-')

  const result = await provisionRuntimeWorkspace({
    workspaceRoot,
    runtimeMode: 'direct',
    runtimeCwd: workspaceRoot,
    contributions: [],
  })

  const paths = getBoringAgentRuntimePaths(workspaceRoot)
  expect(result.binDir).toBe(paths.bin)
  const marker = JSON.parse(await readFile(paths.provisioningMarker, 'utf8')) as { runtimeMode?: string; runtimeCwd?: string }
  expect(marker.runtimeMode).toBe('direct')
  expect(marker.runtimeCwd).toBe(workspaceRoot)
})

test('local provisioning validates provisioned artifacts through the bwrap sandbox cwd', async () => {
  const workspaceRoot = await makeTempDir('boring-runtime-local-')
  const packageRoot = join(workspaceRoot, 'pkg')
  await mkdir(packageRoot, { recursive: true })
  await writeFile(join(packageRoot, 'package.json'), '{"name":"@example/pkg","version":"0.0.0"}\n', 'utf8')
  const pythonRoot = join(workspaceRoot, 'py')
  await mkdir(pythonRoot, { recursive: true })
  await writeFile(join(pythonRoot, 'pyproject.toml'), '[project]\nname = "local-py"\nversion = "0.0.0"\n', 'utf8')
  const sandbox = createRecordingSandbox('bwrap', 'server')

  await provisionRuntimeWorkspace({
    workspaceRoot,
    runtimeMode: 'local',
    runtimeCwd: '/workspace',
    sandbox,
    contributions: [
      {
        id: 'pkg',
        provisioning: {
          nodePackages: [{ id: 'pkg', packageName: '@example/pkg', packageRoot }],
          python: [{ id: 'py', projectFile: join(pythonRoot, 'pyproject.toml') }],
        },
      },
    ],
  })

  expect(sandbox.history.some((entry) => entry.opts?.cwd === '/workspace' && entry.cmd.includes('test -e'))).toBe(true)
  expect(sandbox.history.some((entry) => entry.cmd.includes('.boring-agent/node/node_modules/@example/pkg/package.json'))).toBe(true)
  expect(sandbox.history.some((entry) => entry.cmd.includes('/workspace/.boring-agent/venv/bin/python'))).toBe(true)
  expect(sandbox.history.some((entry) => entry.cmd.includes('python --version') && entry.cmd.includes('pip3 --version'))).toBe(true)
  const marker = JSON.parse(await readFile(getBoringAgentRuntimePaths(workspaceRoot).provisioningMarker, 'utf8')) as { runtimeMode?: string; runtimeCwd?: string }
  expect(marker.runtimeMode).toBe('local')
  expect(marker.runtimeCwd).toBe('/workspace')
}, 20_000)

test('vercel provisioning writes runtime artifacts through the remote workspace and sandbox cwd', async () => {
  const storageRoot = await makeTempDir('boring-runtime-vercel-storage-')
  const packageRoot = await makeTempDir('boring-runtime-vercel-package-')
  await mkdir(join(packageRoot, 'dist'), { recursive: true })
  await writeFile(join(packageRoot, 'package.json'), '{"name":"@example/remote","version":"0.0.0"}\n', 'utf8')
  await writeFile(join(packageRoot, 'dist', 'index.js'), 'export {}\n', 'utf8')
  const templateRoot = await makeTempDir('boring-runtime-vercel-template-')
  await writeFile(join(templateRoot, 'README.md'), '# remote\n', 'utf8')
  const pythonRoot = await makeTempDir('boring-runtime-vercel-python-')
  await mkdir(join(pythonRoot, 'data'), { recursive: true })
  await writeFile(join(pythonRoot, 'pyproject.toml'), '[project]\nname = "remote-py"\nversion = "0.0.0"\n', 'utf8')
  await writeFile(join(pythonRoot, 'data', 'config.json'), '{}\n', 'utf8')
  const workspace = new MemoryWorkspace()
  const sandbox = createRecordingSandbox('vercel-sandbox', 'remote')

  const result = await provisionRuntimeWorkspace({
    workspaceRoot: storageRoot,
    storageRoot,
    runtimeMode: 'vercel-sandbox',
    runtimeCwd: '/workspace',
    workspace,
    sandbox,
    contributions: [
      {
        id: 'remote',
        provisioning: {
          templateDirs: [{ id: 'template', path: templateRoot }],
          nodePackages: [{ id: 'remote', packageName: '@example/remote', packageRoot }],
          python: [{
            id: 'py',
            projectFile: join(pythonRoot, 'pyproject.toml'),
            env: { REMOTE_PY_DATA: new URL(`file://${join(pythonRoot, 'data')}/`) },
          }],
        },
      },
    ],
  })

  expect(result.binDir).toBe('/workspace/.boring-agent/bin')
  expect(result.env.REMOTE_PY_DATA).toBe('/workspace/.boring-agent/sdk/python/py/data')
  await expect(workspace.readFile('README.md')).resolves.toBe('# remote\n')
  await expect(workspace.readFile('.boring-agent/node/node_modules/@example/remote/package.json')).resolves.toContain('@example/remote')
  await expect(workspace.readFile('.boring-agent/sdk/python/py/pyproject.toml')).resolves.toContain('remote-py')
  const marker = JSON.parse(await workspace.readFile('.boring-agent/state/provisioning.json')) as { runtimeMode?: string; runtimeCwd?: string }
  expect(marker.runtimeMode).toBe('vercel-sandbox')
  expect(marker.runtimeCwd).toBe('/workspace')
  expect(sandbox.history.every((entry) => entry.opts?.cwd === '/workspace')).toBe(true)
  expect(sandbox.history.some((entry) => entry.cmd.includes('python3 -m venv --copies') && entry.cmd.includes('/workspace/.boring-agent/tmp/venv-'))).toBe(true)
  expect(sandbox.history.some((entry) => entry.cmd.includes('uv pip install --python') && entry.cmd.includes('/workspace/.boring-agent/venv/bin/python'))).toBe(true)
  expect(sandbox.history.some((entry) => entry.cmd.includes('/workspace/.boring-agent/venv/bin/python') && entry.cmd.includes('pip3 --version'))).toBe(true)
  expect(sandbox.history.some((entry) => entry.cmd.includes('UV_CACHE_DIR=') && entry.cmd.includes('/workspace/.boring-agent/cache/python'))).toBe(true)
  await expect(stat(join(storageRoot, '.boring-agent'))).rejects.toThrow()
})

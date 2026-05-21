import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, expect, test } from 'vitest'

import { withWorkspacePythonEnv } from '../../sandbox/workspacePythonEnv'
import { provisionRuntimeWorkspace } from '../provisionRuntime'
import {
  ensureBoringAgentRuntimeLayout,
  getBoringAgentRuntimePaths,
  writeBoringAgentOwnershipMarker,
} from '../runtimeLayout'

const execFileAsync = promisify(execFile)

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

test('provisionRuntimeWorkspace writes current marker under .boring-agent/state', async () => {
  const workspaceRoot = await makeTempDir('boring-runtime-marker-')
  const result = await provisionRuntimeWorkspace({ workspaceRoot, contributions: [] })
  const paths = getBoringAgentRuntimePaths(workspaceRoot)

  expect(result.binDir).toBe(paths.bin)
  await expect(readFile(paths.provisioningMarker, 'utf8')).resolves.toContain(result.fingerprint)
  await expect(readFile(paths.ownershipManifest, 'utf8')).resolves.toContain('.boring-agent/bin')
})

test('provisionRuntimeWorkspace reads legacy marker and migrates it to state marker', async () => {
  const workspaceRoot = await makeTempDir('boring-runtime-legacy-marker-')
  const first = await provisionRuntimeWorkspace({ workspaceRoot, contributions: [] })
  const paths = getBoringAgentRuntimePaths(workspaceRoot)
  const marker = await readFile(paths.provisioningMarker, 'utf8')

  await rm(paths.provisioningMarker)
  await writeFile(paths.legacyProvisioningMarker, marker, 'utf8')

  const second = await provisionRuntimeWorkspace({ workspaceRoot, contributions: [] })

  expect(second.changed).toBe(false)
  expect(second.fingerprint).toBe(first.fingerprint)
  await expect(readFile(paths.provisioningMarker, 'utf8')).resolves.toContain(first.fingerprint)
})

test('workspace python env ignores old top-level .venv for agent runtime tools', () => {
  const env = withWorkspacePythonEnv({
    workspaceRoot: '/workspace',
    env: { PATH: '/workspace/.venv/bin:/usr/bin', VIRTUAL_ENV: '/workspace/.venv' },
  })

  expect(env.PATH?.split(':')).toEqual([
    '/workspace/.boring-agent/bin',
    '/workspace/.boring-agent/venv/bin',
    '/usr/bin',
  ])
  expect(env.PATH).not.toContain('/workspace/.venv/bin')
  expect(env.VIRTUAL_ENV).toBe('/workspace/.boring-agent/venv')
})

test('workspace python env forces runtime roots before plugin PATH additions', () => {
  const env = withWorkspacePythonEnv({
    workspaceRoot: '/workspace',
    env: {
      BORING_AGENT_WORKSPACE_ROOT: '/evil',
      HOME: '/evil-home',
      PATH: '/plugin/bin:/workspace/.boring-agent/bin:/usr/bin',
      PYTHONHOME: '/evil-python-home',
      VIRTUAL_ENV: '/evil-venv',
    },
  })

  expect(env.BORING_AGENT_WORKSPACE_ROOT).toBe('/workspace')
  expect(env.HOME).toBe('/workspace')
  expect(env.VIRTUAL_ENV).toBe('/workspace/.boring-agent/venv')
  expect(env.PYTHONHOME).toBeUndefined()
  expect(env.PATH?.split(':')).toEqual([
    '/workspace/.boring-agent/bin',
    '/workspace/.boring-agent/venv/bin',
    '/plugin/bin',
    '/usr/bin',
  ])
})

test('provisioning rejects plugin env overrides for managed runtime keys', async () => {
  const workspaceRoot = await makeTempDir('boring-runtime-reserved-env-')

  await expect(provisionRuntimeWorkspace({
    workspaceRoot,
    contributions: [
      {
        id: 'bad-env',
        provisioning: {
          python: [
            {
              id: 'bad-python',
              projectFile: join(workspaceRoot, 'pyproject.toml'),
              env: { VIRTUAL_ENV: '/plugin-venv' },
            },
          ],
        },
      },
    ],
  })).rejects.toThrow('Provisioning env key VIRTUAL_ENV is reserved')
})

test('unowned top-level .venv is left in place during runtime layout migration', async () => {
  const workspaceRoot = await makeTempDir('boring-runtime-unowned-venv-')
  const oldVenv = join(workspaceRoot, '.venv')
  await mkdir(join(oldVenv, 'bin'), { recursive: true })
  await writeFile(join(oldVenv, 'bin', 'python'), '# user venv\n', 'utf8')

  await provisionRuntimeWorkspace({ workspaceRoot, contributions: [] })

  await expect(readFile(join(oldVenv, 'bin', 'python'), 'utf8')).resolves.toBe('# user venv\n')
})

test('owned top-level .venv is removed during runtime layout migration', async () => {
  const workspaceRoot = await makeTempDir('boring-runtime-owned-venv-')
  const paths = await ensureBoringAgentRuntimeLayout(workspaceRoot)
  await mkdir(paths.legacyTopLevelVenv, { recursive: true })
  await writeBoringAgentOwnershipMarker(paths.legacyTopLevelVenv, '.venv', 'legacy-runtime-dir')

  await provisionRuntimeWorkspace({ workspaceRoot, contributions: [] })

  await expect(stat(paths.legacyTopLevelVenv)).rejects.toThrow()
})

async function makeNodePackageRoot(packageName: string, bin?: Record<string, string>): Promise<string> {
  const packageRoot = await makeTempDir('boring-runtime-node-pkg-')
  await writeFile(join(packageRoot, 'package.json'), `${JSON.stringify({ name: packageName, version: '0.0.0', ...(bin ? { bin } : {}) })}\n`, 'utf8')
  return packageRoot
}

async function makeRunnableNodePackageRoot(packageName: string, binName: string): Promise<string> {
  const packageRoot = await makeNodePackageRoot(packageName, { [binName]: 'dist/index.js' })
  await mkdir(join(packageRoot, 'dist'), { recursive: true })
  await writeFile(
    join(packageRoot, 'dist', 'index.js'),
    '#!/usr/bin/env node\nif (process.argv.includes("--help")) { process.stdout.write("runnable help\\n"); } else { process.stdout.write("runnable ok\\n"); }\n',
    'utf8',
  )
  return packageRoot
}

test('template targets must stay inside the workspace', async () => {
  const workspaceRoot = await makeTempDir('boring-runtime-template-escape-')
  const templateRoot = await makeTempDir('boring-runtime-template-source-')
  await writeFile(join(templateRoot, 'seed.txt'), 'seed\n', 'utf8')

  await expect(provisionRuntimeWorkspace({
    workspaceRoot,
    contributions: [{ id: 'template', provisioning: { templateDirs: [{ id: 'escape', path: templateRoot, target: '../outside' }] } }],
  })).rejects.toThrow('templateDirs.escape.target must stay inside the workspace')
})

test('python bin manifest cleanup ignores unsafe corrupted bin names', async () => {
  const workspaceRoot = await makeTempDir('boring-runtime-python-manifest-')
  const paths = await ensureBoringAgentRuntimeLayout(workspaceRoot)
  const outside = join(workspaceRoot, 'outside.txt')
  await writeFile(outside, 'keep\n', 'utf8')
  await writeFile(join(paths.bin, 'python'), '# stale python shim\n', 'utf8')
  await writeFile(join(paths.state, 'python-bins.json'), JSON.stringify({ bins: ['python', '../../outside.txt'] }), 'utf8')

  await provisionRuntimeWorkspace({ workspaceRoot, force: true, contributions: [] })

  await expect(stat(join(paths.bin, 'python'))).rejects.toThrow()
  await expect(readFile(outside, 'utf8')).resolves.toBe('keep\n')
})

test('node-only provisioning does not install broken managed python or pip shims', async () => {
  const workspaceRoot = await makeTempDir('boring-runtime-node-only-')
  const packageRoot = await makeRunnableNodePackageRoot('@example/boring-ui', 'boring-ui')

  await provisionRuntimeWorkspace({
    workspaceRoot,
    contributions: [{ id: 'tool', provisioning: { nodePackages: [{ id: 'tool', packageName: '@example/boring-ui', packageRoot }] } }],
  })
  const paths = getBoringAgentRuntimePaths(workspaceRoot)

  await expect(stat(join(paths.bin, 'python'))).rejects.toThrow()
  await expect(stat(join(paths.bin, 'python3'))).rejects.toThrow()
  await expect(stat(join(paths.bin, 'pip'))).rejects.toThrow()
  await expect(stat(join(paths.bin, 'pip3'))).rejects.toThrow()
  await expect(execFileAsync('boring-ui', ['--help'], {
    cwd: workspaceRoot,
    env: { ...process.env, PATH: `${paths.bin}:${process.env.PATH ?? ''}` },
  })).resolves.toMatchObject({ stdout: expect.stringContaining('runnable help') })
}, 30_000)

test('local node packageRoot is packed installed and linked so boring-ui runs from PATH', async () => {
  const workspaceRoot = await makeTempDir('boring-runtime-node-runnable-')
  const packageRoot = await makeRunnableNodePackageRoot('@example/boring-ui', 'boring-ui')

  const result = await provisionRuntimeWorkspace({
    workspaceRoot,
    contributions: [{ id: 'tool', provisioning: { nodePackages: [{ id: 'tool', packageName: '@example/boring-ui', packageRoot }] } }],
  })
  const paths = getBoringAgentRuntimePaths(workspaceRoot)

  expect(result.binDir).toBe(paths.bin)
  await expect(readFile(join(paths.nodeModules, '@example', 'boring-ui', 'package.json'), 'utf8')).resolves.toContain('@example/boring-ui')
  await expect(readFile(join(paths.bin, 'boring-ui'), 'utf8')).resolves.toContain('.boring-agent/node/node_modules/@example/boring-ui/dist/index.js')
  const { stdout } = await execFileAsync('boring-ui', ['--help'], {
    cwd: workspaceRoot,
    env: { ...process.env, PATH: `${paths.bin}:${process.env.PATH ?? ''}` },
  })
  expect(stdout).toContain('runnable help')
}, 30_000)

test('multiple local node package roots are installed together so every generated bin stays runnable', async () => {
  const workspaceRoot = await makeTempDir('boring-runtime-node-multiple-')
  const packageRootA = await makeRunnableNodePackageRoot('@example/boring-a', 'boring-a')
  const packageRootB = await makeRunnableNodePackageRoot('@example/boring-b', 'boring-b')

  await provisionRuntimeWorkspace({
    workspaceRoot,
    contributions: [{
      id: 'tools',
      provisioning: {
        nodePackages: [
          { id: 'a', packageName: '@example/boring-a', packageRoot: packageRootA },
          { id: 'b', packageName: '@example/boring-b', packageRoot: packageRootB },
        ],
      },
    }],
  })
  const paths = getBoringAgentRuntimePaths(workspaceRoot)

  await expect(readFile(join(paths.nodeModules, '@example', 'boring-a', 'package.json'), 'utf8')).resolves.toContain('@example/boring-a')
  await expect(readFile(join(paths.nodeModules, '@example', 'boring-b', 'package.json'), 'utf8')).resolves.toContain('@example/boring-b')
  const env = { ...process.env, PATH: `${paths.bin}:${process.env.PATH ?? ''}` }
  await expect(execFileAsync('boring-a', ['--help'], { cwd: workspaceRoot, env })).resolves.toMatchObject({ stdout: expect.stringContaining('runnable help') })
  await expect(execFileAsync('boring-b', ['--help'], { cwd: workspaceRoot, env })).resolves.toMatchObject({ stdout: expect.stringContaining('runnable help') })
}, 30_000)

test('explicit node package bins link aliases and remove stale managed aliases', async () => {
  const workspaceRoot = await makeTempDir('boring-runtime-node-alias-')
  const packageRoot = await makeRunnableNodePackageRoot('@example/alias', 'original')

  await provisionRuntimeWorkspace({
    workspaceRoot,
    contributions: [{ id: 'tool', provisioning: { nodePackages: [{ id: 'tool', packageName: '@example/alias', packageRoot, bins: { first: 'dist/index.js' } }] } }],
  })
  const paths = getBoringAgentRuntimePaths(workspaceRoot)
  await expect(readFile(join(paths.bin, 'first'), 'utf8')).resolves.toContain('@example/alias/dist/index.js')

  await provisionRuntimeWorkspace({
    workspaceRoot,
    force: true,
    contributions: [{ id: 'tool', provisioning: { nodePackages: [{ id: 'tool', packageName: '@example/alias', packageRoot, bins: { second: 'dist/index.js' } }] } }],
  })

  await expect(stat(join(paths.bin, 'first'))).rejects.toThrow()
  await expect(readFile(join(paths.bin, 'second'), 'utf8')).resolves.toContain('@example/alias/dist/index.js')
}, 30_000)

test('provisioning rejects invalid nodePackages specs clearly', async () => {
  const workspaceRoot = await makeTempDir('boring-runtime-bad-node-spec-')
  const packageRoot = await makeNodePackageRoot('@example/tool')

  await expect(provisionRuntimeWorkspace({
    workspaceRoot,
    contributions: [{ id: 'bad', provisioning: { nodePackages: [{ id: 'tool', packageName: 'bad/name/extra', packageRoot }] } }],
  })).rejects.toThrow('packageName must be a valid npm package name')

  await expect(provisionRuntimeWorkspace({
    workspaceRoot,
    contributions: [{ id: 'bad', provisioning: { nodePackages: [{ id: 'tool', packageName: '@example/tool' } as any] } }],
  })).rejects.toThrow('must provide packageRoot for a local source or version for a registry source')

  await expect(provisionRuntimeWorkspace({
    workspaceRoot,
    contributions: [{ id: 'bad', provisioning: { nodePackages: [{ id: 'tool', packageName: '@example/tool', packageRoot, version: '1.0.0 beta' }] } }],
  })).rejects.toThrow('version must be a non-empty version string')

  await expect(provisionRuntimeWorkspace({
    workspaceRoot,
    contributions: [{
      id: 'bad',
      provisioning: { nodePackages: [{ id: 'tool', packageName: '@example/tool', packageRoot, bins: { '../tool': 'dist/index.js' } }] },
    }],
  })).rejects.toThrow('must be a bin name without path separators')

  await expect(provisionRuntimeWorkspace({
    workspaceRoot,
    contributions: [{
      id: 'bad',
      provisioning: { nodePackages: [{ id: 'tool', packageName: '@example/tool', packageRoot, bins: { tool: '../dist/index.js' } }] },
    }],
  })).rejects.toThrow('must be a package-relative file path')
})

test('node package fingerprint changes when package bin target outside standard dirs changes', async () => {
  const workspaceRoot = await makeTempDir('boring-runtime-node-root-bin-')
  const packageRoot = await makeTempDir('boring-runtime-node-root-bin-pkg-')
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name: '@example/root-bin', version: '0.0.0', bin: { 'root-tool': 'cli.js' } }), 'utf8')
  await writeFile(join(packageRoot, 'cli.js'), '#!/usr/bin/env node\nprocess.stdout.write("root v1\\n")\n', 'utf8')

  const contribution = { id: 'tool', provisioning: { nodePackages: [{ id: 'tool', packageName: '@example/root-bin', packageRoot }] } }
  const first = await provisionRuntimeWorkspace({ workspaceRoot, contributions: [contribution] })
  const paths = getBoringAgentRuntimePaths(workspaceRoot)
  await expect(execFileAsync('root-tool', [], { cwd: workspaceRoot, env: { ...process.env, PATH: `${paths.bin}:${process.env.PATH ?? ''}` } }))
    .resolves.toMatchObject({ stdout: 'root v1\n' })

  await writeFile(join(packageRoot, 'cli.js'), '#!/usr/bin/env node\nprocess.stdout.write("root v2\\n")\n', 'utf8')
  const second = await provisionRuntimeWorkspace({ workspaceRoot, contributions: [contribution] })

  expect(second.changed).toBe(true)
  expect(second.fingerprint).not.toBe(first.fingerprint)
  await expect(execFileAsync('root-tool', [], { cwd: workspaceRoot, env: { ...process.env, PATH: `${paths.bin}:${process.env.PATH ?? ''}` } }))
    .resolves.toMatchObject({ stdout: 'root v2\n' })
}, 30_000)

test('node package fingerprint changes for source version and bin alias changes', async () => {
  const workspaceRoot = await makeTempDir('boring-runtime-node-fingerprint-')
  const packageRoot = await makeNodePackageRoot('@example/tool')

  const first = await provisionRuntimeWorkspace({
    workspaceRoot,
    force: true,
    contributions: [{ id: 'tool', provisioning: { nodePackages: [{ id: 'tool', packageName: '@example/tool', packageRoot, bins: { tool: 'dist/index.js' } }] } }],
  })

  await writeFile(join(packageRoot, 'package-lock.json'), '{"lockfileVersion":3}\n', 'utf8')
  const sourceChanged = await provisionRuntimeWorkspace({
    workspaceRoot,
    force: true,
    contributions: [{ id: 'tool', provisioning: { nodePackages: [{ id: 'tool', packageName: '@example/tool', packageRoot, bins: { tool: 'dist/index.js' } }] } }],
  })

  await writeFile(join(packageRoot, 'tool-0.0.0.tgz'), 'packed bytes\n', 'utf8')
  const tarballChanged = await provisionRuntimeWorkspace({
    workspaceRoot,
    force: true,
    contributions: [{ id: 'tool', provisioning: { nodePackages: [{ id: 'tool', packageName: '@example/tool', packageRoot, bins: { tool: 'dist/index.js' } }] } }],
  })

  const versionChanged = await provisionRuntimeWorkspace({
    workspaceRoot,
    force: true,
    contributions: [{ id: 'tool', provisioning: { nodePackages: [{ id: 'tool', packageName: '@example/tool', version: '1.2.3', packageRoot, bins: { tool: 'dist/index.js' } }] } }],
  })

  const aliasChanged = await provisionRuntimeWorkspace({
    workspaceRoot,
    force: true,
    contributions: [{ id: 'tool', provisioning: { nodePackages: [{ id: 'tool', packageName: '@example/tool', version: '1.2.3', packageRoot, bins: { renamed: 'dist/index.js' } }] } }],
  })

  expect(sourceChanged.fingerprint).not.toBe(first.fingerprint)
  expect(tarballChanged.fingerprint).not.toBe(sourceChanged.fingerprint)
  expect(versionChanged.fingerprint).not.toBe(tarballChanged.fingerprint)
  expect(aliasChanged.fingerprint).not.toBe(versionChanged.fingerprint)
}, 30_000)

test('duplicate node package bins fail unless explicit aliases disambiguate', async () => {
  const workspaceRoot = await makeTempDir('boring-runtime-node-duplicate-bins-')
  const packageRootA = await makeNodePackageRoot('@example/a', { tool: 'dist/a.js' })
  const packageRootB = await makeNodePackageRoot('@example/b', { tool: 'dist/b.js' })

  await expect(provisionRuntimeWorkspace({
    workspaceRoot,
    contributions: [{
      id: 'tools',
      provisioning: {
        nodePackages: [
          { id: 'a', packageName: '@example/a', packageRoot: packageRootA },
          { id: 'b', packageName: '@example/b', packageRoot: packageRootB },
        ],
      },
    }],
  })).rejects.toThrow('Duplicate node package bin "tool"')

  await expect(provisionRuntimeWorkspace({
    workspaceRoot,
    contributions: [{
      id: 'tools',
      provisioning: {
        nodePackages: [
          { id: 'a', packageName: '@example/a', packageRoot: packageRootA, bins: { toolA: 'dist/a.js' } },
          { id: 'b', packageName: '@example/b', packageRoot: packageRootB, bins: { toolB: 'dist/b.js' } },
        ],
      },
    }],
  })).resolves.toMatchObject({ changed: true })
})

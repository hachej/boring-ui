import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'

import { withWorkspacePythonEnv } from '../../sandbox/workspacePythonEnv'
import { provisionRuntimeWorkspace } from '../provisionRuntime'
import {
  ensureBoringAgentRuntimeLayout,
  getBoringAgentRuntimePaths,
  writeBoringAgentOwnershipMarker,
} from '../runtimeLayout'

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
})

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

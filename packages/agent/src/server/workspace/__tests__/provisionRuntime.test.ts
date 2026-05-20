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

  await expect(stat(paths.legacyTopLevelVenv)).rejects.toMatchObject({ code: 'ENOENT' })
})

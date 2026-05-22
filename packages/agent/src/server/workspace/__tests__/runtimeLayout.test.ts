import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { rm } from 'node:fs/promises'

import {
  BORING_AGENT_RUNTIME_DIR_NAMES,
  ensureBoringAgentRuntimeLayout,
  getBoringAgentNodePackageTarget,
  getBoringAgentRuntimePaths,
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

test('getBoringAgentRuntimePaths centralizes all runtime artifact paths under .boring-agent', () => {
  const paths = getBoringAgentRuntimePaths('/workspace')

  expect(paths.root).toBe('/workspace/.boring-agent')
  expect(paths.bin).toBe('/workspace/.boring-agent/bin')
  expect(paths.node).toBe('/workspace/.boring-agent/node')
  expect(paths.nodeModules).toBe('/workspace/.boring-agent/node/node_modules')
  expect(paths.venv).toBe('/workspace/.boring-agent/venv')
  expect(paths.sdk).toBe('/workspace/.boring-agent/sdk')
  expect(paths.state).toBe('/workspace/.boring-agent/state')
  expect(paths.cache).toBe('/workspace/.boring-agent/cache')
  expect(paths.tmp).toBe('/workspace/.boring-agent/tmp')
  expect(paths.logs).toBe('/workspace/.boring-agent/logs')
  expect(paths.provisioningMarker).toBe('/workspace/.boring-agent/state/provisioning.json')
})

test('getBoringAgentNodePackageTarget places packages below .boring-agent/node/node_modules', () => {
  expect(getBoringAgentNodePackageTarget('/workspace', '@hachej/boring-ui-cli')).toBe(
    '/workspace/.boring-agent/node/node_modules/@hachej/boring-ui-cli',
  )
  expect(() => getBoringAgentNodePackageTarget('/workspace', '../escape')).toThrow('Invalid node package name')
})

test('ensureBoringAgentRuntimeLayout creates layout dirs and ownership markers', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-layout-')
  const paths = await ensureBoringAgentRuntimeLayout(workspaceRoot)

  for (const dirName of BORING_AGENT_RUNTIME_DIR_NAMES) {
    const dir = join(paths.root, dirName)
    await expect(stat(dir)).resolves.toMatchObject({})
    await expect(readFile(join(dir, '.boring-agent-owned.json'), 'utf8')).resolves.toContain('@hachej/boring-agent')
  }

  await expect(readFile(paths.ownershipManifest, 'utf8')).resolves.toContain('.boring-agent/venv')
})

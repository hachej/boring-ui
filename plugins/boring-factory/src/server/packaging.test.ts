import { execFileSync } from 'node:child_process'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

import { compileAgentDirectory } from '@hachej/boring-agent/server'
import { describe, expect, it } from 'vitest'

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function runPnpm(args: string[], cwd: string): void {
  execFileSync('pnpm', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

describe('private Boring Factory tarball', () => {
  it('packs, installs frozen through file:, compiles profiles, and rejects symlinked authority bytes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'boring-factory-pack-'))
    try {
      const packRoot = path.join(root, 'pack')
      const consumerRoot = path.join(root, 'consumer')
      await Promise.all([
        mkdir(packRoot, { recursive: true }),
        mkdir(consumerRoot, { recursive: true }),
      ])

      runPnpm(['pack', '--pack-destination', packRoot], pluginRoot)
      const packedName = 'hachej-boring-factory-0.0.0.tgz'
      await copyFile(path.join(packRoot, packedName), path.join(consumerRoot, 'factory.tgz'))
      await writeFile(path.join(consumerRoot, 'package.json'), JSON.stringify({
        name: 'factory-artifact-consumer',
        private: true,
        type: 'module',
        dependencies: {
          '@hachej/boring-factory': 'file:factory.tgz',
        },
      }))
      runPnpm(['install', '--lockfile-only'], consumerRoot)
      runPnpm(['install', '--frozen-lockfile', '--offline'], consumerRoot)

      const installedServer = path.join(
        consumerRoot,
        'node_modules/@hachej/boring-factory/dist/server/index.js',
      )
      const installed = await import(`${pathToFileURL(installedServer).href}?test=${Date.now()}`) as {
        resolveBoringFactoryResources(): {
          resourceRoot: string
          agentSources: Record<string, string>
        }
      }
      const resources = installed.resolveBoringFactoryResources()
      await expect(compileAgentDirectory(resources.agentSources['factory-orchestrator']))
        .resolves.toMatchObject({ definition: { definitionId: 'factory-orchestrator' } })
      await expect(compileAgentDirectory(resources.agentSources['factory-worker']))
        .resolves.toMatchObject({ definition: { definitionId: 'factory-worker' } })

      const lockfile = await readFile(path.join(consumerRoot, 'pnpm-lock.yaml'), 'utf8')
      expect(lockfile).toContain('file:factory.tgz')
      expect(lockfile).not.toContain(pluginRoot)

      const manifestPath = path.join(resources.resourceRoot, 'resource-manifest.json')
      const realManifestPath = path.join(resources.resourceRoot, 'resource-manifest.real.json')
      await rename(manifestPath, realManifestPath)
      await symlink('resource-manifest.real.json', manifestPath)
      expect(() => installed.resolveBoringFactoryResources()).toThrow(/manifest must be a regular file/)
      await unlink(manifestPath)
      await rename(realManifestPath, manifestPath)

      const realResourceRoot = `${resources.resourceRoot}-real`
      await rename(resources.resourceRoot, realResourceRoot)
      await symlink(path.basename(realResourceRoot), resources.resourceRoot)
      expect(() => installed.resolveBoringFactoryResources()).toThrow(/root must be a regular directory/)
      await unlink(resources.resourceRoot)
      await rename(realResourceRoot, resources.resourceRoot)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 60_000)
})

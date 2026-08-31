import { execFileSync } from 'node:child_process'
import {
  copyFile,
  cp,
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
  try {
    execFileSync('pnpm', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (cause) {
    const failure = cause as { stdout?: string; stderr?: string }
    throw new Error(
      `pnpm ${args.join(' ')} failed\n${failure.stdout ?? ''}${failure.stderr ?? ''}`,
      { cause },
    )
  }
}

function captureError(run: () => unknown): unknown {
  try {
    run()
    throw new Error('expected operation to fail')
  } catch (cause) {
    return cause
  }
}

describe('private Boring Factory tarball', () => {
  it('packs, installs frozen through file:, compiles profiles, and rejects symlinked authority bytes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'boring-factory-pack-'))
    const cleanPluginRoot = await mkdtemp(path.join(path.dirname(pluginRoot), '.boring-factory-pack-'))
    try {
      const packRoot = path.join(root, 'pack')
      const consumerRoot = path.join(root, 'consumer')
      await Promise.all([
        mkdir(packRoot, { recursive: true }),
        mkdir(consumerRoot, { recursive: true }),
        cp(pluginRoot, cleanPluginRoot, {
          recursive: true,
          filter: (source) => path.relative(pluginRoot, source).split(path.sep)[0] !== 'dist',
        }),
      ])

      expect(await readFile(path.join(cleanPluginRoot, 'package.json'), 'utf8')).toContain('"prepack"')
      runPnpm(['pack', '--pack-destination', packRoot], cleanPluginRoot)
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
      runPnpm(['fetch'], consumerRoot)
      runPnpm(['install', '--frozen-lockfile', '--offline'], consumerRoot)

      const installedServer = path.join(
        consumerRoot,
        'node_modules/@hachej/boring-factory/dist/server/index.js',
      )
      const installed = await import(`${pathToFileURL(installedServer).href}?test=${Date.now()}`) as {
        BORING_FACTORY_RESOURCE_ERROR_CODES: Record<string, string>
        resolveBoringFactoryResources(): {
          resourceRoot: string
          skillRoot: string
          agentSources: Record<string, string>
        }
      }
      const resources = installed.resolveBoringFactoryResources()
      await expect(compileAgentDirectory(resources.agentSources['factory-orchestrator']))
        .resolves.toMatchObject({ definition: { definitionId: 'factory-orchestrator' } })
      await expect(compileAgentDirectory(resources.agentSources['factory-worker']))
        .resolves.toMatchObject({ definition: { definitionId: 'factory-worker' } })

      const presentPrSkill = path.join(resources.skillRoot, 'exec/.agents/skills/present-pr/SKILL.md')
      const presentPrScript = path.resolve(path.dirname(presentPrSkill), '../../../scripts/present-pr.mjs')
      expect(await readFile(presentPrSkill, 'utf8')).not.toContain('--repo hachej/boring-ui')
      expect(captureError(() => execFileSync(process.execPath, [presentPrScript], {
        cwd: consumerRoot,
        encoding: 'utf8',
      }))).toMatchObject({ status: 2, stderr: expect.stringContaining('usage: present-pr.mjs') })

      const lockfile = await readFile(path.join(consumerRoot, 'pnpm-lock.yaml'), 'utf8')
      expect(lockfile).toContain('file:factory.tgz')
      expect(lockfile).not.toContain(pluginRoot)

      const manifestPath = path.join(resources.resourceRoot, 'resource-manifest.json')
      const manifestBytes = await readFile(manifestPath)
      await writeFile(manifestPath, '{')
      expect(captureError(() => installed.resolveBoringFactoryResources())).toMatchObject({
        code: installed.BORING_FACTORY_RESOURCE_ERROR_CODES.MANIFEST_INVALID,
      })
      await writeFile(manifestPath, manifestBytes)

      const realManifestPath = path.join(resources.resourceRoot, 'resource-manifest.real.json')
      await rename(manifestPath, realManifestPath)
      await symlink('resource-manifest.real.json', manifestPath)
      expect(captureError(() => installed.resolveBoringFactoryResources())).toMatchObject({
        code: installed.BORING_FACTORY_RESOURCE_ERROR_CODES.MANIFEST_INVALID,
      })
      await unlink(manifestPath)
      await rename(realManifestPath, manifestPath)

      const realResourceRoot = `${resources.resourceRoot}-real`
      await rename(resources.resourceRoot, realResourceRoot)
      await symlink(path.basename(realResourceRoot), resources.resourceRoot)
      expect(captureError(() => installed.resolveBoringFactoryResources())).toMatchObject({
        code: installed.BORING_FACTORY_RESOURCE_ERROR_CODES.ROOT_INVALID,
      })
      await unlink(resources.resourceRoot)
      await rename(realResourceRoot, resources.resourceRoot)
    } finally {
      await Promise.all([
        rm(root, { recursive: true, force: true }),
        rm(cleanPluginRoot, { recursive: true, force: true }),
      ])
    }
  }, 60_000)
})

import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'

async function findRepoRoot(start = process.cwd()): Promise<string> {
  let dir = start
  for (;;) {
    if (await readFile(join(dir, 'pnpm-workspace.yaml'), 'utf8').then(() => true, () => false)) return dir
    const parent = join(dir, '..')
    if (parent === dir) throw new Error('repo root not found')
    dir = parent
  }
}

async function filesUnder(root: string, dirs: string[]): Promise<Array<{ path: string; content: string }>> {
  const out: Array<{ path: string; content: string }> = []
  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.turbo') continue
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(abs)
      } else if (/\.(ts|tsx|mts|cts|js|mjs|cjs|json)$/.test(entry.name)) {
        out.push({ path: abs, content: await readFile(abs, 'utf8') })
      }
    }
  }
  for (const dir of dirs) await walk(join(root, dir))
  return out
}

describe('runtime provisioning invariants', async () => {
  const repoRoot = await findRepoRoot()
  const sourceFiles = await filesUnder(repoRoot, ['packages/agent/src', 'packages/workspace/src', 'packages/cli/src'])
  const productionFiles = sourceFiles.filter((file) => !file.path.includes('__tests__'))

  test('simplification-only abstractions and endpoints stay absent from production source', () => {
    const forbidden = [
      'WorkspaceSetupPlan',
      'RuntimeProvisioningPlugin',
      'ProvisioningJobRegistry',
      'ProvisioningLockManager',
      'CleanupManager',
      '.boring-agent/state',
      '.boring-agent/provisioned',
      '/runtime/doctor',
      '/provisioning/status',
      '/provisioning/jobs',
      '.boring-agent/bin/boring-ui',
      '.venv/bin',
    ]
    const hits = productionFiles.flatMap((file) => forbidden
      .filter((needle) => {
        const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const pattern = /^[A-Za-z_][A-Za-z0-9_]*$/.test(needle) ? `\\b${escaped}\\b` : escaped
        return new RegExp(pattern).test(file.content)
      })
      .map((needle) => `${relative(repoRoot, file.path)} contains ${needle}`))

    expect(hits).toEqual([])
  })

  test('agent provisioning engine does not import workspace package values or types', () => {
    const hits = productionFiles
      .filter((file) => file.path.includes('/packages/agent/src/server/workspace/provisioning/'))
      .filter((file) => file.content.includes('@hachej/boring-workspace'))
      .map((file) => relative(repoRoot, file.path))

    expect(hits).toEqual([])
  })

  test('package plugin manifests keep public runtime shape to pi and boring namespaces', async () => {
    const manifests = (await filesUnder(repoRoot, [
      'packages/workspace/src',
      'packages/cli/src',
    ])).filter((file) => file.path.endsWith('package.json'))
    const forbiddenManifestNamespaces = [
      'runtimeProvisioning',
      'workspaceSetup',
      'boringRuntime',
      'boringAgent',
      'runtimePlugins',
    ]
    const hits = manifests.flatMap((file) => forbiddenManifestNamespaces
      .filter((needle) => file.content.includes(`"${needle}"`) || file.content.includes(`'${needle}'`))
      .map((needle) => `${relative(repoRoot, file.path)} contains public manifest namespace ${needle}`))

    expect(hits).toEqual([])
  })

  test('plugin collection reads manifests without copying source trees', () => {
    const hits = productionFiles
      .filter((file) => file.path.includes('/packages/workspace/src/server/agentPlugins/'))
      .filter((file) => /copyFromHost|\bcp\(|copyFile|mkdir\(/.test(file.content))
      .map((file) => relative(repoRoot, file.path))

    expect(hits).toEqual([])
  })
})

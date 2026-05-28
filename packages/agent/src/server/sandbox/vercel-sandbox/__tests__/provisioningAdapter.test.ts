import { mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, test } from 'vitest'

import { getBoringAgentRuntimePaths } from '../../../workspace/runtimeLayout'
import { createVercelProvisioningAdapter, VERCEL_PROVISIONING_CACHE_ROOT } from '../provisioningAdapter'
import type { WorkspaceProvisioningAdapter } from '../../../workspace/provisioning'

interface FakeWorkspaceState {
  files: Map<string, string>
  copied: Array<{ source: string | URL; target: string }>
}

function createWorkspaceFs(state: FakeWorkspaceState): WorkspaceProvisioningAdapter['workspaceFs'] {
  return {
    async exists(rel) {
      return state.files.has(rel)
    },
    async rm(rel) {
      for (const key of [...state.files.keys()]) {
        if (key === rel || key.startsWith(`${rel}/`)) state.files.delete(key)
      }
    },
    async mkdir(rel) {
      state.files.set(`${rel}/.dir`, '')
    },
    async writeText(rel, content) {
      state.files.set(rel, content)
    },
    async readText(rel) {
      return state.files.get(rel) ?? null
    },
    async copyFromHost(source, rel) {
      const sourcePath = source instanceof URL ? source.pathname : source
      state.copied.push({ source, target: rel })
      state.files.set(rel, await readFile(sourcePath, 'utf8'))
    },
  }
}

async function sourcePackage(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'boring-vercel-source-'))
  await writeFile(join(root, 'package.json'), '{"name":"pkg"}\n')
  return root
}

test('node and python install sources become workspace-visible artifacts without polluting host source trees', async () => {
  const sourceRoot = await sourcePackage()
  const state: FakeWorkspaceState = { files: new Map(), copied: [] }
  const prepared: Array<{ source: string | URL; outputPath: string; kind: string }> = []
  const adapter = createVercelProvisioningAdapter({
    runtimeLayout: getBoringAgentRuntimePaths('/workspace'),
    workspaceFs: createWorkspaceFs(state),
    async exec() {},
    async prepareArtifact(request) {
      prepared.push(request)
      await writeFile(request.outputPath, `${request.kind} artifact for ${String(request.source)}\n`)
    },
  })

  await expect(adapter.resolveInstallSource(sourceRoot, {
    kind: 'node',
    id: 'macro cli',
    fingerprint: 'sha256:abcdef',
  })).resolves.toBe('/workspace/.boring-agent/tmp/macro-cli-pnpm-pack-v2-abcdef.tgz')
  await expect(adapter.resolveInstallSource(sourceRoot, {
    kind: 'python',
    id: 'macro-sdk',
    fingerprint: 'sha256:123456',
  })).resolves.toBe('/workspace/.boring-agent/tmp/macro-sdk-v1-123456.tar.gz')

  expect(prepared.map((item) => item.kind)).toEqual(['node', 'python'])
  expect(state.files.get('.boring-agent/tmp/macro-cli-pnpm-pack-v2-abcdef.tgz')).toContain('node artifact')
  expect(state.files.get('.boring-agent/tmp/macro-sdk-v1-123456.tar.gz')).toContain('python artifact')

  const sourceEntries = await readdir(sourceRoot)
  expect(sourceEntries).toEqual(['package.json'])
})

test('unchanged artifact fingerprint avoids repack and reupload', async () => {
  const sourceRoot = await sourcePackage()
  const state: FakeWorkspaceState = {
    files: new Map([['.boring-agent/tmp/cli-pnpm-pack-v2-abcdef.tgz', 'cached artifact\n']]),
    copied: [],
  }
  let prepareCount = 0
  const adapter = createVercelProvisioningAdapter({
    runtimeLayout: getBoringAgentRuntimePaths('/workspace'),
    workspaceFs: createWorkspaceFs(state),
    async exec() {},
    async prepareArtifact(request) {
      prepareCount += 1
      await writeFile(request.outputPath, 'new artifact\n')
    },
  })

  const source = await adapter.resolveInstallSource(sourceRoot, {
    kind: 'node',
    id: 'cli',
    fingerprint: 'sha256:abcdef',
  })

  expect(source).toBe('/workspace/.boring-agent/tmp/cli-pnpm-pack-v2-abcdef.tgz')
  expect(prepareCount).toBe(0)
  expect(state.copied).toEqual([])
})

test('generated skills land in workspace-visible /workspace paths through workspaceFs.copyFromHost', async () => {
  const skillRoot = await mkdtemp(join(tmpdir(), 'boring-vercel-skill-'))
  const skill = join(skillRoot, 'SKILL.md')
  await writeFile(skill, '# Skill\n')
  const state: FakeWorkspaceState = { files: new Map(), copied: [] }
  const adapter = createVercelProvisioningAdapter({
    runtimeLayout: getBoringAgentRuntimePaths('/workspace'),
    workspaceFs: createWorkspaceFs(state),
    async exec() {},
    async prepareArtifact() {},
  })

  await adapter.workspaceFs.copyFromHost(skill, '.boring-agent/skills/plugin/skill/SKILL.md')

  expect(state.files.get('.boring-agent/skills/plugin/skill/SKILL.md')).toBe('# Skill\n')
  expect(getBoringAgentRuntimePaths('/workspace').skills).toBe('/workspace/.boring-agent/skills')
})

test('uses ephemeral cache root outside synced workspace caches', async () => {
  const adapter = createVercelProvisioningAdapter({
    runtimeLayout: getBoringAgentRuntimePaths('/workspace'),
    workspaceFs: createWorkspaceFs({ files: new Map(), copied: [] }),
    async exec() {},
    async prepareArtifact() {},
  })

  expect(adapter.getRuntimeCacheRoot()).toBe(VERCEL_PROVISIONING_CACHE_ROOT)
  expect(adapter.getRuntimeCacheRoot()).not.toContain('/workspace/.boring-agent/cache')
})

test('shared provisioning engine stays mode-agnostic and does not pack/upload artifacts directly', async () => {
  const source = await readFile('src/server/workspace/provisioning/provisionWorkspaceRuntime.ts', 'utf8')
  expect(source).not.toContain('@vercel/sandbox')
  expect(source).not.toContain('npm pack')
  expect(source).not.toContain('uv build')
  expect(source).not.toContain('upload')
})

test('artifact preparation receives non-source temp output path for useful failure diagnostics', async () => {
  const sourceRoot = await sourcePackage()
  const state: FakeWorkspaceState = { files: new Map(), copied: [] }
  let outputPath = ''
  const adapter = createVercelProvisioningAdapter({
    runtimeLayout: getBoringAgentRuntimePaths('/workspace'),
    workspaceFs: createWorkspaceFs(state),
    async exec() {},
    async prepareArtifact(request) {
      outputPath = request.outputPath
      await writeFile(outputPath, 'artifact\n')
    },
  })

  await adapter.resolveInstallSource(sourceRoot, {
    kind: 'node',
    id: 'cli',
    fingerprint: 'sha256:feedface',
  })

  expect(outputPath).toContain('boring-agent-vercel-artifact-')
  expect(outputPath).not.toContain(sourceRoot)
  await expect(stat(dirname(outputPath))).resolves.toBeTruthy()
})

import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  FACTORY_ORCHESTRATOR_AGENT_TYPE_ID,
  FACTORY_WORKER_AGENT_TYPE_ID,
  resolveBoringFactoryResources,
} from '../../dist/server/index.js'

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const repositoryRoot = path.resolve(pluginRoot, '../..')

function sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function expectExactFile(source: string, packaged: string): Promise<void> {
  const [sourceBytes, packagedBytes] = await Promise.all([
    readFile(source),
    readFile(packaged),
  ])
  expect(packagedBytes).toEqual(sourceBytes)
}

describe('Boring Factory resource artifact', () => {
  it('resolves verified addressed profiles and only the canonical plan/exec skill root', async () => {
    const resources = resolveBoringFactoryResources()

    expect(resources.resourceDigest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(await readdir(resources.skillRoot)).toEqual(['exec', 'plan'])
    expect(Object.keys(resources.agentSources).sort()).toEqual([
      FACTORY_ORCHESTRATOR_AGENT_TYPE_ID,
      FACTORY_WORKER_AGENT_TYPE_ID,
    ])

    await expectExactFile(
      path.join(repositoryRoot, '.agents/skills/plan/SKILL.md'),
      path.join(resources.skillRoot, 'plan/SKILL.md'),
    )
    await expectExactFile(
      path.join(repositoryRoot, '.agents/skills/exec/SKILL.md'),
      path.join(resources.skillRoot, 'exec/SKILL.md'),
    )
  })

  it('records the exact digest and canonical source bytes of every packaged file', async () => {
    const resources = resolveBoringFactoryResources()
    const entries = Object.entries(resources.manifest.files)

    expect(entries.length).toBeGreaterThan(30)
    expect(Object.keys(resources.manifest.sources).sort())
      .toEqual(Object.keys(resources.manifest.files).sort())
    for (const [relativePath, expectedDigest] of entries) {
      const packagedPath = path.join(resources.resourceRoot, relativePath)
      const sourcePath = path.join(repositoryRoot, resources.manifest.sources[relativePath])
      expect(sha256(await readFile(packagedPath))).toBe(expectedDigest)
      await expectExactFile(sourcePath, packagedPath)
    }
  })

  it('packages the direct read-only reference closure without discovering support skills', () => {
    const resources = resolveBoringFactoryResources()
    const files = new Set(Object.keys(resources.manifest.files))

    for (const required of [
      'skills/plan/docs/procedures/boring-loop.md',
      'skills/plan/docs/procedures/MODEL-CARD.md',
      'skills/plan/docs/procedures/visual-review-doc.md',
      'skills/plan/.agents/skills/fresh-eyes/SKILL.md',
      'skills/exec/docs/procedures/worktree-agent.md',
      'skills/exec/docs/procedures/proof-of-work.md',
      'skills/exec/.agents/factory/README.md',
      'skills/exec/.agents/skills/present-pr/SKILL.md',
      'skills/exec/.agents/skills/show-me/SKILL.md',
      'skills/exec/.agents/skill-references/show-me/humanlayer-show-me/SOURCE.md',
      'skills/exec/.agents/skill-references/show-me/humanlayer-show-me/SKILL.md',
      'skills/exec/.agents/skill-references/show-me/humanlayer-show-me/LICENSE.txt',
      'skills/exec/scripts/present-pr.mjs',
      'skills/exec/scripts/lib/render-mermaid.mjs',
    ]) {
      expect(files.has(required), required).toBe(true)
    }
  })

  it('keeps profile manifests aligned with their addressed directory identities', async () => {
    const resources = resolveBoringFactoryResources()

    for (const agentTypeId of [
      FACTORY_ORCHESTRATOR_AGENT_TYPE_ID,
      FACTORY_WORKER_AGENT_TYPE_ID,
    ] as const) {
      const source = resources.agentSources[agentTypeId]
      const manifest = JSON.parse(await readFile(path.join(source, 'agent.json'), 'utf8')) as {
        definitionId?: string
        instructionsRef?: string
      }
      expect(manifest.definitionId).toBe(agentTypeId)
      expect(manifest.instructionsRef).toBe('instructions.md')
      expect((await readFile(path.join(source, 'instructions.md'), 'utf8')).trim()).not.toBe('')
    }
  })
})

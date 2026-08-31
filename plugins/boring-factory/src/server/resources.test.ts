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

const HOST_OWNED_MARKDOWN_REFERENCES = new Set([
  '.agents/factory/README.md -> AGENTS.md',
  '.agents/factory/README.md -> docs/factory/TODO.md',
  '.agents/factory/README.md -> docs/factory/VISION.md',
  '.agents/factory/README.md -> issue-plans.md',
  '.agents/factory/tools.md -> .agents/skills/owner-gate/SKILL.md',
  '.agents/factory/tools.md -> docs/factory/VISION.md',
  '.agents/skill-references/show-me/humanlayer-show-me/SOURCE.md -> plugins/show-me/skills/show-me/SKILL.md',
  '.agents/skills/present-pr/SKILL.md -> packages/workspace/docs/URL_PANE.md',
  'docs/procedures/MODEL-CARD.md -> documentation-refresh-tasks.md',
  'docs/procedures/boring-loop.md -> .agents/factory/README.md',
  'docs/procedures/visual-review-doc.md -> .agents/skills/ui/visual-report-bundle.md',
])

function referencedMarkdownPaths(content: string): string[] {
  const references = [
    ...Array.from(
      content.matchAll(/\[[^\]]*\]\(([^)#]+\.md)(?:#[^)]+)?\)/g),
      (match) => match[1]!,
    ),
    ...Array.from(
      content.matchAll(/`((?:\.{1,2}\/|[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.md)`/g),
      (match) => match[1]!,
    ),
  ].filter((reference) => !reference.includes('://'))
  return [...new Set(references)]
}

function resolvePackagedReference(
  skillPrefix: string,
  packagedPath: string,
  skillRelativePath: string,
  reference: string,
): string {
  if (/^(?:docs|\.agents|packages|plugins)\//.test(reference) || reference === 'AGENTS.md') {
    return path.posix.join(skillPrefix, reference)
  }
  if (
    (skillRelativePath === 'SKILL.md' || skillRelativePath === '.agents/factory/README.md')
    && !reference.includes('/')
  ) {
    return path.posix.join(skillPrefix, 'docs/procedures', reference)
  }
  if (skillRelativePath === 'docs/procedures/session-handoff.md' && reference === 'CONTRACT.md') {
    return path.posix.join(skillPrefix, '.agents/skills/handoff/CONTRACT.md')
  }
  if (skillRelativePath.startsWith('docs/procedures/') && reference.startsWith('procedures/')) {
    return path.posix.join(skillPrefix, 'docs', reference)
  }
  return path.posix.normalize(path.posix.join(path.posix.dirname(packagedPath), reference))
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

  it('resolves the packaged Markdown dependency graph from each runtime skill directory', async () => {
    const resources = resolveBoringFactoryResources()
    const packagedFiles = new Set(Object.keys(resources.manifest.files))

    const unresolved: string[] = []
    for (const skillName of ['plan', 'exec']) {
      const skillPrefix = `skills/${skillName}/`
      const markdownFiles = [...packagedFiles]
        .filter((relativePath) => relativePath.startsWith(skillPrefix) && relativePath.endsWith('.md'))
        .sort()
      for (const packagedPath of markdownFiles) {
        const skillRelativePath = packagedPath.slice(skillPrefix.length)
        const content = await readFile(path.join(resources.resourceRoot, packagedPath), 'utf8')
        for (const reference of referencedMarkdownPaths(content)) {
          const edge = `${skillRelativePath} -> ${reference}`
          if (HOST_OWNED_MARKDOWN_REFERENCES.has(edge)) continue
          const target = resolvePackagedReference(
            skillPrefix,
            packagedPath,
            skillRelativePath,
            reference,
          )
          if (!packagedFiles.has(target)) unresolved.push(`${packagedPath} -> ${reference} (${target})`)
        }
      }
    }
    expect(unresolved).toEqual([])
  })

  it('keeps profile manifests aligned with their addressed directory identities', async () => {
    const resources = resolveBoringFactoryResources()

    for (const agentTypeId of [
      FACTORY_ORCHESTRATOR_AGENT_TYPE_ID,
      FACTORY_WORKER_AGENT_TYPE_ID,
    ] as const) {
      const source = resources.agentSources[agentTypeId]
      const compatibilityManifest = JSON.parse(
        await readFile(path.join(source, 'agent.json'), 'utf8'),
      ) as { definitionId?: string; version?: string; label?: string; instructionsRef?: string }
      const packageManifest = JSON.parse(
        await readFile(path.join(source, 'package.json'), 'utf8'),
      ) as { boring?: { agent?: typeof compatibilityManifest } }
      expect(packageManifest.boring?.agent).toEqual({
        definitionId: compatibilityManifest.definitionId,
        version: compatibilityManifest.version,
        label: compatibilityManifest.label,
        instructionsRef: compatibilityManifest.instructionsRef,
      })
      expect(compatibilityManifest.definitionId).toBe(agentTypeId)
      expect(compatibilityManifest.instructionsRef).toBe('instructions.md')
      expect((await readFile(path.join(source, 'instructions.md'), 'utf8')).trim()).not.toBe('')
    }
  })
})

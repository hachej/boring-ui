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

function referencedMarkdownPaths(relativePath: string, content: string): string[] {
  const references = Array.from(
    content.matchAll(/\[[^\]]*\]\(([^)#]+\.md)(?:#[^)]+)?\)/g),
  ).filter((match) => {
    if (match[1]!.includes('://')) return false
    const context = content.slice(Math.max(0, (match.index ?? 0) - 160), match.index)
    return /\b(?:read|follow|required|requires|per|governed|together|guidance)\b/i.test(context)
  }).map((match) => match[1]!)

  if (relativePath === 'SKILL.md') {
    references.push(...Array.from(
      content.matchAll(/`((?:\.{1,2}\/|docs\/|\.agents\/)[A-Za-z0-9_./-]+\.md)`/g),
      (match) => match[1]!,
    ))
  }
  if (relativePath.endsWith('/index.md')) {
    references.push(...Array.from(
      content.matchAll(/\*\*Read:\*\* `([^`]+\.md)`/g),
      (match) => match[1]!,
    ))
  }
  if (relativePath.startsWith('docs/procedures/')) {
    references.push(...Array.from(
      content.matchAll(/`((?:docs\/|\.agents\/)[A-Za-z0-9_./-]+\.md)`/g),
      (match) => match[1]!,
    ))
  }
  return [...new Set(references)]
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

    for (const skillName of ['plan', 'exec']) {
      const skillPrefix = `skills/${skillName}/`
      const markdownFiles = [...packagedFiles]
        .filter((relativePath) => relativePath.startsWith(skillPrefix) && relativePath.endsWith('.md'))
        .sort()
      for (const packagedPath of markdownFiles) {
        const skillRelativePath = packagedPath.slice(skillPrefix.length)
        const content = await readFile(path.join(resources.resourceRoot, packagedPath), 'utf8')
        for (const reference of referencedMarkdownPaths(skillRelativePath, content)) {
          const target = reference.startsWith('docs/') || reference.startsWith('.agents/')
            ? path.posix.join(skillPrefix, reference)
            : path.posix.normalize(path.posix.join(path.posix.dirname(packagedPath), reference))
          expect(
            target.startsWith('skills/') || target.startsWith('skill-references/'),
            `${packagedPath} reference escapes the packaged runtime root: ${reference}`,
          ).toBe(true)
          expect(packagedFiles.has(target), `${packagedPath} -> ${reference} (${target})`).toBe(true)
        }
      }
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

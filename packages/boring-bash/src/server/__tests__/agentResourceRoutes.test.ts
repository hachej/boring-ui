import { afterEach, describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'

import { createAgentResourceFilesystemBinding } from '../agentResourceOperations'
import { searchRoutes } from '../routes/search'
import { treeRoutes } from '../routes/tree'

const filesystem = 'agent_resources'
const roots: string[] = []

async function fixture() {
  const packageRoot = await mkdtemp(join(tmpdir(), 'boring-agent-resource-route-'))
  roots.push(packageRoot)
  const skillRoot = join(packageRoot, 'skills', 'authoring')
  await mkdir(join(skillRoot, 'references'), { recursive: true })
  await writeFile(join(skillRoot, 'SKILL.md'), '# Skill\nSAFE_SENTINEL\n', 'utf8')
  await writeFile(join(skillRoot, 'references', 'guide.md'), 'guide SAFE_SENTINEL', 'utf8')
  return skillRoot
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

// Sol round-2 probe: the round-1 union fix only made list("/") work.
// tree.ts stats immediately after listing root, and search.ts calls find
// at root — both require the multi-root binding to route virtual ancestor
// directories (root "" and any intermediate segment like "packages") for
// stat/find/grep, not just list. These route-level tests exercise the real
// agent_resources binding through the actual tree/search routes so this
// class of regression can't slip through operations-only unit tests again.
describe('agent_resources filesystem through tree/search routes', () => {
  test('GET /api/v1/tree recursively walks a multi-root agent_resources binding from its logical root', async () => {
    const skillRoot = await fixture()
    const logicalRoot = 'packages/@example/plugin/skills/authoring'
    const binding = await createAgentResourceFilesystemBinding(filesystem, [{ logicalRoot, sourceRoot: skillRoot }])

    const app = Fastify()
    await app.register(treeRoutes, { filesystemBindings: [binding] })

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/tree?filesystem=${filesystem}&recursive=true`,
    })

    expect(response.statusCode).toBe(200)
    const { entries } = response.json() as { entries: Array<{ name: string; kind: string; path: string }> }
    // Root list synthesizes the virtual "packages" ancestor as a directory;
    // stat("packages") must resolve it as a directory (not 404) for the
    // walk to recurse into the real mount below it.
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'packages', kind: 'dir' }),
      expect.objectContaining({ name: 'SKILL.md', kind: 'file' }),
      expect.objectContaining({ name: 'guide.md', kind: 'file' }),
    ]))
    await app.close()
  })

  test('GET /api/v1/files/search finds matches under a multi-root agent_resources binding via root find', async () => {
    const skillRoot = await fixture()
    const logicalRoot = 'packages/@example/plugin/skills/authoring'
    const binding = await createAgentResourceFilesystemBinding(filesystem, [{ logicalRoot, sourceRoot: skillRoot }])

    const app = Fastify()
    await app.register(searchRoutes, {
      fileSearch: { search: async () => [] },
      filesystemBindings: [binding],
    })

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/files/search?q=*.md&limit=10',
    })

    expect(response.statusCode).toBe(200)
    const { resources } = response.json() as { resources: Array<{ filesystem: string; path: string }> }
    expect(resources).toEqual(expect.arrayContaining([
      { filesystem, path: `/${logicalRoot}/SKILL.md` },
      { filesystem, path: `/${logicalRoot}/references/guide.md` },
    ]))
    await app.close()
  })
})

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CANONICAL_PLUGIN_ID_ERROR_CODE,
  assertCanonicalPluginId,
  extractDefinePluginId,
} from '../canonicalPluginId'
import { scanBoringPlugins } from '../scan'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

describe('canonical plugin ID preflight', () => {
  it('requires package manifest, front, and server IDs to agree', () => {
    expect(assertCanonicalPluginId({
      packageJson: { name: 'package-name', boring: { id: 'macro' } },
      frontId: 'macro',
      serverId: 'macro',
    })).toBe('macro')

    for (const input of [
      { packageJson: { name: 'package-name', boring: { id: 'macro' } }, frontId: 'other', serverId: 'macro' },
      { packageJson: { name: 'package-name', boring: { id: 'macro' } }, frontId: 'macro', serverId: 'other' },
    ]) {
      expect(() => assertCanonicalPluginId(input)).toThrow(expect.objectContaining({
        code: CANONICAL_PLUGIN_ID_ERROR_CODE,
      }))
    }
  })

  it('identifies only the direct default-exported definePlugin literal', () => {
    expect(extractDefinePluginId(`
      // A decoy call must not win over the default export.
      definePlugin({ id: "canonical" })
      export default definePlugin(/* formatting is intentionally odd */ {
        label: "Evil",
        id /* comment */ : 'evil',
      })
    `)).toBe('evil')
    expect(extractDefinePluginId(`
      export default definePlugin({
        label: "Macro",
        "id": \`macro\`,
      })
    `)).toBe('macro')
  })

  it.each([
    {
      name: 'dynamic ID',
      source: 'export default definePlugin({ id: getPluginId() })',
    },
    {
      name: 'indirect default identifier',
      source: 'const plugin = definePlugin({ id: "canonical" }); export default plugin',
    },
    {
      name: 'duplicate ID properties',
      source: 'export default definePlugin({ id: "canonical", id: "other" })',
    },
    {
      name: 'conflicting spread',
      source: 'export default definePlugin({ id: "canonical", ...override })',
    },
  ])('rejects $name instead of silently skipping the declared front entry', ({ source }) => {
    expect(() => extractDefinePluginId(source)).toThrow(expect.objectContaining({
      code: CANONICAL_PLUGIN_ID_ERROR_CODE,
    }))
  })

  it('falls back to package name when boring.id is omitted', () => {
    expect(assertCanonicalPluginId({
      packageJson: { name: 'package-name' },
      frontId: 'package-name',
      serverId: 'package-name',
    })).toBe('package-name')
  })

  it('extracts a valid literal through comments and multiline formatting', () => {
    expect(extractDefinePluginId(`
      import { definePlugin } from "@hachej/boring-workspace/plugin"
      export /* comment */ default definePlugin(
        {
          panels: [],
          id: /* comment */ "macro",
        },
      )
    `)).toBe('macro')
  })

  it('rejects a decoy matching the manifest when the default plugin conflicts', async () => {
    const root = await tempDir('boring-canonical-front-decoy-')
    await mkdir(join(root, 'front'), { recursive: true })
    await writeFile(join(root, 'front', 'index.tsx'), `
      definePlugin({ id: "canonical" })
      export default definePlugin({ id: "evil" })
    `, 'utf8')
    await writeFile(join(root, 'package.json'), JSON.stringify({
      name: 'legacy-name',
      boring: { id: 'canonical', front: 'front/index.tsx' },
    }), 'utf8')

    const scan = scanBoringPlugins([root])

    expect(scan.preflight.ok).toBe(false)
    expect(scan.preflight.errors).toEqual([
      expect.objectContaining({
        code: 'INVALID_PLUGIN_METADATA',
        pluginId: 'canonical',
        message: expect.stringContaining('definePlugin ID must equal canonical plugin ID "canonical"'),
      }),
    ])
    expect(scan.plugins).toEqual([])
  })

  it('rejects an unresolved declared front but preserves packages with no front declaration', async () => {
    const dynamicRoot = await tempDir('boring-canonical-front-dynamic-')
    const noFrontRoot = await tempDir('boring-canonical-no-front-')
    await mkdir(join(dynamicRoot, 'front'), { recursive: true })
    await writeFile(
      join(dynamicRoot, 'front', 'index.tsx'),
      'export default definePlugin({ id: process.env.PLUGIN_ID })\n',
      'utf8',
    )
    await writeFile(join(dynamicRoot, 'package.json'), JSON.stringify({
      name: 'dynamic-plugin',
      boring: { front: 'front/index.tsx' },
    }), 'utf8')
    await writeFile(join(noFrontRoot, 'package.json'), JSON.stringify({
      name: 'server-only',
      boring: { server: false },
    }), 'utf8')

    const scan = scanBoringPlugins([dynamicRoot, noFrontRoot])

    expect(scan.preflight.ok).toBe(false)
    expect(scan.preflight.errors).toEqual([
      expect.objectContaining({
        pluginId: 'dynamic-plugin',
        message: expect.stringContaining('definePlugin ID must be a string literal'),
      }),
    ])
    expect(scan.plugins.map((plugin) => plugin.id)).toEqual(['server-only'])
  })

  it('scan preflight rejects a front definePlugin ID mismatch before descriptors are usable', async () => {
    const root = await tempDir('boring-canonical-front-mismatch-')
    await mkdir(join(root, 'front'), { recursive: true })
    await writeFile(join(root, 'front', 'index.tsx'), 'export default definePlugin({ id: "other" })\n', 'utf8')
    await writeFile(join(root, 'package.json'), JSON.stringify({
      name: 'legacy-name',
      boring: { id: 'canonical', front: 'front/index.tsx' },
    }), 'utf8')

    const scan = scanBoringPlugins([root])

    expect(scan.preflight.ok).toBe(false)
    expect(scan.preflight.errors).toEqual([
      expect.objectContaining({
        code: 'INVALID_PLUGIN_METADATA',
        pluginId: 'canonical',
        message: expect.stringContaining('definePlugin ID must equal canonical plugin ID "canonical"'),
      }),
    ])
    expect(scan.plugins).toEqual([])
  })

  it('fails before callers can collect any contribution', () => {
    const collected: string[] = []
    expect(() => {
      const id = assertCanonicalPluginId({
        packageJson: { name: 'package-name', boring: { id: 'canonical' } },
        serverId: 'mismatch',
      })
      collected.push(id)
    }).toThrow()
    expect(collected).toEqual([])
  })
})

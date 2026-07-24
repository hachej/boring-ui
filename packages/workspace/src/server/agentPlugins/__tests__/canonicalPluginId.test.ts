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

  it('falls back to package name when boring.id is omitted', () => {
    expect(assertCanonicalPluginId({
      packageJson: { name: 'package-name' },
      frontId: 'package-name',
      serverId: 'package-name',
    })).toBe('package-name')
  })

  it('extracts static front definePlugin IDs for app-side preflight', () => {
    expect(extractDefinePluginId('export default definePlugin({ id: "macro", panels: [] })')).toBe('macro')
    expect(extractDefinePluginId("definePlugin({\n  label: 'Macro',\n  id: 'macro'\n})")).toBe('macro')
    expect(extractDefinePluginId('export default function Plugin() {}')).toBeUndefined()
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

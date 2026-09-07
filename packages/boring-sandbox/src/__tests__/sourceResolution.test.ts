import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

import { sandboxSourceAlias } from '../../../../scripts/vite-sandbox-alias'

const repositoryRoot = resolve(import.meta.dirname, '../../../..')
const sandboxPackage = JSON.parse(
  readFileSync(resolve(repositoryRoot, 'packages/boring-sandbox/package.json'), 'utf8'),
) as {
  exports: Record<string, { 'boring-source'?: string }>
}

const supportedSubpaths = [
  'shared',
  'providers',
  'providers/direct',
  'providers/bwrap',
  'providers/node-workspace',
  'providers/blaxel',
  'providers/vercel-sandbox',
  'providers/runsc',
  'providers/remote-worker',
] as const

describe('sandbox source resolution', () => {
  test.each(supportedSubpaths)('resolves %s through package exports and the Vitest alias', (subpath) => {
    const packageTarget = sandboxPackage.exports[`./${subpath}`]?.['boring-source']
    expect(packageTarget).toBe(`./src/${subpath}/index.ts`)
    expect(existsSync(resolve(repositoryRoot, 'packages/boring-sandbox', packageTarget!))).toBe(true)

    const specifier = `@hachej/boring-sandbox/${subpath}`
    expect(specifier.replace(sandboxSourceAlias.find, sandboxSourceAlias.replacement)).toBe(
      resolve(repositoryRoot, `packages/boring-sandbox/src/${subpath}/index.ts`),
    )
  })

  test('does not rewrite the package root, which has no source export', () => {
    const specifier = '@hachej/boring-sandbox'
    expect(specifier.replace(sandboxSourceAlias.find, sandboxSourceAlias.replacement)).toBe(specifier)
    expect(sandboxPackage.exports['.']?.['boring-source']).toBeUndefined()
  })
})

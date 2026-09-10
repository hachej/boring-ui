import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { resolveConfig } from 'vite'
import { describe, expect, test } from 'vitest'

import {
  sandboxSourceAlias,
  sandboxSourceSubpaths,
} from '../../../../scripts/vite-sandbox-alias'

const repositoryRoot = resolve(import.meta.dirname, '../../../..')
const sandboxPackage = JSON.parse(
  readFileSync(resolve(repositoryRoot, 'packages/boring-sandbox/package.json'), 'utf8'),
) as {
  exports: Record<string, { 'boring-source'?: string }>
}

const importer = resolve(repositoryRoot, 'source-resolution-fixture.ts')

describe('sandbox source resolution', () => {
  test.each(sandboxSourceSubpaths)(
    'resolves %s through package exports, TypeScript, and the Vite alias',
    async (subpath) => {
      const packageTarget = sandboxPackage.exports[`./${subpath}`]?.['boring-source']
      const expectedSource = resolve(repositoryRoot, `packages/boring-sandbox/src/${subpath}/index.ts`)
      expect(packageTarget).toBe(`./src/${subpath}/index.ts`)
      expect(existsSync(resolve(repositoryRoot, 'packages/boring-sandbox', packageTarget!))).toBe(true)

      const specifier = `@hachej/boring-sandbox/${subpath}`
      const typescriptResolution = ts.resolveModuleName(
        specifier,
        importer,
        {
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          customConditions: ['boring-source'],
        },
        ts.sys,
      ).resolvedModule
      expect(typescriptResolution?.resolvedFileName).toBe(expectedSource)

      const viteConfig = await resolveConfig(
        { configFile: false, resolve: { alias: [sandboxSourceAlias] } },
        'serve',
      )
      expect(await viteConfig.createResolver()(specifier, importer)).toBe(expectedSource)
    },
  )

  test('does not rewrite the package root or undeclared private subpaths', () => {
    for (const specifier of [
      '@hachej/boring-sandbox',
      '@hachej/boring-sandbox/providers/direct/private',
      '@hachej/boring-sandbox/not-exported',
    ]) {
      expect(specifier.replace(sandboxSourceAlias.find, sandboxSourceAlias.replacement)).toBe(specifier)
    }
    expect(sandboxPackage.exports['.']?.['boring-source']).toBeUndefined()
  })
})

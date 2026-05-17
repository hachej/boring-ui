import { describe, expect, it } from 'vitest'
import { createBoringAppViteAliases, type BoringViteAlias } from '../index.js'

function applyViteLikeAlias(aliases: BoringViteAlias[], specifier: string): string {
  for (const alias of aliases) {
    if (typeof alias.find === 'string') {
      if (specifier === alias.find) return alias.replacement
      if (specifier.startsWith(`${alias.find}/`)) {
        return `${alias.replacement}${specifier.slice(alias.find.length)}`
      }
      continue
    }
    if (alias.find.test(specifier)) return specifier.replace(alias.find, alias.replacement)
  }
  return specifier
}

describe('createBoringAppViteAliases — React singleton (always on)', () => {
  it('pins React family imports to the host app singleton paths', () => {
    const { alias } = createBoringAppViteAliases({ appRoot: '/repo/apps/full-app' })
    expect(applyViteLikeAlias(alias, 'react')).toBe('/repo/apps/full-app/node_modules/react')
    expect(applyViteLikeAlias(alias, 'react-dom')).toBe('/repo/apps/full-app/node_modules/react-dom')
    expect(applyViteLikeAlias(alias, 'react-dom/client')).toBe('/repo/apps/full-app/node_modules/react-dom/client.js')
    expect(applyViteLikeAlias(alias, 'react/jsx-runtime')).toBe('/repo/apps/full-app/node_modules/react/jsx-runtime.js')
    expect(applyViteLikeAlias(alias, 'react/jsx-dev-runtime')).toBe('/repo/apps/full-app/node_modules/react/jsx-dev-runtime.js')
  })

  it('returns the dedupe list required for hot plugin hook components', () => {
    const { dedupe } = createBoringAppViteAliases({ appRoot: '/repo/apps/full-app' })
    expect(dedupe).toEqual(['react', 'react-dom'])
  })

  it('does NOT add monorepo source aliases when monorepoRepoRoot is omitted', () => {
    const { alias } = createBoringAppViteAliases({ appRoot: '/repo/apps/full-app' })
    expect(applyViteLikeAlias(alias, '@hachej/boring-workspace')).toBe('@hachej/boring-workspace')
  })

  it('does NOT add monorepo source aliases when BORING_USE_LOCAL_PACKAGES is not 1', () => {
    const prev = process.env.BORING_USE_LOCAL_PACKAGES
    delete process.env.BORING_USE_LOCAL_PACKAGES
    try {
      const { alias } = createBoringAppViteAliases({
        appRoot: '/repo/apps/full-app',
        monorepoRepoRoot: '/repo',
      })
      expect(applyViteLikeAlias(alias, '@hachej/boring-workspace')).toBe('@hachej/boring-workspace')
    } finally {
      if (prev !== undefined) process.env.BORING_USE_LOCAL_PACKAGES = prev
    }
  })
})

describe('createBoringAppViteAliases — monorepo source mode (opt-in)', () => {
  function withLocalPackages<T>(fn: () => T): T {
    const prev = process.env.BORING_USE_LOCAL_PACKAGES
    process.env.BORING_USE_LOCAL_PACKAGES = '1'
    try {
      return fn()
    } finally {
      if (prev !== undefined) process.env.BORING_USE_LOCAL_PACKAGES = prev
      else delete process.env.BORING_USE_LOCAL_PACKAGES
    }
  }

  it('does not let app/front entry alias swallow app/front/styles.css', () => {
    withLocalPackages(() => {
      const { alias } = createBoringAppViteAliases({
        appRoot: '/repo/apps/full-app',
        monorepoRepoRoot: '/repo',
      })
      expect(applyViteLikeAlias(alias, '@hachej/boring-core/app/front/styles.css')).toBe(
        '/repo/packages/core/src/app/front/styles.css',
      )
      expect(applyViteLikeAlias(alias, '@hachej/boring-core/app/front')).toBe(
        '/repo/packages/core/src/app/front/index.ts',
      )
    })
  })

  it('keeps package entry aliases exact while preserving explicit css aliases', () => {
    withLocalPackages(() => {
      const { alias } = createBoringAppViteAliases({
        appRoot: '/repo/apps/full-app',
        monorepoRepoRoot: '/repo',
      })
      expect(applyViteLikeAlias(alias, '@hachej/boring-agent/front/styles.css')).toBe(
        '/repo/packages/agent/src/front/styles/globals.css',
      )
      expect(applyViteLikeAlias(alias, '@hachej/boring-agent/front')).toBe(
        '/repo/packages/agent/src/front/index.ts',
      )
      expect(applyViteLikeAlias(alias, '@hachej/boring-agent/front/extra')).toBe(
        '@hachej/boring-agent/front/extra',
      )
      expect(applyViteLikeAlias(alias, '@hachej/boring-workspace/app/front')).toBe(
        '/repo/packages/workspace/src/app/front/index.ts',
      )
      expect(applyViteLikeAlias(alias, '@hachej/boring-workspace/app/server')).toBe(
        '/repo/packages/workspace/src/app/server/index.ts',
      )
      expect(applyViteLikeAlias(alias, '@hachej/boring-workspace/server')).toBe(
        '/repo/packages/workspace/src/server/index.ts',
      )
    })
  })
})

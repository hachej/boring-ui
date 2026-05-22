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

describe('createBoringAppViteAliases', () => {
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

  it('does NOT alias @hachej/boring-* imports — Vite reads dist via normal resolution', () => {
    // Monorepo contributors who want HMR on boring-* source run `tsup --watch`
    // in each package; consuming Vite picks up dist changes via the normal
    // node_modules path. The helper is intentionally minimal: React singletons only.
    const { alias } = createBoringAppViteAliases({ appRoot: '/repo/apps/full-app' })
    expect(applyViteLikeAlias(alias, '@hachej/boring-workspace')).toBe('@hachej/boring-workspace')
    expect(applyViteLikeAlias(alias, '@hachej/boring-core/app/front')).toBe('@hachej/boring-core/app/front')
    expect(applyViteLikeAlias(alias, '@hachej/boring-agent/server')).toBe('@hachej/boring-agent/server')
  })
})

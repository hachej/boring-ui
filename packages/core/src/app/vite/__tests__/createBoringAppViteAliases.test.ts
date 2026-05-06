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
  it('does not let app/front entry alias swallow app/front/styles.css', () => {
    const aliases = createBoringAppViteAliases({ repoRoot: '/repo' })

    expect(applyViteLikeAlias(aliases, '@hachej/boring-core/app/front/styles.css')).toBe(
      '/repo/packages/core/src/app/front/styles.css',
    )
    expect(applyViteLikeAlias(aliases, '@hachej/boring-core/app/front')).toBe(
      '/repo/packages/core/src/app/front/index.ts',
    )
  })

  it('keeps package entry aliases exact while preserving explicit css aliases', () => {
    const aliases = createBoringAppViteAliases({ repoRoot: '/repo' })

    expect(applyViteLikeAlias(aliases, '@hachej/boring-agent/front/styles.css')).toBe(
      '/repo/packages/agent/src/front/styles/globals.css',
    )
    expect(applyViteLikeAlias(aliases, '@hachej/boring-agent/front')).toBe(
      '/repo/packages/agent/src/front/index.ts',
    )
    expect(applyViteLikeAlias(aliases, '@hachej/boring-agent/front/extra')).toBe(
      '@hachej/boring-agent/front/extra',
    )
    expect(applyViteLikeAlias(aliases, '@hachej/boring-workspace/app/front')).toBe(
      '/repo/packages/workspace/src/app/front/index.ts',
    )
    expect(applyViteLikeAlias(aliases, '@hachej/boring-workspace/app/front/styles.css')).toBe(
      '@hachej/boring-workspace/app/front/styles.css',
    )
  })
})

import { describe, it, expect } from 'vitest'
import { parseRouterPath, mergeChildRouters } from '../trpc/childApp.js'
import { router, publicProcedure } from '../trpc/router.js'

describe('parseRouterPath', () => {
  it('parses module:export format', () => {
    const result = parseRouterPath('src/server/routers/analytics:analyticsRouter')
    expect(result.modulePath).toBe('src/server/routers/analytics')
    expect(result.exportName).toBe('analyticsRouter')
    expect(result.namespaceName).toBe('analytics')
  })

  it('derives namespace from last path segment', () => {
    const result = parseRouterPath('lib/routers/myFeature:featureRouter')
    expect(result.namespaceName).toBe('myFeature')
  })

  it('strips file extensions from namespace', () => {
    const result = parseRouterPath('routers/foo.ts:bar')
    expect(result.namespaceName).toBe('foo')
  })

  it('throws on missing colon separator', () => {
    expect(() => parseRouterPath('no-colon-here')).toThrow(/invalid router path/i)
  })

  it('throws on empty module path', () => {
    expect(() => parseRouterPath(':exportName')).toThrow(/invalid router path/i)
  })

  it('throws on empty export name', () => {
    expect(() => parseRouterPath('module:')).toThrow(/invalid router path/i)
  })
})

describe('mergeChildRouters', () => {
  it('merges child routers into a combined router', () => {
    const childA = router({
      hello: publicProcedure.query(() => 'hello from A'),
    })
    const childB = router({
      world: publicProcedure.query(() => 'hello from B'),
    })

    const merged = mergeChildRouters([
      { name: 'a', router: childA },
      { name: 'b', router: childB },
    ])

    expect(merged).toBeDefined()
    expect(merged._def).toBeDefined()
  })

  it('rejects duplicate namespace names', () => {
    const childA = router({})
    expect(() =>
      mergeChildRouters([
        { name: 'same', router: childA },
        { name: 'same', router: childA },
      ]),
    ).toThrow(/duplicate.*namespace/i)
  })

  it('handles empty array', () => {
    const merged = mergeChildRouters([])
    expect(merged).toBeDefined()
  })
})

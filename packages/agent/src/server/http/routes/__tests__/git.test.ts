import Fastify from 'fastify'
import { afterEach, expect, test, vi } from 'vitest'
import { gitRoutes } from '../git'
import { __gitTestUtils } from '../../../git/gitFileUrl'

afterEach(() => {
  vi.restoreAllMocks()
})

function buildApp(workspaceRoot?: string) {
  const app = Fastify({ logger: false })
  app.register(gitRoutes, {
    getWorkspaceRoot: workspaceRoot === undefined ? undefined : () => workspaceRoot,
  })
  return app
}

// The route delegates git work to resolveGitFileUrl; stub the git invocation
// (an object property, always spyable) so the route test needs no real repo or
// filesystem access — node:fs is banned in routes/. End-to-end resolver
// behavior is covered by src/server/git/__tests__/gitFileUrl.test.ts.

test('passes the workspace-relative path through and returns the resolved url', async () => {
  vi.spyOn(__gitTestUtils, 'runGit').mockImplementation(async (args) => {
    const joined = args.join(' ')
    if (joined === 'rev-parse --show-toplevel') return '/work/root'
    if (joined === 'remote get-url origin') return 'git@github.com:hachej/boring-ui.git'
    if (joined === 'symbolic-ref --quiet --short HEAD') return 'main'
    throw new Error(`unexpected git args: ${joined}`)
  })

  const app = buildApp('/work/root')
  await app.ready()

  const res = await app.inject({ method: 'GET', url: '/api/v1/git/file-url?path=src/main.ts' })
  expect(res.statusCode).toBe(200)
  // The url's blob path reflects the request path resolved under the workspace root.
  expect(res.json()).toEqual({
    enabled: true,
    url: 'https://github.com/hachej/boring-ui/blob/main/src/main.ts',
  })

  await app.close()
})

test('returns a disabled result when the resolver reports no repo', async () => {
  vi.spyOn(__gitTestUtils, 'runGit').mockRejectedValue(new Error('not a repo'))

  const app = buildApp('/work/root')
  await app.ready()

  const res = await app.inject({ method: 'GET', url: '/api/v1/git/file-url?path=index.ts' })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ enabled: false, reason: 'Workspace is not inside a Git repository.' })

  await app.close()
})

test('rejects a missing path with a validation error', async () => {
  const app = buildApp('/work/root')
  await app.ready()

  const res = await app.inject({ method: 'GET', url: '/api/v1/git/file-url' })
  expect(res.statusCode).toBe(400)
  expect(res.json().error.code).toBe('validation_error')

  await app.close()
})

test('rejects a path containing null bytes', async () => {
  const app = buildApp('/work/root')
  await app.ready()

  const res = await app.inject({ method: 'GET', url: '/api/v1/git/file-url?path=a%00b' })
  expect(res.statusCode).toBe(400)
  expect(res.json().error.code).toBe('invalid_path')

  await app.close()
})

test('returns 500 when the workspace root is unavailable', async () => {
  const app = buildApp(undefined)
  await app.ready()

  const res = await app.inject({ method: 'GET', url: '/api/v1/git/file-url?path=index.ts' })
  expect(res.statusCode).toBe(500)
  expect(res.json().error.code).toBe('internal')

  await app.close()
})

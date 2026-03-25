import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const SERVER_ROOT = path.resolve(__dirname, '..')
const SHARED_ROOT = path.resolve(__dirname, '../../shared')

describe('Service layer skeleton structure', () => {
  const expectedServiceFiles = [
    'services/files.ts',
    'services/git.ts',
    'services/exec.ts',
    'services/auth.ts',
    'services/workspaces.ts',
    'services/users.ts',
    'services/capabilities.ts',
    'services/approval.ts',
    'services/uiState.ts',
    'services/github.ts',
    'services/index.ts',
  ]

  const expectedHttpFiles = [
    'http/health.ts',
    'http/files.ts',
    'http/git.ts',
    'http/auth.ts',
    'http/workspaces.ts',
    'http/exec.ts',
  ]

  const expectedTrpcFiles = [
    'trpc/router.ts',
    'trpc/context.ts',
    'trpc/files.ts',
    'trpc/git.ts',
  ]

  const expectedAdapterFiles = ['adapters/bwrap.ts']

  const expectedAuthFiles = [
    'auth/session.ts',
    'auth/neonClient.ts',
    'auth/middleware.ts',
    'auth/validation.ts',
  ]

  const expectedWorkspaceFiles = [
    'workspace/context.ts',
    'workspace/paths.ts',
    'workspace/boundary.ts',
  ]

  it.each(expectedServiceFiles)('services/%s exists', (file) => {
    expect(fs.existsSync(path.join(SERVER_ROOT, file))).toBe(true)
  })

  it.each(expectedHttpFiles)('http/%s exists', (file) => {
    expect(fs.existsSync(path.join(SERVER_ROOT, file))).toBe(true)
  })

  it.each(expectedTrpcFiles)('trpc/%s exists', (file) => {
    expect(fs.existsSync(path.join(SERVER_ROOT, file))).toBe(true)
  })

  it.each(expectedAdapterFiles)('adapters/%s exists', (file) => {
    expect(fs.existsSync(path.join(SERVER_ROOT, file))).toBe(true)
  })

  it.each(expectedAuthFiles)('auth/%s exists', (file) => {
    expect(fs.existsSync(path.join(SERVER_ROOT, file))).toBe(true)
  })

  it.each(expectedWorkspaceFiles)('workspace/%s exists', (file) => {
    expect(fs.existsSync(path.join(SERVER_ROOT, file))).toBe(true)
  })

  it('shared/types.ts exists', () => {
    expect(fs.existsSync(path.join(SHARED_ROOT, 'types.ts'))).toBe(true)
  })
})

describe('Service layer transport independence', () => {
  const serviceFiles = [
    'services/files.ts',
    'services/git.ts',
    'services/exec.ts',
    'services/auth.ts',
    'services/workspaces.ts',
    'services/users.ts',
    'services/capabilities.ts',
    'services/approval.ts',
    'services/uiState.ts',
    'services/github.ts',
  ]

  it.each(serviceFiles)(
    '%s has no Fastify or tRPC imports',
    (file) => {
      const content = fs.readFileSync(path.join(SERVER_ROOT, file), 'utf-8')
      expect(content).not.toMatch(/from\s+['"]fastify/)
      expect(content).not.toMatch(/from\s+['"]@trpc/)
      expect(content).not.toMatch(/from\s+['"]@fastify/)
    },
  )

  it('shared/types.ts has no server framework imports', () => {
    const content = fs.readFileSync(
      path.join(SHARED_ROOT, 'types.ts'),
      'utf-8',
    )
    expect(content).not.toMatch(/from\s+['"]fastify/)
    expect(content).not.toMatch(/from\s+['"]@trpc/)
    expect(content).not.toMatch(/from\s+['"]react/)
  })
})

describe('Service interfaces are exported', () => {
  it('services/index.ts exports all service types', async () => {
    const barrel = await import('../services/index.js')
    // Check that factory functions are exported (they throw, but they're present)
    expect(typeof barrel.createFileService).toBe('function')
    expect(typeof barrel.createGitService).toBe('function')
    expect(typeof barrel.createExecService).toBe('function')
    expect(typeof barrel.createAuthService).toBe('function')
    expect(typeof barrel.createWorkspaceService).toBe('function')
    expect(typeof barrel.createUserService).toBe('function')
    expect(typeof barrel.createCapabilitiesService).toBe('function')
    expect(typeof barrel.createInMemoryApprovalStore).toBe('function')
    expect(typeof barrel.createUIStateService).toBe('function')
    expect(typeof barrel.createGitHubService).toBe('function')
  })

  it('service factory functions throw "Not implemented"', async () => {
    const barrel = await import('../services/index.js')
    expect(() => barrel.createFileService({ workspaceRoot: '/' })).toThrow(
      /not implemented/i,
    )
    expect(() => barrel.createGitService({ workspaceRoot: '/' })).toThrow(
      /not implemented/i,
    )
  })
})

describe('tRPC root router', () => {
  it('creates an empty app router', async () => {
    const { appRouter } = await import('../trpc/router.js')
    expect(appRouter).toBeDefined()
    expect(appRouter._def).toBeDefined()
  })
})

describe('auth/session exports', () => {
  it('exports COOKIE_NAME and appCookieName', async () => {
    const session = await import('../auth/session.js')
    expect(session.COOKIE_NAME).toBe('boring_session')
    expect(session.appCookieName('myapp')).toBe('boring_session_myapp')
    expect(session.appCookieName()).toBe('boring_session')
  })
})

describe('workspace/boundary exports', () => {
  it('exports WORKSPACE_PASSTHROUGH_PREFIXES', async () => {
    const boundary = await import('../workspace/boundary.js')
    expect(boundary.WORKSPACE_PASSTHROUGH_PREFIXES).toContain('/auth/')
    expect(boundary.WORKSPACE_PASSTHROUGH_PREFIXES).toContain('/api/v1/files')
  })
})

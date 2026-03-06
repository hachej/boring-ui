import { describe, expect, it } from 'vitest'
import {
  buildLightningFsNamespace,
  resolveLightningFsUserScope,
  resolveLightningFsWorkspaceScope,
} from './lightningFsNamespace'

describe('lightningFsNamespace helpers', () => {
  it('builds deterministic namespace names for identical inputs', () => {
    const first = buildLightningFsNamespace({
      baseName: 'boring-fs',
      origin: 'https://example.test',
      userScope: 'u-user-1',
      workspaceScope: 'workspace-a',
    })
    const second = buildLightningFsNamespace({
      baseName: 'boring-fs',
      origin: 'https://example.test',
      userScope: 'u-user-1',
      workspaceScope: 'workspace-a',
    })

    expect(first).toBe(second)
  })

  it('changes namespace when workspace scope changes', () => {
    const first = buildLightningFsNamespace({
      baseName: 'boring-fs',
      origin: 'https://example.test',
      userScope: 'u-user-1',
      workspaceScope: 'workspace-a',
    })
    const second = buildLightningFsNamespace({
      baseName: 'boring-fs',
      origin: 'https://example.test',
      userScope: 'u-user-1',
      workspaceScope: 'workspace-b',
    })

    expect(first).not.toBe(second)
  })

  it('changes namespace when user scope changes', () => {
    const first = buildLightningFsNamespace({
      baseName: 'boring-fs',
      origin: 'https://example.test',
      userScope: 'u-user-1',
      workspaceScope: 'workspace-a',
    })
    const second = buildLightningFsNamespace({
      baseName: 'boring-fs',
      origin: 'https://example.test',
      userScope: 'u-user-2',
      workspaceScope: 'workspace-a',
    })

    expect(first).not.toBe(second)
  })

  it('resolves user scope with user_id precedence over email', () => {
    expect(
      resolveLightningFsUserScope({
        userId: 'User-123',
        userEmail: 'fallback@example.com',
        authStatus: 'authenticated',
        sessionScope: 'Session-1',
      }),
    ).toBe('u-user-123')
  })

  it('uses session-scoped anonymous namespace when unauthenticated', () => {
    expect(
      resolveLightningFsUserScope({ authStatus: 'unauthenticated', sessionScope: 'Session-2' }),
    ).toBe('anon-session-2')
  })

  it('uses session-scoped pending namespace before auth status resolves', () => {
    expect(
      resolveLightningFsUserScope({ authStatus: 'unknown', sessionScope: 'Session-3' }),
    ).toBe('pending-session-3')
  })

  it('uses session-scoped authenticated namespace when id/email are unavailable', () => {
    expect(
      resolveLightningFsUserScope({ authStatus: 'authenticated', sessionScope: 'Session-4' }),
    ).toBe('auth-session-4')
  })

  it('normalizes workspace scope and falls back to default', () => {
    expect(resolveLightningFsWorkspaceScope('  My Workspace  ')).toBe('my-workspace')
    expect(resolveLightningFsWorkspaceScope('')).toBe('workspace-default')
  })
})

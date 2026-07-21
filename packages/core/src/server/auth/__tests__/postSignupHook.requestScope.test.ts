import { describe, expect, it, vi } from 'vitest'
import type { CoreConfig } from '../../../shared/types'
import type { WorkspaceStore } from '../../app/types'
import { createPostSignupHook } from '../postSignupHook'
import { REQUEST_SCOPE_WORKSPACE_HEADER } from '../requestWorkspaceScope'

const config = {
  appId: 'test-app',
  auth: { url: 'https://app.example.test' },
  features: { sendWelcomeEmail: false },
} as CoreConfig
const user = { id: 'user-1', email: 'user@example.test', name: 'User' }

function setup(disableDefaultWorkspaceCreation?: boolean) {
  const create = vi.fn()
  const getInviteByTokenHash = vi.fn()
  const acceptInvite = vi.fn()
  const hook = createPostSignupHook({
    config,
    workspaceStore: { create, getInviteByTokenHash, acceptInvite } as unknown as WorkspaceStore,
    transport: null,
    disableDefaultWorkspaceCreation,
  })
  return { hook, create, getInviteByTokenHash, acceptInvite }
}

describe('request-scoped post-signup workspace creation', () => {
  it('keeps generic default-workspace creation unchanged', async () => {
    const { hook, create } = setup()

    await hook(user, null)

    expect(create).toHaveBeenCalledWith(user.id, 'Default workspace', config.appId, { isDefault: true })
  })

  it('accepts a valid invite without creating a personal default', async () => {
    const { hook, create, getInviteByTokenHash, acceptInvite } = setup(true)
    const workspaceId = 'workspace-保险'
    getInviteByTokenHash.mockResolvedValue({
      id: 'invite-1',
      workspaceId,
      email: user.email,
      expiresAt: '2999-01-01T00:00:00.000Z',
      acceptedAt: null,
      lockedUntil: null,
    })

    await hook(user, {
      getHeader: (name: string) => name === 'x-invite-token' ? 'invite-token' : encodeURIComponent(workspaceId),
    })

    expect(acceptInvite).toHaveBeenCalledWith(workspaceId, 'invite-1', user.id)
    expect(create).not.toHaveBeenCalled()
  })

  it('hides and rejects an invite for a foreign workspace', async () => {
    const { hook, create, getInviteByTokenHash, acceptInvite } = setup(true)
    const setCookie = vi.fn()
    getInviteByTokenHash.mockResolvedValue({
      id: 'invite-foreign',
      workspaceId: 'workspace-foreign',
      email: user.email,
      expiresAt: '2999-01-01T00:00:00.000Z',
      acceptedAt: null,
      lockedUntil: null,
    })

    await hook(user, {
      getHeader: (name: string) => name === 'x-invite-token' ? 'invite-token' : name === REQUEST_SCOPE_WORKSPACE_HEADER ? 'workspace-bound' : null,
      setCookie,
    })

    expect(setCookie).toHaveBeenCalledWith('boring_invite_failed', 'invite_not_found', expect.any(Object))
    expect(acceptInvite).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it('fails closed on an invalid internal workspace encoding', async () => {
    const { hook, getInviteByTokenHash, acceptInvite } = setup(true)
    const setCookie = vi.fn()
    getInviteByTokenHash.mockResolvedValue({
      id: 'invite-1', workspaceId: 'workspace-bound', email: user.email,
      expiresAt: '2999-01-01T00:00:00.000Z', acceptedAt: null, lockedUntil: null,
    })

    await hook(user, {
      getHeader: (name: string) => name === 'x-invite-token' ? 'invite-token' : '%E0%A4%A',
      setCookie,
    })

    expect(setCookie).toHaveBeenCalledWith('boring_invite_failed', 'invite_not_found', expect.any(Object))
    expect(acceptInvite).not.toHaveBeenCalled()
  })

  it('preserves the invalid-invite cookie without creating a default', async () => {
    const { hook, create, getInviteByTokenHash } = setup(true)
    const setCookie = vi.fn()
    getInviteByTokenHash.mockResolvedValue(null)

    await hook(user, { getHeader: () => 'missing-token', setCookie })

    expect(setCookie).toHaveBeenCalledWith('boring_invite_failed', 'invite_not_found', {
      maxAge: 60,
      path: '/',
      httpOnly: false,
      sameSite: 'lax',
    })
    expect(create).not.toHaveBeenCalled()
  })

  it('defers typed-domain invite acceptance until persisted type validation exists', async () => {
    const create = vi.fn()
    const getInviteByTokenHash = vi.fn()
    const acceptInvite = vi.fn()
    const hook = createPostSignupHook({
      config,
      workspaceStore: {
        create,
        getInviteByTokenHash,
        acceptInvite,
      } as unknown as WorkspaceStore,
      transport: null,
      disableDefaultWorkspaceCreation: true,
      scopeInvitesToRequestWorkspace: false,
      disableInviteAcceptance: true,
    })

    await hook(user, {
      getHeader: (name: string) => name === 'x-invite-token'
        ? 'invite-token'
        : name === REQUEST_SCOPE_WORKSPACE_HEADER
          ? 'spoofed-workspace'
          : null,
    })

    expect(getInviteByTokenHash).not.toHaveBeenCalled()
    expect(acceptInvite).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })
})

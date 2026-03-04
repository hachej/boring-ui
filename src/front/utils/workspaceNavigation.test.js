import { describe, expect, it, vi } from 'vitest'
import {
  resolveWorkspaceNavigationRoute,
  resolveWorkspaceNavigationRouteFromPathname,
  syncWorkspaceRuntimeAndSettings,
} from './workspaceNavigation'

describe('workspaceNavigation transport regressions', () => {
  it('runs runtime + settings reads on canonical control-plane routes', async () => {
    const apiFetchJson = vi
      .fn()
      .mockResolvedValueOnce({ response: { ok: true }, data: { runtime: { status: 'ready' } } })
      .mockResolvedValueOnce({ response: { ok: true }, data: { settings: { theme: 'dark' } } })
    const apiFetch = vi.fn()

    const result = await syncWorkspaceRuntimeAndSettings({
      workspaceId: 'ws-123',
      writeSettings: false,
      apiFetchJson,
      apiFetch,
    })

    expect(result.runtimePayload).toEqual({ runtime: { status: 'ready' } })
    expect(apiFetchJson).toHaveBeenNthCalledWith(1, '/api/v1/workspaces/ws-123/runtime', {
      query: undefined,
    })
    expect(apiFetchJson).toHaveBeenNthCalledWith(2, '/api/v1/workspaces/ws-123/settings', {
      query: undefined,
    })
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('retries failed runtime and writes extracted settings payload for create flow', async () => {
    const apiFetchJson = vi
      .fn()
      .mockResolvedValueOnce({ response: { ok: true }, data: { runtime: { status: 'failed' } } })
      .mockResolvedValueOnce({ response: { ok: true }, data: { runtime: { status: 'running' } } })
      .mockResolvedValueOnce({
        response: { ok: true },
        data: { data: { workspace_settings: { shell: 'zsh' } } },
      })
    const apiFetch = vi.fn().mockResolvedValue({ ok: true })

    const result = await syncWorkspaceRuntimeAndSettings({
      workspaceId: 'ws-456',
      writeSettings: true,
      apiFetchJson,
      apiFetch,
    })

    expect(result.runtimePayload).toEqual({ runtime: { status: 'running' } })
    expect(apiFetch).toHaveBeenNthCalledWith(1, '/api/v1/workspaces/ws-456/runtime/retry', {
      query: undefined,
      method: 'POST',
    })
    expect(apiFetch).toHaveBeenNthCalledWith(2, '/api/v1/workspaces/ws-456/settings', {
      query: undefined,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shell: 'zsh' }),
    })
  })

  it('does not write settings when read fails even when write flag is enabled', async () => {
    const apiFetchJson = vi
      .fn()
      .mockResolvedValueOnce({ response: { ok: true }, data: { runtime: { status: 'ready' } } })
      .mockResolvedValueOnce({ response: { ok: false }, data: { detail: 'denied' } })
    const apiFetch = vi.fn()

    await syncWorkspaceRuntimeAndSettings({
      workspaceId: 'ws-789',
      writeSettings: true,
      apiFetchJson,
      apiFetch,
    })

    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('resolves canonical workspace navigation route by runtime readiness', () => {
    expect(
      resolveWorkspaceNavigationRoute({
        workspaceId: 'ws-ready',
        runtimePayload: { runtime: { status: 'active' } },
        currentWorkspacePathSuffix: 'app/editor',
      }),
    ).toEqual({
      path: '/w/ws-ready/app/editor',
      query: undefined,
    })

    expect(
      resolveWorkspaceNavigationRoute({
        workspaceId: 'ws-setup',
        runtimePayload: { runtime: { status: 'failed' } },
        currentWorkspacePathSuffix: 'app/editor',
      }),
    ).toEqual({
      path: '/w/ws-setup/setup',
      query: undefined,
    })
  })

  it('bypasses setup routing when onboarding is disabled', () => {
    expect(
      resolveWorkspaceNavigationRoute({
        workspaceId: 'ws-no-onboarding',
        runtimePayload: { runtime: { status: 'failed' } },
        currentWorkspacePathSuffix: 'app/editor',
        onboardingEnabled: false,
      }),
    ).toEqual({
      path: '/w/ws-no-onboarding/app/editor',
      query: undefined,
    })
  })

  it('derives path suffix from pathname to avoid boot-race regressions', () => {
    expect(
      resolveWorkspaceNavigationRouteFromPathname({
        workspaceId: 'ws-live',
        runtimePayload: { runtime: { status: 'ready' } },
        pathname: '/w/ws-current/app/editor',
      }),
    ).toEqual({
      path: '/w/ws-live/app/editor',
      query: undefined,
    })

    expect(
      resolveWorkspaceNavigationRouteFromPathname({
        workspaceId: 'ws-live',
        runtimePayload: { runtime: { status: 'ready' } },
        pathname: '',
      }),
    ).toEqual({
      path: '/w/ws-live/',
      query: undefined,
    })

    expect(
      resolveWorkspaceNavigationRouteFromPathname({
        workspaceId: 'ws-live',
        runtimePayload: { runtime: { status: 'failed' } },
        pathname: '/w/ws-current/app/editor',
      }),
    ).toEqual({
      path: '/w/ws-live/setup',
      query: undefined,
    })
  })

  it('derives direct workspace scope route from pathname when onboarding is disabled', () => {
    expect(
      resolveWorkspaceNavigationRouteFromPathname({
        workspaceId: 'ws-live',
        runtimePayload: { runtime: { status: 'failed' } },
        pathname: '/w/ws-current/app/editor',
        onboardingEnabled: false,
      }),
    ).toEqual({
      path: '/w/ws-live/app/editor',
      query: undefined,
    })
  })
})

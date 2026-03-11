import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  extractUserId,
  extractUserEmail,
  extractWorkspaceId,
  extractWorkspaceSettingsPayload,
  getRuntimeStatus,
  getWorkspaceIdFromPathname,
  getWorkspacePathSuffix,
  isRuntimeReady,
  normalizeWorkspaceList,
  runWithPreflightFallback,
  shouldRetryRuntime,
} from './controlPlane'

describe('controlPlane utils', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('normalizes workspace list payloads from common response envelopes', () => {
    expect(
      normalizeWorkspaceList({
        workspaces: [
          { id: 'ws-1', name: 'One' },
          { workspace_id: 'ws-2', workspace_name: 'Two' },
          { id: 'ws-1', name: 'Duplicate' },
        ],
      }),
    ).toEqual([
      { id: 'ws-1', name: 'One' },
      { id: 'ws-2', name: 'Two' },
    ])

    expect(
      normalizeWorkspaceList({
        data: {
          items: [{ workspaceId: 'ws-3', workspaceName: 'Three' }],
        },
      }),
    ).toEqual([{ id: 'ws-3', name: 'Three' }])
  })

  it('extracts workspace id from direct and nested payloads', () => {
    expect(extractWorkspaceId({ id: 'ws-direct' })).toBe('ws-direct')
    expect(extractWorkspaceId({ workspace: { workspace_id: 'ws-nested' } })).toBe('ws-nested')
    expect(extractWorkspaceId({ data: { workspaceId: 'ws-data' } })).toBe('ws-data')
    expect(extractWorkspaceId({ workspaces: [{ id: 'ws-list' }] })).toBe('ws-list')
  })

  it('extracts user email from me payload variants', () => {
    expect(extractUserEmail({ email: 'direct@example.com' })).toBe('direct@example.com')
    expect(extractUserEmail({ user: { email: 'nested@example.com' } })).toBe('nested@example.com')
    expect(extractUserEmail({ me: { email: 'me@example.com' } })).toBe('me@example.com')
    expect(extractUserEmail({ data: { email: 'data@example.com' } })).toBe('data@example.com')
  })

  it('extracts user id from me payload variants', () => {
    expect(extractUserId({ user_id: 'u-direct' })).toBe('u-direct')
    expect(extractUserId({ user: { userId: 'u-nested' } })).toBe('u-nested')
    expect(extractUserId({ me: { id: 'u-me' } })).toBe('u-me')
    expect(extractUserId({ data: { user_id: 'u-data' } })).toBe('u-data')
  })

  it('parses canonical workspace paths', () => {
    expect(getWorkspaceIdFromPathname('/w/ws-123/app')).toBe('ws-123')
    expect(getWorkspaceIdFromPathname('/w/ws%2Fencoded/setup')).toBe('ws/encoded')
    expect(getWorkspaceIdFromPathname('/api/v1/workspaces')).toBe('')
    expect(getWorkspacePathSuffix('/w/ws-123/app/editor')).toBe('app/editor')
    expect(getWorkspacePathSuffix('/w/ws-123/')).toBe('')
  })

  it('evaluates runtime status and retry conditions', () => {
    expect(getRuntimeStatus({ runtime: { state: 'READY' } })).toBe('ready')
    expect(isRuntimeReady({ runtime: { status: 'running' } })).toBe(true)
    expect(isRuntimeReady({ runtime: { status: 'error' } })).toBe(false)
    expect(shouldRetryRuntime({ runtime: { status: 'failed' } })).toBe(true)
    expect(shouldRetryRuntime({ retryable: true })).toBe(true)
    expect(shouldRetryRuntime({ status: 'provisioning' })).toBe(false)
  })

  it('extracts workspace settings payload for update calls', () => {
    expect(extractWorkspaceSettingsPayload({ settings: { region: 'us' } })).toEqual({ region: 'us' })
    expect(extractWorkspaceSettingsPayload({ workspace_settings: { shell: 'zsh' } })).toEqual({ shell: 'zsh' })
    expect(extractWorkspaceSettingsPayload({ data: { settings: { theme: 'dark' } } })).toEqual({
      theme: 'dark',
    })
    expect(
      extractWorkspaceSettingsPayload({
        settings: { workspace_id: 'ws-123', theme: 'light' },
      }),
    ).toEqual({ workspace_id: 'ws-123', theme: 'light' })
    expect(extractWorkspaceSettingsPayload({ data: { editor: 'vim' } })).toEqual({})
  })

  it('uses fallback route and logs warning when preflight run fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fallbackRoute = { path: '/w/ws-1/', query: undefined }

    const resolvedRoute = await runWithPreflightFallback({
      run: async () => {
        throw new Error('network error')
      },
      fallbackRoute,
      warningMessage: '[UserMenu] Switch workspace preflight failed:',
    })

    expect(resolvedRoute).toEqual(fallbackRoute)
    expect(warnSpy).toHaveBeenCalledWith(
      '[UserMenu] Switch workspace preflight failed:',
      expect.any(Error),
    )
  })

  it('returns run result when preflight succeeds', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const route = { path: '/w/ws-1/app', query: undefined }

    const resolvedRoute = await runWithPreflightFallback({
      run: async () => route,
      fallbackRoute: { path: '/w/ws-1/', query: undefined },
      warningMessage: '[UserMenu] Create workspace preflight failed:',
    })

    expect(resolvedRoute).toEqual(route)
    expect(warnSpy).not.toHaveBeenCalled()
  })
})

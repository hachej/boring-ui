import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/githubImpl.js', async () => {
  const actual = await vi.importActual<typeof import('../services/githubImpl.js')>('../services/githubImpl.js')
  return {
    ...actual,
    exchangeOAuthCode: vi.fn(),
    createGitHubAppJwt: vi.fn(),
    getInstallationToken: vi.fn(),
    listInstallations: vi.fn(),
    listInstallationRepos: vi.fn(),
    listUserInstallations: vi.fn(),
    getGitCredentialsForInstallation: vi.fn(),
  }
})

import { createTestApp, testSessionCookie } from './helpers.js'
import {
  exchangeOAuthCode,
  createGitHubAppJwt,
  getInstallationToken,
  listInstallations,
  listInstallationRepos,
  listUserInstallations,
  getGitCredentialsForInstallation,
} from '../services/githubImpl.js'
import { resetGitHubRouteStateForTests } from '../http/githubRoutes.js'

const mockedExchangeOAuthCode = vi.mocked(exchangeOAuthCode)
const mockedCreateGitHubAppJwt = vi.mocked(createGitHubAppJwt)
const mockedGetInstallationToken = vi.mocked(getInstallationToken)
const mockedListInstallations = vi.mocked(listInstallations)
const mockedListInstallationRepos = vi.mocked(listInstallationRepos)
const mockedListUserInstallations = vi.mocked(listUserInstallations)
const mockedGetGitCredentialsForInstallation = vi.mocked(getGitCredentialsForInstallation)

describe('GitHub lifecycle HTTP routes', () => {
  beforeEach(() => {
    resetGitHubRouteStateForTests()
    mockedExchangeOAuthCode.mockResolvedValue({
      access_token: 'gho_test_token',
      token_type: 'bearer',
    })
    mockedCreateGitHubAppJwt.mockResolvedValue('app-jwt')
    mockedGetInstallationToken.mockResolvedValue('ghs_installation_token')
    mockedListInstallations.mockResolvedValue([])
    mockedListInstallationRepos.mockResolvedValue([])
    mockedListUserInstallations.mockResolvedValue([])
    mockedGetGitCredentialsForInstallation.mockResolvedValue({
      username: 'x-access-token',
      password: 'ghs_installation_token',
    })
  })

  afterEach(() => {
    resetGitHubRouteStateForTests()
    vi.clearAllMocks()
  })

  it('lists installations from the configured GitHub App', async () => {
    const app = createTestApp({
      githubAppId: '123',
      githubAppPrivateKey: 'pem',
      githubSyncEnabled: true,
    })
    const token = await testSessionCookie()
    mockedListInstallations.mockResolvedValue([
      {
        id: 99,
        account: 'boringdata',
        account_type: 'Organization',
        app_slug: 'boring-ui-app',
      },
    ])

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/github/installations',
      cookies: { boring_session: token },
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.payload)).toEqual({
      ok: true,
      installations: [
        {
          id: 99,
          account: 'boringdata',
          account_type: 'Organization',
          app_slug: 'boring-ui-app',
        },
      ],
    })
    expect(mockedListInstallations).toHaveBeenCalledWith('123', 'pem')
    await app.close()
  })

  it('supports connect -> status -> credentials -> disconnect lifecycle', async () => {
    const app = createTestApp({
      githubAppId: '123',
      githubAppPrivateKey: 'pem',
      githubSyncEnabled: true,
    })
    const token = await testSessionCookie()
    const cookies = { boring_session: token }

    const connect = await app.inject({
      method: 'POST',
      url: '/api/v1/github/connect',
      cookies,
      payload: { workspace_id: 'ws-gh-1', installation_id: 42 },
    })
    expect(connect.statusCode).toBe(200)
    expect(JSON.parse(connect.payload)).toEqual({
      ok: true,
      connected: true,
      installation_id: 42,
    })
    expect(mockedCreateGitHubAppJwt).toHaveBeenCalledWith('123', 'pem')
    expect(mockedGetInstallationToken).toHaveBeenCalledWith(42, 'app-jwt')

    const status = await app.inject({
      method: 'GET',
      url: '/api/v1/github/status?workspace_id=ws-gh-1',
      cookies,
    })
    expect(status.statusCode).toBe(200)
    expect(JSON.parse(status.payload)).toMatchObject({
      ok: true,
      configured: true,
      account_linked: true,
      default_installation_id: 42,
      connected: true,
      installation_connected: true,
      installation_id: 42,
      repo_selected: false,
      repo_url: null,
    })

    const credentials = await app.inject({
      method: 'GET',
      url: '/api/v1/github/git-credentials?workspace_id=ws-gh-1',
      cookies,
    })
    expect(credentials.statusCode).toBe(200)
    expect(JSON.parse(credentials.payload)).toEqual({
      username: 'x-access-token',
      password: 'ghs_installation_token',
    })
    expect(mockedGetGitCredentialsForInstallation).toHaveBeenCalledWith(42, '123', 'pem')

    const disconnect = await app.inject({
      method: 'POST',
      url: '/api/v1/github/disconnect',
      cookies,
      payload: { workspace_id: 'ws-gh-1' },
    })
    expect(disconnect.statusCode).toBe(200)
    expect(JSON.parse(disconnect.payload)).toEqual({
      ok: true,
      disconnected: true,
    })

    const statusAfter = await app.inject({
      method: 'GET',
      url: '/api/v1/github/status?workspace_id=ws-gh-1',
      cookies,
    })
    expect(statusAfter.statusCode).toBe(200)
    expect(JSON.parse(statusAfter.payload)).toMatchObject({
      connected: false,
      installation_connected: false,
      installation_id: null,
      repo_selected: false,
      repo_url: null,
    })

    await app.close()
  })

  it('redirects frontend authorize alias to GitHub OAuth with a callback state', async () => {
    const app = createTestApp({
      githubAppClientId: 'client-123',
      githubAppClientSecret: 'client-secret',
      githubAppSlug: 'boring-ui-app',
      githubSyncEnabled: true,
    })
    const token = await testSessionCookie()

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/github/authorize?workspace_id=ws-gh-2',
      cookies: { boring_session: token },
    })

    expect(res.statusCode).toBe(302)
    const location = String(res.headers.location || '')
    expect(location).toContain('https://github.com/login/oauth/authorize')
    const authorizeUrl = new URL(location)
    expect(authorizeUrl.searchParams.get('redirect_uri')).toContain('/api/v1/auth/github/callback')
    expect(authorizeUrl.searchParams.get('state')).toBeTruthy()
    await app.close()
  })

  it('handles OAuth callback with state validation and persists linkage across app restart', async () => {
    mockedListUserInstallations.mockResolvedValue([
      {
        id: 42,
        account: 'boringdata',
        account_type: 'Organization',
        app_slug: 'boring-ui-app',
      },
    ])

    const createConfiguredApp = () => createTestApp({
      githubAppId: '123',
      githubAppPrivateKey: 'pem',
      githubAppClientId: 'client-123',
      githubAppClientSecret: 'client-secret',
      githubAppSlug: 'boring-ui-app',
      githubSyncEnabled: true,
    })

    let app = createConfiguredApp()
    const token = await testSessionCookie()
    const authorize = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/github/authorize?workspace_id=ws-gh-1',
      cookies: { boring_session: token },
    })
    const authorizeUrl = new URL(String(authorize.headers.location))
    const state = authorizeUrl.searchParams.get('state')
    expect(state).toBeTruthy()

    const callback = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/github/callback?code=test-code&state=${encodeURIComponent(String(state))}`,
      cookies: { boring_session: token },
    })
    expect(callback.statusCode).toBe(200)
    expect(callback.headers['content-type']).toContain('text/html')
    expect(callback.payload).toContain('github-callback')
    expect(callback.payload).toContain('"success":true')
    expect(mockedExchangeOAuthCode).toHaveBeenCalledWith('client-123', 'client-secret', 'test-code')
    expect(mockedListUserInstallations).toHaveBeenCalledWith('gho_test_token')

    await app.close()
    app = createConfiguredApp()

    const status = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/github/status?workspace_id=ws-gh-1',
      cookies: { boring_session: token },
    })
    expect(status.statusCode).toBe(200)
    expect(JSON.parse(status.payload)).toMatchObject({
      ok: true,
      account_linked: true,
      default_installation_id: 42,
      connected: true,
      installation_connected: true,
      installation_id: 42,
    })

    const selectRepo = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/github/repo',
      cookies: { boring_session: token },
      payload: {
        workspace_id: 'ws-gh-1',
        repo_url: 'https://github.com/boringdata/boring-ui-repo.git',
      },
    })
    expect(selectRepo.statusCode).toBe(200)

    await app.close()
    app = createConfiguredApp()

    const statusAfterRestart = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/github/status?workspace_id=ws-gh-1',
      cookies: { boring_session: token },
    })
    expect(statusAfterRestart.statusCode).toBe(200)
    expect(JSON.parse(statusAfterRestart.payload)).toMatchObject({
      connected: true,
      installation_id: 42,
      repo_selected: true,
      repo_url: 'https://github.com/boringdata/boring-ui-repo.git',
    })

    await app.close()
  })

  it('renders a callback failure page when OAuth state is invalid', async () => {
    const app = createTestApp({
      githubAppClientId: 'client-123',
      githubAppClientSecret: 'client-secret',
      githubAppSlug: 'boring-ui-app',
      githubSyncEnabled: true,
    })
    const token = await testSessionCookie()

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/github/callback?code=test-code&state=missing-state',
      cookies: { boring_session: token },
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.payload).toContain('github-callback')
    expect(res.payload).toContain('Invalid or expired OAuth state')
    expect(mockedExchangeOAuthCode).not.toHaveBeenCalled()
    await app.close()
  })

  it('lists repos for a specific installation', async () => {
    const app = createTestApp({
      githubAppId: '123',
      githubAppPrivateKey: 'pem',
      githubSyncEnabled: true,
    })
    const token = await testSessionCookie()
    mockedListInstallationRepos.mockResolvedValue([
      {
        id: 7,
        full_name: 'boringdata/boring-ui-repo',
        private: true,
        clone_url: 'https://github.com/boringdata/boring-ui-repo.git',
        ssh_url: 'git@github.com:boringdata/boring-ui-repo.git',
      },
    ])

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/github/repos?installation_id=42',
      cookies: { boring_session: token },
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.payload)).toEqual({
      ok: true,
      repos: [
        {
          id: 7,
          full_name: 'boringdata/boring-ui-repo',
          private: true,
          clone_url: 'https://github.com/boringdata/boring-ui-repo.git',
          ssh_url: 'git@github.com:boringdata/boring-ui-repo.git',
        },
      ],
    })
    expect(mockedListInstallationRepos).toHaveBeenCalledWith(42, '123', 'pem')
    await app.close()
  })

  it('returns 404 for git credentials when workspace is not connected', async () => {
    const app = createTestApp({
      githubAppId: '123',
      githubAppPrivateKey: 'pem',
      githubSyncEnabled: true,
    })
    const token = await testSessionCookie()

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/github/git-credentials?workspace_id=missing-ws',
      cookies: { boring_session: token },
    })

    expect(res.statusCode).toBe(404)
    expect(JSON.parse(res.payload)).toMatchObject({
      error: 'not_found',
      message: 'Workspace not connected to GitHub',
    })
    await app.close()
  })
})

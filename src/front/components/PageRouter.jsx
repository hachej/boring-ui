import { ThemeProvider } from '../shared/hooks'
import AuthPage, { AuthCallbackPage } from '../pages/AuthPage'
import UserSettingsPage from '../pages/UserSettingsPage'
import WorkspaceSettingsPage from '../pages/WorkspaceSettingsPage'
import WorkspaceSetupPage from '../pages/WorkspaceSetupPage'
import { routeHref, routes } from '../shared/utils/routes'

/**
 * Handles full-page routing early returns (auth, settings, setup pages).
 *
 * Returns the matched page view, or null when the main workspace
 * layout should render instead.
 */
export default function PageRouter({
  isAuthLoginPage,
  isAuthCallbackPage,
  isUserSettingsPage,
  isWorkspaceSettingsPage,
  isWorkspaceSetupPage,
  pagePathname,
  capabilities,
  capabilitiesPending,
  userMenuAuthStatus,
  userSettingsWorkspaceId,
  currentWorkspaceId,
  activeWorkspaceName,
}) {
  // Full-page auth views
  if (isAuthLoginPage) {
    return (
      <ThemeProvider>
        <AuthPage authConfig={{
          provider: capabilities?.auth?.provider || 'local',
          neonAuthUrl: capabilities?.auth?.neonAuthUrl || '',
          callbackUrl: capabilities?.auth?.callbackUrl || '',
          emailProvider: capabilities?.auth?.emailProvider || '',
          verificationEmailEnabled: capabilities?.auth?.verificationEmailEnabled !== false,
          redirectUri: new URLSearchParams(window.location.search).get('redirect_uri') || '/',
          initialMode: pagePathname === '/auth/signup'
            ? 'sign_up'
            : pagePathname === '/auth/reset-password'
              ? 'reset_password'
              : 'sign_in',
          appName: capabilities?.auth?.appName || '',
          appDescription: capabilities?.auth?.appDescription || '',
        }} />
      </ThemeProvider>
    )
  }

  if (isAuthCallbackPage) {
    return (
      <ThemeProvider>
        <AuthCallbackPage />
      </ThemeProvider>
    )
  }

  // Auth guard: redirect unauthenticated users to login when control plane is enabled
  // Only enforce when hosted auth is configured; local/dev control-plane mode
  // can run without a frontend login screen.
  const authProviderConfigured = capabilities?.auth?.provider === 'neon' && !!capabilities?.auth?.neonAuthUrl
  if (
    capabilities?.features?.control_plane &&
    authProviderConfigured &&
    userMenuAuthStatus === 'unauthenticated' &&
    !isAuthLoginPage &&
    !isAuthCallbackPage
  ) {
    // Guard against infinite redirect loops: bail after 3 attempts
    const url = new URL(window.location.href)
    const attempts = parseInt(url.searchParams.get('auth_attempts') || '0', 10)
    if (attempts >= 3) {
      return (
        <ThemeProvider>
          <div className="app-error-boundary">
            <div className="app-error-boundary-content">
              <h1 className="app-error-boundary-title">Authentication Error</h1>
              <p className="app-error-boundary-message">
                Unable to sign in after multiple attempts. The auth service may be unavailable.
              </p>
              <button
                type="button"
                className="app-error-boundary-reload"
                onClick={() => { window.location.href = '/auth/login' }}
              >
                Try Again
              </button>
            </div>
          </div>
        </ThemeProvider>
      )
    }
    const redirectUri = encodeURIComponent(window.location.pathname + window.location.search)
    window.location.replace(`/auth/login?redirect_uri=${redirectUri}&auth_attempts=${attempts + 1}`)
    return null
  }

  // Full-page settings views (render instead of DockView)
  if (isUserSettingsPage) {
    return (
      <ThemeProvider>
        <UserSettingsPage workspaceId={userSettingsWorkspaceId || currentWorkspaceId} />
      </ThemeProvider>
    )
  }

  if (isWorkspaceSettingsPage) {
    return (
      <ThemeProvider>
        <WorkspaceSettingsPage workspaceId={currentWorkspaceId} capabilities={capabilities} />
      </ThemeProvider>
    )
  }

  if (isWorkspaceSetupPage) {
    return (
      <ThemeProvider>
        <WorkspaceSetupPage
          workspaceId={currentWorkspaceId}
          workspaceName={activeWorkspaceName}
          capabilities={capabilities}
          capabilitiesPending={capabilitiesPending}
          onComplete={() => {
            const scope = routes.controlPlane.workspaces.scope(currentWorkspaceId)
            window.location.assign(routeHref(scope))
          }}
        />
      </ThemeProvider>
    )
  }

  // No page route matched — render main workspace layout
  return null
}

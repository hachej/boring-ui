import { Suspense, useCallback, useMemo } from 'react'
import type { ReactNode } from 'react'
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Helmet, HelmetProvider } from 'react-helmet-async'

import { AppErrorBoundary } from './AppErrorBoundary.js'
import { ConfigProvider } from './ConfigProvider.js'
import { ThemeProvider } from './ThemeProvider.js'
import { AuthProvider } from './auth/AuthProvider.js'
import { UserIdentityProvider } from './auth/UserIdentityProvider.js'
import { WorkspaceAuthProvider } from './WorkspaceAuthProvider.js'
import { AuthGate } from './AuthGate.js'
import { TopBarSlotProvider, UserMenu } from './components/index.js'
import { SignInPage as DefaultSignInPage } from './auth/SignInPage.js'
import { SignUpPage as DefaultSignUpPage } from './auth/SignUpPage.js'
import { ForgotPasswordPage as DefaultForgotPasswordPage } from './auth/ForgotPasswordPage.js'
import { ResetPasswordPage as DefaultResetPasswordPage } from './auth/ResetPasswordPage.js'
import { VerifyEmailPage as DefaultVerifyEmailPage } from './auth/VerifyEmailPage.js'
import { AuthErrorPage as DefaultAuthErrorPage } from './auth/AuthErrorPage.js'
import { UserSettingsPage as DefaultUserSettingsPage } from './auth/UserSettingsPage.js'
import { InvitesPage } from './workspace/InvitesPage.js'
import { MembersPage } from './workspace/MembersPage.js'
import { WorkspaceSettingsPage } from './workspace/WorkspaceSettingsPage.js'
import { InviteAcceptPage } from './auth/InviteAcceptPage.js'
import { routes } from './utils.js'

export interface CoreFrontAuthPagesOverride {
  signIn?: React.FC
  signUp?: React.FC
  forgotPassword?: React.FC
  resetPassword?: React.FC
  verifyEmail?: React.FC
  authError?: React.FC
  userSettings?: React.FC
}

export interface CoreFrontProps {
  children?: ReactNode
  authPages?: CoreFrontAuthPagesOverride
  cspNonce?: string
  workspaceRoute?: string
  workspaceIdParam?: string
  publicPaths?: string[]
}

const CSP_NONCE_META_NAME = 'boring-csp-nonce'

function PlaceholderPage({ name }: { name: string }) {
  return <div data-testid={`placeholder-${name}`}>{name} (not yet implemented)</div>
}

function readCspNonceFromDom(): string | undefined {
  if (typeof document === 'undefined') return undefined
  const meta = document.querySelector(`meta[name="${CSP_NONCE_META_NAME}"]`)
  const value = meta?.getAttribute('content')?.trim()
  return value ? value : undefined
}

function createDefaultQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        retry: 1,
      },
    },
  })
}

function RouterAuthGate({ children, publicPaths }: { children: ReactNode; publicPaths?: string[] }) {
  const location = useLocation()
  const navigate = useNavigate()
  const authLocation = useMemo(
    () => ({ pathname: location.pathname, search: location.search, hash: location.hash }),
    [location.hash, location.pathname, location.search],
  )
  const navigateWithinRouter = useCallback(
    (to: string, options?: { replace?: boolean }) => {
      navigate(to, { replace: options?.replace })
    },
    [navigate],
  )

  return (
    <AuthGate
      location={authLocation}
      navigate={navigateWithinRouter}
      publicPaths={publicPaths}
    >
      {children}
    </AuthGate>
  )
}

export function CoreFront({ children, authPages, cspNonce, workspaceRoute, workspaceIdParam, publicPaths }: CoreFrontProps) {
  const queryClient = useMemo(createDefaultQueryClient, [])
  const resolvedCspNonce = useMemo(
    () => cspNonce ?? readCspNonceFromDom(),
    [cspNonce],
  )

  const SignInPage = authPages?.signIn ?? DefaultSignInPage
  const SignUpPage = authPages?.signUp ?? DefaultSignUpPage
  const ForgotPasswordPage = authPages?.forgotPassword ?? DefaultForgotPasswordPage
  const ResetPasswordPage = authPages?.resetPassword ?? DefaultResetPasswordPage
  const VerifyEmailPage = authPages?.verifyEmail ?? DefaultVerifyEmailPage
  const AuthErrorPage = authPages?.authError ?? DefaultAuthErrorPage
  const UserSettingsPage = authPages?.userSettings ?? DefaultUserSettingsPage

  return (
    <HelmetProvider>
      <AppErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <ConfigProvider>
            <ThemeProvider>
              <AuthProvider queryClient={queryClient}>
                <UserIdentityProvider>
                  <BrowserRouter>
                    <WorkspaceAuthProvider workspaceRoute={workspaceRoute} workspaceIdParam={workspaceIdParam}>
                      <TopBarSlotProvider slot={<UserMenu />}>
                        <Helmet>
                          {resolvedCspNonce ? (
                            <>
                              <meta name={CSP_NONCE_META_NAME} content={resolvedCspNonce} />
                              <script
                                type="application/json"
                                nonce={resolvedCspNonce}
                                data-boring-csp-nonce="true"
                              >
                                {JSON.stringify({ nonce: resolvedCspNonce })}
                              </script>
                            </>
                          ) : null}
                        </Helmet>
                        <RouterAuthGate publicPaths={['/invites', ...(publicPaths ?? [])]}>
                          <Suspense fallback={null}>
                            <Routes>
                              <Route path={routes.signin} element={<SignInPage />} />
                              <Route path={routes.signup} element={<SignUpPage />} />
                              <Route path={routes.forgotPassword} element={<ForgotPasswordPage />} />
                              <Route path={routes.resetPassword} element={<ResetPasswordPage />} />
                              <Route path={routes.verifyEmail} element={<VerifyEmailPage />} />
                              <Route path={routes.authError} element={<AuthErrorPage />} />
                              <Route path={routes.callbackGithub} element={<PlaceholderPage name="github-callback" />} />
                              <Route path={routes.callbackGoogle} element={<PlaceholderPage name="google-callback" />} />
                              <Route path={routes.me} element={<UserSettingsPage />} />
                              <Route path={routes.workspaceMembers} element={<MembersPage />} />
                              <Route path="/workspace/:id/members" element={<MembersPage />} />
                              <Route path={routes.workspaceInvites} element={<InvitesPage />} />
                              <Route path="/workspace/:id/invites" element={<InvitesPage />} />
                              <Route path={routes.workspaceSettings} element={<WorkspaceSettingsPage />} />
                              <Route path="/workspace/:id/settings" element={<WorkspaceSettingsPage />} />
                              <Route path={routes.inviteAccept} element={<InviteAcceptPage />} />
                              {children}
                            </Routes>
                          </Suspense>
                        </RouterAuthGate>
                      </TopBarSlotProvider>
                    </WorkspaceAuthProvider>
                  </BrowserRouter>
                </UserIdentityProvider>
              </AuthProvider>
            </ThemeProvider>
          </ConfigProvider>
        </QueryClientProvider>
      </AppErrorBoundary>
    </HelmetProvider>
  )
}

import { Suspense, useMemo } from 'react'
import type { ReactNode } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { AppErrorBoundary } from './AppErrorBoundary.js'
import { ConfigProvider } from './ConfigProvider.js'
import { ThemeProvider } from './ThemeProvider.js'
import { AuthProvider } from './auth/AuthProvider.js'
import { UserIdentityProvider } from './auth/UserIdentityProvider.js'
import { WorkspaceAuthProvider } from './WorkspaceAuthProvider.js'
import { AuthGate } from './AuthGate.js'
import { SignInPage as DefaultSignInPage } from './auth/SignInPage.js'
import { SignUpPage as DefaultSignUpPage } from './auth/SignUpPage.js'
import { ForgotPasswordPage as DefaultForgotPasswordPage } from './auth/ForgotPasswordPage.js'
import { ResetPasswordPage as DefaultResetPasswordPage } from './auth/ResetPasswordPage.js'
import { VerifyEmailPage as DefaultVerifyEmailPage } from './auth/VerifyEmailPage.js'
import { UserSettingsPage as DefaultUserSettingsPage } from './auth/UserSettingsPage.js'
import { routes } from './utils.js'

export interface BoringAppAuthPagesOverride {
  signIn?: React.FC
  signUp?: React.FC
  forgotPassword?: React.FC
  resetPassword?: React.FC
  verifyEmail?: React.FC
  userSettings?: React.FC
}

export interface BoringAppProps {
  children?: ReactNode
  authPages?: BoringAppAuthPagesOverride
}

function PlaceholderPage({ name }: { name: string }) {
  return <div data-testid={`placeholder-${name}`}>{name} (not yet implemented)</div>
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

export function BoringApp({ children, authPages }: BoringAppProps) {
  const queryClient = useMemo(createDefaultQueryClient, [])

  const SignInPage = authPages?.signIn ?? DefaultSignInPage
  const SignUpPage = authPages?.signUp ?? DefaultSignUpPage
  const ForgotPasswordPage = authPages?.forgotPassword ?? DefaultForgotPasswordPage
  const ResetPasswordPage = authPages?.resetPassword ?? DefaultResetPasswordPage
  const VerifyEmailPage = authPages?.verifyEmail ?? DefaultVerifyEmailPage
  const UserSettingsPage = authPages?.userSettings ?? DefaultUserSettingsPage

  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ConfigProvider>
          <ThemeProvider>
            <AuthProvider queryClient={queryClient}>
              <UserIdentityProvider>
                <BrowserRouter>
                  <WorkspaceAuthProvider>
                    <AuthGate>
                      <Suspense fallback={null}>
                        <Routes>
                          <Route path={routes.signin} element={<SignInPage />} />
                          <Route path={routes.signup} element={<SignUpPage />} />
                          <Route path={routes.forgotPassword} element={<ForgotPasswordPage />} />
                          <Route path={routes.resetPassword} element={<ResetPasswordPage />} />
                          <Route path={routes.verifyEmail} element={<VerifyEmailPage />} />
                          <Route path={routes.callbackGithub} element={<PlaceholderPage name="github-callback" />} />
                          <Route path={routes.me} element={<UserSettingsPage />} />
                          {children}
                        </Routes>
                      </Suspense>
                    </AuthGate>
                  </WorkspaceAuthProvider>
                </BrowserRouter>
              </UserIdentityProvider>
            </AuthProvider>
          </ThemeProvider>
        </ConfigProvider>
      </QueryClientProvider>
    </AppErrorBoundary>
  )
}

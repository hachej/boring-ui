// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Route } from 'react-router-dom'

const mockUseSession = vi.fn()
const mockSignOut = vi.fn()
const mockSignIn = { email: vi.fn(), social: vi.fn() }

vi.mock('better-auth/react', () => ({
  createAuthClient: () => ({
    useSession: mockUseSession,
    signOut: mockSignOut,
    signIn: mockSignIn,
  }),
}))

vi.mock('better-auth/client/plugins', () => ({
  magicLinkClient: () => ({ id: 'magic-link' }),
}))

import { withBeadId } from '../../server/__tests__/_setup'
import type { RuntimeConfig } from '../../shared/types'
import { BoringApp } from '../BoringApp'
import { useMswHandler } from './_setup'

const BEAD_ID = 'boring-ui-v2-p2at'

function stubMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    })),
  })
}

function mockConfigEndpoint() {
  const payload: RuntimeConfig = {
    appId: 'test-app',
    appName: 'Test App',
    appLogo: null,
    apiBase: '',
    features: { githubOauth: false, invitesEnabled: false, sendWelcomeEmail: false },
  }
  useMswHandler(async (input) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    if (url.endsWith('/api/v1/config')) {
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return undefined
  })
}

function mockApiEndpoints() {
  useMswHandler(async (input) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    if (url.endsWith('/api/v1/workspaces')) {
      return new Response(JSON.stringify({ workspaces: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url.endsWith('/api/v1/me')) {
      return new Response(
        JSON.stringify({
          user: { id: 'user-1', email: 'test@test.dev', name: 'Tester', emailVerified: true, image: null, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
          settings: { displayName: 'Tester', email: 'test@test.dev', settings: {} },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    return undefined
  })
}

function setupAll() {
  mockConfigEndpoint()
  mockApiEndpoints()
}

beforeEach(() => {
  stubMatchMedia()
  vi.clearAllMocks()
  mockUseSession.mockReturnValue({ data: null, isPending: false, error: null })
  mockSignOut.mockResolvedValue(undefined)
  window.history.pushState({}, '', '/auth/signin')
})

afterEach(() => {
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('BoringApp', () => {
  it(
    'renders real SignInPage at /auth/signin',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      setupAll()
      render(<BoringApp />)

      await waitFor(() =>
        expect(screen.getByRole('button', { name: /sign in/i })).toBeTruthy(),
      )
      assertionPassed('renders-default-signin')
    }),
  )

  it(
    'accepts authPages override prop',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      setupAll()
      const CustomSignIn = () => <div data-testid="custom-signin">Custom</div>

      render(<BoringApp authPages={{ signIn: CustomSignIn }} />)

      await waitFor(() =>
        expect(screen.getByTestId('custom-signin')).toBeTruthy(),
      )
      expect(screen.getByTestId('custom-signin').textContent).toBe('Custom')
      assertionPassed('authPages-override')
    }),
  )

  it(
    'renders child Route elements alongside defaults',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      setupAll()
      window.history.pushState({}, '', '/custom')

      render(
        <BoringApp>
          <Route path="/custom" element={<div data-testid="custom-page">Custom Page</div>} />
        </BoringApp>,
      )

      await waitFor(() =>
        expect(screen.getByTestId('custom-page')).toBeTruthy(),
      )
      assertionPassed('child-routes')
    }),
  )

  it(
    'AppErrorBoundary catches ConfigProvider failure',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      vi.spyOn(console, 'error').mockImplementation(() => {})

      useMswHandler(async (input) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url
        if (url.endsWith('/api/v1/config')) {
          return new Response(JSON.stringify({ message: 'Server error' }), {
            status: 500,
            headers: { 'content-type': 'application/json' },
          })
        }
        return undefined
      })

      render(<BoringApp />)

      await waitFor(
        () => expect(screen.getByText(/cannot reach server/i)).toBeTruthy(),
        { timeout: 10_000 },
      )
      assertionPassed('error-boundary-config-fail')
    }),
  )

  it(
    'all default routes are mounted',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      setupAll()
      const routes: Array<{ path: string; marker: string }> = [
        { path: '/auth/signin', marker: 'Sign in' },
        { path: '/auth/signup', marker: 'Create an account' },
        { path: '/auth/forgot-password', marker: 'Forgot password' },
        { path: '/auth/reset-password', marker: 'Link expired' },
        { path: '/auth/verify-email', marker: 'placeholder-verify-email' },
        { path: '/auth/callback/github', marker: 'placeholder-github-callback' },
        { path: '/me', marker: 'placeholder-user-settings' },
      ]

      for (const { path, marker } of routes) {
        window.history.pushState({}, '', path)
        const { unmount } = render(<BoringApp />)

        await waitFor(() => {
          const byText = document.body.textContent?.includes(marker)
          const byTestId = document.querySelector(`[data-testid="${marker}"]`)
          expect(byText || byTestId).toBeTruthy()
        })
        unmount()
      }
      assertionPassed('all-default-routes')
    }),
  )
})

// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Component, Suspense } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { withBeadId } from '../../server/__tests__/_setup'
import type { CapabilitiesResponse } from '../../shared/types'
import { useCapabilities } from '../hooks/useCapabilities'
import { useMswHandler } from './_setup'

const BEAD_ID = 'boring-ui-v2-d37p'

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
}

class TestErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  override render() {
    if (this.state.error) {
      return (
        <div data-testid="capabilities-error">{this.state.error.message}</div>
      )
    }

    return this.props.children
  }
}

function CapabilitiesProbe() {
  const data = useCapabilities()
  return <pre data-testid="capabilities-data">{JSON.stringify(data)}</pre>
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useCapabilities hook', () => {
  it(
    'returns /api/v1/capabilities payload through suspense query',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      const payload: CapabilitiesResponse = {
        core: {
          version: '0.1.0',
          features: {
            invitesEnabled: true,
            githubOauth: false,
            googleOauth: false,
            emailFlows: true,
          },
          auth: {
            emailPassword: true,
            github: false,
            google: false,
            emailVerification: true,
            passwordReset: true,
            magicLink: true,
          },
        },
        agent: {
          runtimeMode: 'local',
          tools: ['terminal'],
          modelProviders: ['anthropic'],
        },
      }

      useMswHandler(async (input) => {
        const url = typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url
        if (!url.endsWith('/api/v1/capabilities')) return undefined

        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      })

      const queryClient = createQueryClient()

      render(
        <QueryClientProvider client={queryClient}>
          <Suspense fallback={<div data-testid="capabilities-loading">loading</div>}>
            <CapabilitiesProbe />
          </Suspense>
        </QueryClientProvider>,
      )

      await waitFor(() =>
        expect(screen.getByTestId('capabilities-data')).toBeTruthy(),
      )

      const rendered = screen.getByTestId('capabilities-data').textContent
      expect(rendered ? JSON.parse(rendered) : null).toEqual(payload)
      assertionPassed('useCapabilities-success')
      queryClient.clear()
    }),
  )

  it(
    'throws suspense query error to error boundary on 503',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      vi.spyOn(console, 'error').mockImplementation(() => {})

      useMswHandler(async (input) => {
        const url = typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url
        if (!url.endsWith('/api/v1/capabilities')) return undefined

        return new Response(
          JSON.stringify({
            error: 'db_unavailable',
            code: 'db_unavailable',
            message: 'service unavailable',
          }),
          {
            status: 503,
            headers: { 'content-type': 'application/json' },
          },
        )
      })

      const queryClient = createQueryClient()

      render(
        <QueryClientProvider client={queryClient}>
          <TestErrorBoundary>
            <Suspense fallback={<div data-testid="capabilities-loading">loading</div>}>
              <CapabilitiesProbe />
            </Suspense>
          </TestErrorBoundary>
        </QueryClientProvider>,
      )

      await waitFor(() =>
        expect(screen.getByTestId('capabilities-error')).toBeTruthy(),
      )

      expect(screen.getByTestId('capabilities-error').textContent).toContain(
        'service unavailable',
      )
      assertionPassed('useCapabilities-503-error-boundary')
      queryClient.clear()
    }),
  )
})

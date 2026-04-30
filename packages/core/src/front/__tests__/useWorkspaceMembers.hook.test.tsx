// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { withBeadId } from '../../server/__tests__/_setup'
import type { EnrichedMember } from '../hooks/useWorkspaceMembers'
import { useWorkspaceMembers } from '../hooks/useWorkspaceMembers'
import { useMswHandler } from './_setup'

const BEAD_ID = 'boring-ui-v2-0o1k'
const WS_ID = 'ws-001'

const MEMBERS: EnrichedMember[] = [
  {
    workspaceId: WS_ID,
    userId: '00000000-0000-0000-0000-000000000001',
    role: 'owner',
    createdAt: '2026-01-01T00:00:00.000Z',
    user: {
      id: '00000000-0000-0000-0000-000000000001',
      email: 'owner@test.dev',
      name: 'Owner',
      image: null,
    },
  },
  {
    workspaceId: WS_ID,
    userId: '00000000-0000-0000-0000-000000000002',
    role: 'editor',
    createdAt: '2026-01-02T00:00:00.000Z',
    user: {
      id: '00000000-0000-0000-0000-000000000002',
      email: 'editor@test.dev',
      name: 'Editor',
      image: null,
    },
  },
]

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
}

function MembersProbe({ workspaceId }: { workspaceId: string }) {
  const { data, isLoading, error } = useWorkspaceMembers(workspaceId)
  if (isLoading) return <div data-testid="members-loading">loading</div>
  if (error) return <div data-testid="members-error">{error.message}</div>
  return (
    <div data-testid="members-data">
      {data?.map((m) => (
        <span key={m.userId} data-testid={`member-${m.userId}`}>
          {m.user.email}:{m.role}
        </span>
      ))}
    </div>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useWorkspaceMembers', () => {
  it(
    'fetches and returns enriched member list',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()

      useMswHandler(async (input) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url
        if (!url.endsWith(`/api/v1/workspaces/${WS_ID}/members`))
          return undefined
        return new Response(JSON.stringify({ members: MEMBERS }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      })

      render(
        <QueryClientProvider client={qc}>
          <MembersProbe workspaceId={WS_ID} />
        </QueryClientProvider>,
      )

      await waitFor(() =>
        expect(screen.getByTestId('members-data')).toBeTruthy(),
      )

      expect(
        screen.getByTestId(`member-${MEMBERS[0].userId}`).textContent,
      ).toBe('owner@test.dev:owner')
      expect(
        screen.getByTestId(`member-${MEMBERS[1].userId}`).textContent,
      ).toBe('editor@test.dev:editor')
      assertionPassed('useWorkspaceMembers-success')
      qc.clear()
    }),
  )

  it(
    'does not fetch when workspaceId is empty',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()
      let fetchCalled = false

      useMswHandler(async (input) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url
        if (url.includes('/members')) fetchCalled = true
        return undefined
      })

      render(
        <QueryClientProvider client={qc}>
          <MembersProbe workspaceId="" />
        </QueryClientProvider>,
      )

      await new Promise((r) => setTimeout(r, 50))
      expect(fetchCalled).toBe(false)
      assertionPassed('useWorkspaceMembers-disabled-empty-id')
      qc.clear()
    }),
  )

  it(
    'encodes workspaceId in the members URL',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()
      const workspaceId = 'team/a b'
      let requestedUrl = ''

      useMswHandler(async (input) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url
        requestedUrl = url
        if (!url.endsWith(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/members`))
          return undefined
        return new Response(JSON.stringify({ members: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      })

      render(
        <QueryClientProvider client={qc}>
          <MembersProbe workspaceId={workspaceId} />
        </QueryClientProvider>,
      )

      await waitFor(() =>
        expect(screen.getByTestId('members-data')).toBeTruthy(),
      )

      expect(requestedUrl).toContain('/api/v1/workspaces/team%2Fa%20b/members')
      assertionPassed('useWorkspaceMembers-encoded-id')
      qc.clear()
    }),
  )

  it(
    'exposes error when API returns 500',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()
      vi.spyOn(console, 'error').mockImplementation(() => {})

      useMswHandler(async (input) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url
        if (!url.endsWith(`/api/v1/workspaces/${WS_ID}/members`))
          return undefined
        return new Response(
          JSON.stringify({ message: 'Internal server error' }),
          {
            status: 500,
            headers: { 'content-type': 'application/json' },
          },
        )
      })

      render(
        <QueryClientProvider client={qc}>
          <MembersProbe workspaceId={WS_ID} />
        </QueryClientProvider>,
      )

      await waitFor(() =>
        expect(screen.getByTestId('members-error')).toBeTruthy(),
      )
      assertionPassed('useWorkspaceMembers-500-error')
      qc.clear()
    }),
  )
})

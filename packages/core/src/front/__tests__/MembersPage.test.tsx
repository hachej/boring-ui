// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { withBeadId } from '../../server/__tests__/_setup'
import type { EnrichedMember } from '../hooks/useWorkspaceMembers'
import { MembersPage } from '../workspace/MembersPage'
import { useMswHandler } from './_setup'

const BEAD_ID = 'boring-ui-v2-am3l'
const WS_ID = 'ws-001'
const OWNER_ID = 'user-owner'
const EDITOR_ID = 'user-editor'

function makeMember(overrides: Partial<EnrichedMember> & { userId: string }): EnrichedMember {
  return {
    workspaceId: WS_ID,
    role: 'editor',
    createdAt: '2026-01-01T00:00:00.000Z',
    user: {
      id: overrides.userId,
      email: `${overrides.userId}@test.dev`,
      name: overrides.userId.replace('user-', '').charAt(0).toUpperCase() + overrides.userId.replace('user-', '').slice(1),
      image: null,
    },
    ...overrides,
  }
}

const OWNER_MEMBER = makeMember({ userId: OWNER_ID, role: 'owner' })
const EDITOR_MEMBER = makeMember({ userId: EDITOR_ID, role: 'editor' })

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => undefined
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => undefined
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => undefined
  }
})

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  })
}

const mockWorkspace = { current: { id: WS_ID, name: 'Test WS', appId: 'test', createdBy: OWNER_ID, createdAt: '2026-01-01', deletedAt: null, isDefault: true } as any }
const mockRole = { current: 'owner' as string | null }
const mockSession = {
  current: {
    data: { user: { id: OWNER_ID, email: 'owner@test.dev' } },
    isPending: false,
    error: null,
  } as any,
}

vi.mock('../WorkspaceAuthProvider.js', () => ({
  useCurrentWorkspace: () => mockWorkspace.current,
  useWorkspaceRole: () => mockRole.current,
}))

vi.mock('../auth/AuthProvider.js', () => ({
  useSession: () => mockSession.current,
}))

function extractUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

function Wrapper({ children, qc }: { children: ReactNode; qc: QueryClient }) {
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/w/${WS_ID}/members`]}>
        <Routes>
          <Route path="/w/:id/members" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

afterEach(() => {
  mockWorkspace.current = { id: WS_ID, name: 'Test WS', appId: 'test', createdBy: OWNER_ID, createdAt: '2026-01-01', deletedAt: null, isDefault: true }
  mockRole.current = 'owner'
  mockSession.current = {
    data: { user: { id: OWNER_ID, email: 'owner@test.dev' } },
    isPending: false,
    error: null,
  }
  vi.restoreAllMocks()
})

function setupMembersHandler(members: EnrichedMember[] = [OWNER_MEMBER, EDITOR_MEMBER]) {
  useMswHandler(async (input) => {
    const url = extractUrl(input)
    if (url.endsWith(`/api/v1/workspaces/${WS_ID}/members`)) {
      return new Response(JSON.stringify({ members }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return undefined
  })
}

describe('MembersPage', () => {
  it(
    'renders all members',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()
      setupMembersHandler()

      render(
        <Wrapper qc={qc}>
          <MembersPage />
        </Wrapper>,
      )

      await waitFor(() => expect(screen.getByTestId('members-list')).toBeTruthy())
      expect(screen.getByTestId(`member-row-${OWNER_ID}`)).toBeTruthy()
      expect(screen.getByTestId(`member-row-${EDITOR_ID}`)).toBeTruthy()
      expect(screen.getByText('(you)')).toBeTruthy()

      assertionPassed('renders-all-members')
      qc.clear()
    }),
  )

  it(
    'role dropdown calls PATCH on change',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()
      let patchCalled = false
      let patchBody: any = null

      useMswHandler(async (input, init) => {
        const url = extractUrl(input)
        if (url.endsWith(`/api/v1/workspaces/${WS_ID}/members`)) {
          return new Response(JSON.stringify({ members: [OWNER_MEMBER, EDITOR_MEMBER] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        if (url.includes(`/members/${EDITOR_ID}/role`) && init?.method === 'PATCH') {
          patchCalled = true
          patchBody = JSON.parse(init.body as string)
          return new Response(
            JSON.stringify({ member: { ...EDITOR_MEMBER, role: 'viewer' } }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        }
        return undefined
      })

      render(
        <Wrapper qc={qc}>
          <MembersPage />
        </Wrapper>,
      )

      await waitFor(() => expect(screen.getByTestId('members-list')).toBeTruthy())

      const user = userEvent.setup()
      await user.click(screen.getByTestId(`role-select-${EDITOR_ID}`))
      await user.click(await screen.findByRole('option', { name: 'viewer' }))

      await waitFor(() => expect(patchCalled).toBe(true))
      expect(patchBody).toEqual({ role: 'viewer' })

      assertionPassed('role-dropdown-patch')
      qc.clear()
    }),
  )

  it(
    'LAST_OWNER on demote shows toast and reverts',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()
      const soloOwner = makeMember({ userId: OWNER_ID, role: 'owner' })
      const viewer = makeMember({ userId: EDITOR_ID, role: 'viewer' })

      useMswHandler(async (input, init) => {
        const url = extractUrl(input)
        if (url.endsWith(`/api/v1/workspaces/${WS_ID}/members`)) {
          return new Response(JSON.stringify({ members: [soloOwner, viewer] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        if (url.includes(`/members/${EDITOR_ID}/role`) && init?.method === 'PATCH') {
          return new Response(
            JSON.stringify({ code: 'last_owner', message: 'Cannot demote the last owner' }),
            { status: 409, headers: { 'content-type': 'application/json' } },
          )
        }
        return undefined
      })

      render(
        <Wrapper qc={qc}>
          <MembersPage />
        </Wrapper>,
      )

      await waitFor(() => expect(screen.getByTestId('members-list')).toBeTruthy())

      const user = userEvent.setup()
      await user.click(screen.getByTestId(`role-select-${EDITOR_ID}`))
      await user.click(await screen.findByRole('option', { name: 'owner' }))

      await waitFor(() => expect(screen.getByTestId('toast')).toBeTruthy())
      expect(screen.getByTestId('toast').textContent).toContain('no owners')

      assertionPassed('last-owner-demote-toast')
      qc.clear()
    }),
  )

  it(
    'remove member as owner: confirm dialog then calls DELETE',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()
      let deleteCalled = false

      useMswHandler(async (input, init) => {
        const url = extractUrl(input)
        if (url.endsWith(`/api/v1/workspaces/${WS_ID}/members`)) {
          return new Response(JSON.stringify({ members: [OWNER_MEMBER, EDITOR_MEMBER] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        if (url.includes(`/members/${EDITOR_ID}`) && init?.method === 'DELETE') {
          deleteCalled = true
          return new Response(JSON.stringify({ removed: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        return undefined
      })

      render(
        <Wrapper qc={qc}>
          <MembersPage />
        </Wrapper>,
      )

      await waitFor(() => expect(screen.getByTestId('members-list')).toBeTruthy())

      const removeBtn = screen.getByTestId(`remove-${EDITOR_ID}`)
      expect(removeBtn.textContent).toBe('Remove')
      fireEvent.click(removeBtn)

      await waitFor(() => expect(screen.getByTestId('confirm-remove')).toBeTruthy())
      fireEvent.click(screen.getByTestId('confirm-remove'))

      await waitFor(() => expect(deleteCalled).toBe(true))

      assertionPassed('remove-member-confirm-delete')
      qc.clear()
    }),
  )

  it(
    'leave workspace as non-owner: button shows "Leave" and calls DELETE on self',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()
      mockRole.current = 'editor'
      mockSession.current = {
        data: { user: { id: EDITOR_ID, email: 'editor@test.dev' } },
        isPending: false,
        error: null,
      }
      let deletedUserId: string | null = null

      useMswHandler(async (input, init) => {
        const url = extractUrl(input)
        if (url.endsWith(`/api/v1/workspaces/${WS_ID}/members`)) {
          return new Response(JSON.stringify({ members: [OWNER_MEMBER, EDITOR_MEMBER] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        const deleteMatch = url.match(/\/members\/(user-[^/]+)$/)
        if (deleteMatch && init?.method === 'DELETE') {
          deletedUserId = deleteMatch[1]
          return new Response(JSON.stringify({ removed: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        return undefined
      })

      render(
        <Wrapper qc={qc}>
          <MembersPage />
        </Wrapper>,
      )

      await waitFor(() => expect(screen.getByTestId('members-list')).toBeTruthy())

      const leaveBtn = screen.getByTestId(`remove-${EDITOR_ID}`)
      expect(leaveBtn.textContent).toBe('Leave')
      fireEvent.click(leaveBtn)

      await waitFor(() => expect(screen.getByTestId('confirm-remove')).toBeTruthy())
      fireEvent.click(screen.getByTestId('confirm-remove'))

      await waitFor(() => expect(deletedUserId).toBe(EDITOR_ID))

      assertionPassed('leave-workspace-self')
      qc.clear()
    }),
  )

  it(
    'LAST_OWNER on remove shows toast',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()

      useMswHandler(async (input, init) => {
        const url = extractUrl(input)
        if (url.endsWith(`/api/v1/workspaces/${WS_ID}/members`)) {
          return new Response(JSON.stringify({ members: [OWNER_MEMBER, EDITOR_MEMBER] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        if (url.includes(`/members/${EDITOR_ID}`) && init?.method === 'DELETE') {
          return new Response(
            JSON.stringify({ code: 'last_owner', message: 'Cannot remove the last owner' }),
            { status: 409, headers: { 'content-type': 'application/json' } },
          )
        }
        return undefined
      })

      render(
        <Wrapper qc={qc}>
          <MembersPage />
        </Wrapper>,
      )

      await waitFor(() => expect(screen.getByTestId('members-list')).toBeTruthy())

      fireEvent.click(screen.getByTestId(`remove-${EDITOR_ID}`))
      await waitFor(() => expect(screen.getByTestId('confirm-remove')).toBeTruthy())
      fireEvent.click(screen.getByTestId('confirm-remove'))

      await waitFor(() => expect(screen.getByTestId('toast')).toBeTruthy())
      expect(screen.getByTestId('toast').textContent).toContain('no owners')

      assertionPassed('last-owner-remove-toast')
      qc.clear()
    }),
  )

  it(
    'non-owner cannot change roles: dropdowns disabled',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()
      mockRole.current = 'editor'
      mockSession.current = {
        data: { user: { id: EDITOR_ID, email: 'editor@test.dev' } },
        isPending: false,
        error: null,
      }
      setupMembersHandler()

      render(
        <Wrapper qc={qc}>
          <MembersPage />
        </Wrapper>,
      )

      await waitFor(() => expect(screen.getByTestId('members-list')).toBeTruthy())

      const ownerSelect = screen.getByTestId(`role-select-${OWNER_ID}`) as HTMLSelectElement
      const editorSelect = screen.getByTestId(`role-select-${EDITOR_ID}`) as HTMLSelectElement

      expect(ownerSelect.disabled).toBe(true)
      expect(editorSelect.disabled).toBe(true)

      assertionPassed('non-owner-disabled-dropdowns')
      qc.clear()
    }),
  )
})

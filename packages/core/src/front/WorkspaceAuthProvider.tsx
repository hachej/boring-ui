import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { matchPath, useLocation, useParams } from 'react-router-dom'
import { useOptionalConfig } from './ConfigProvider.js'
import { useSession } from './auth/AuthProvider.js'
import { apiFetchJson, getHttpErrorDetail } from './utils.js'
import { canUseProtectedApi, isRuntimeEmailVerificationEnabled } from '../shared/authPolicy.js'
import type { MemberRole, Workspace } from '../shared/types.js'

type WorkspaceDetail = {
  workspace: Workspace
  role: MemberRole
}

export type WorkspaceRouteStatus =
  | { status: 'idle'; workspaceId: string | null }
  | { status: 'loading'; workspaceId: string | null }
  | { status: 'matched'; workspaceId: string; workspace: Workspace }
  | { status: 'mismatched'; workspaceId: string; currentWorkspaceId: string | null }
  | { status: 'not-found'; workspaceId: string; message: string }
  | { status: 'forbidden'; workspaceId: string; message: string }
  | { status: 'switch-failed'; workspaceId: string; message: string }

interface WorkspaceContextValue {
  workspace: Workspace | null
  role: MemberRole | null
  routeStatus: WorkspaceRouteStatus
}

const WorkspaceContext = createContext<WorkspaceContextValue>({
  workspace: null,
  role: null,
  routeStatus: { status: 'idle', workspaceId: null },
})

export interface WorkspaceAuthProviderProps {
  children: ReactNode
  workspaceRoute?: string
  workspaceIdParam?: string
}

export const WORKSPACES_QUERY_KEY = ['workspaces'] as const

export function workspaceQueryKey(workspaceId: string | null | undefined) {
  return ['workspace', workspaceId ?? null] as const
}

async function fetchWorkspaces(): Promise<Workspace[]> {
  const data = await apiFetchJson<{ workspaces: Workspace[] }>('/api/v1/workspaces')
  return data.workspaces
}

async function fetchWorkspace(workspaceId: string): Promise<WorkspaceDetail> {
  return await apiFetchJson<WorkspaceDetail>(
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}`,
  )
}

function routePatterns(route: string): string[] {
  const normalized = route.endsWith('/*') ? route.slice(0, -2) : route
  return [`${normalized}/*`, normalized]
}

function workspaceIdFromPath(
  pathname: string,
  workspaceRoute = '/workspace/:id',
  workspaceIdParam = 'id',
): string | null {
  const patterns = [
    ...routePatterns(workspaceRoute),
    '/w/:id/*',
    '/w/:id',
    '/workspace/:id/*',
    '/workspace/:id',
  ]
  for (const pattern of patterns) {
    const match = matchPath(pattern, pathname)
    const id = match?.params[workspaceIdParam]?.trim() ?? match?.params.id?.trim()
    if (id) return id
  }
  return null
}

function routeStatusFromError(workspaceId: string, error: unknown): WorkspaceRouteStatus {
  const detail = getHttpErrorDetail(error)
  if (detail.status === 404 || detail.code === 'not_found') {
    return { status: 'not-found', workspaceId, message: detail.message }
  }
  if (detail.status === 403 || detail.code === 'forbidden' || detail.code === 'not_member') {
    return { status: 'forbidden', workspaceId, message: detail.message }
  }
  return { status: 'switch-failed', workspaceId, message: detail.message }
}

export function WorkspaceAuthProvider({
  children,
  workspaceRoute,
  workspaceIdParam,
}: WorkspaceAuthProviderProps) {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const queryClient = useQueryClient()
  const routeWorkspaceId = id?.trim() ? id : workspaceIdFromPath(location.pathname, workspaceRoute, workspaceIdParam)
  const session = useSession()
  const config = useOptionalConfig()
  const user = session.data?.user ?? null
  const canQueryProtectedApi = canUseProtectedApi(
    user,
    isRuntimeEmailVerificationEnabled(config),
  )

  const workspacesQuery = useQuery({
    queryKey: WORKSPACES_QUERY_KEY,
    queryFn: fetchWorkspaces,
    enabled: canQueryProtectedApi,
  })

  const defaultWorkspace =
    routeWorkspaceId === null
      ? (workspacesQuery.data?.find((workspace) => workspace.isDefault)
        ?? workspacesQuery.data?.[0]
        ?? null)
      : null
  const resolvedId = routeWorkspaceId ?? defaultWorkspace?.id ?? null
  const cachedDetail = resolvedId
    ? queryClient.getQueryData<WorkspaceDetail>(workspaceQueryKey(resolvedId))
    : undefined

  const detailQuery = useQuery({
    queryKey: workspaceQueryKey(resolvedId),
    queryFn: () => {
      if (!resolvedId) {
        throw new Error('Workspace id is required')
      }
      return fetchWorkspace(resolvedId)
    },
    enabled: canQueryProtectedApi && resolvedId !== null,
  })

  const detail = detailQuery.data ?? cachedDetail ?? null
  const workspace = detailQuery.isError ? null : detail?.workspace ?? null
  const role = detailQuery.isError ? null : detail?.role ?? null
  const routeStatus: WorkspaceRouteStatus = (() => {
    if (!canQueryProtectedApi) return { status: 'idle', workspaceId: routeWorkspaceId }
    if (routeWorkspaceId === null) return { status: 'idle', workspaceId: null }
    if (detailQuery.isError) return routeStatusFromError(routeWorkspaceId, detailQuery.error)
    if (detailQuery.isPending && !detail) return { status: 'loading', workspaceId: routeWorkspaceId }
    if (workspace?.id === routeWorkspaceId) return { status: 'matched', workspaceId: routeWorkspaceId, workspace }
    return { status: 'mismatched', workspaceId: routeWorkspaceId, currentWorkspaceId: workspace?.id ?? null }
  })()

  return (
    <WorkspaceContext.Provider value={{ workspace, role, routeStatus }}>
      {children}
    </WorkspaceContext.Provider>
  )
}

export function useCurrentWorkspace(): Workspace | null {
  return useContext(WorkspaceContext).workspace
}

export function useWorkspaceRole(): MemberRole | null {
  return useContext(WorkspaceContext).role
}

export function useWorkspaceRouteStatus(): WorkspaceRouteStatus {
  return useContext(WorkspaceContext).routeStatus
}

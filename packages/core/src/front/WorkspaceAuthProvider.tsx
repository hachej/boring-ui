import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { matchPath, useLocation, useParams } from 'react-router-dom'
import { apiFetchJson } from './utils.js'
import type { MemberRole, Workspace } from '../shared/types.js'

type WorkspaceDetail = {
  workspace: Workspace
  role: MemberRole
}

interface WorkspaceContextValue {
  workspace: Workspace | null
  role: MemberRole | null
}

const WorkspaceContext = createContext<WorkspaceContextValue>({
  workspace: null,
  role: null,
})

export interface WorkspaceAuthProviderProps {
  children: ReactNode
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

function workspaceIdFromPath(pathname: string): string | null {
  const match =
    matchPath('/w/:id/*', pathname) ??
    matchPath('/w/:id', pathname) ??
    matchPath('/workspace/:id/*', pathname) ??
    matchPath('/workspace/:id', pathname)

  const id = match?.params.id?.trim()
  return id ? id : null
}

export function WorkspaceAuthProvider({ children }: WorkspaceAuthProviderProps) {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const queryClient = useQueryClient()
  const routeWorkspaceId = id?.trim() ? id : workspaceIdFromPath(location.pathname)

  const workspacesQuery = useQuery({
    queryKey: WORKSPACES_QUERY_KEY,
    queryFn: fetchWorkspaces,
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
    enabled: resolvedId !== null,
  })

  const detail = detailQuery.data ?? cachedDetail ?? null
  const workspace = detailQuery.isError ? null : detail?.workspace ?? null
  const role = detailQuery.isError ? null : detail?.role ?? null

  return (
    <WorkspaceContext.Provider value={{ workspace, role }}>
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

import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { apiFetchJson } from './utils.js'
import type { MemberRole, Workspace } from '../shared/types.js'

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

export function WorkspaceAuthProvider({ children }: WorkspaceAuthProviderProps) {
  const { id } = useParams<{ id: string }>()
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [role, setRole] = useState<MemberRole | null>(null)

  useEffect(() => {
    let cancelled = false

    async function resolve() {
      try {
        if (id) {
          const data = await apiFetchJson<{ workspace: Workspace; role: MemberRole }>(
            `/api/v1/workspaces/${id}`,
          )
          if (!cancelled) {
            setWorkspace(data.workspace)
            setRole(data.role)
          }
        } else {
          const data = await apiFetchJson<{ workspaces: Workspace[] }>(
            '/api/v1/workspaces',
          )
          if (cancelled) return
          const defaultWs = data.workspaces.find((w) => w.isDefault) ?? data.workspaces[0] ?? null
          if (defaultWs) {
            const detail = await apiFetchJson<{ workspace: Workspace; role: MemberRole }>(
              `/api/v1/workspaces/${defaultWs.id}`,
            )
            if (!cancelled) {
              setWorkspace(detail.workspace)
              setRole(detail.role)
            }
          } else {
            if (!cancelled) {
              setWorkspace(null)
              setRole(null)
            }
          }
        }
      } catch {
        if (!cancelled) {
          setWorkspace(null)
          setRole(null)
        }
      }
    }

    void resolve()
    return () => { cancelled = true }
  }, [id])

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

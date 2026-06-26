import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { writeActiveSessionId } from '@hachej/boring-agent/front'
import {
  WorkspaceProjectsNav,
  type NavProject,
  type ProjectSessionsState,
} from '@hachej/boring-workspace'
import type { SessionItem } from '@hachej/boring-workspace'

import { type Workspace } from '../../shared/types.js'
import { useCurrentWorkspace, useSession, UserMenu, apiFetchJson } from '../../front/index.js'
import { WORKSPACES_QUERY_KEY } from '../../front/WorkspaceAuthProvider.js'

/**
 * Persistent left-bar shell for the full-app: lists workspaces as "Projects"
 * with their sessions nested, and stays mounted across workspace switches (it
 * renders OUTSIDE the routed content, so it never flashes on switch). The
 * workspace package owns the presentational nav; this adapter owns the data
 * (workspace list + lazy per-project session fetch), routing, and the account
 * footer — keeping the workspace package free of any core import.
 *
 * Opening a session writes the active-session key the target workspace reads on
 * mount, then navigates; the sandbox boots lazily on first agent use, so the
 * switch never shows a blocking takeover — the nav persists and only the
 * content pane transitions.
 */

const SESSION_PAGE = 50

export interface WorkspaceProjectsShellProps {
  children: ReactNode
  apiBaseUrl?: string
  workspacePathPrefix?: string
}

function workspacesQueryFn(): Promise<Workspace[]> {
  return apiFetchJson<{ workspaces: Workspace[] }>('/api/v1/workspaces').then((d) => d.workspaces)
}

function hrefForWorkspace(prefix: string, id: string): string {
  const normalized = prefix.startsWith('/') ? prefix : `/${prefix}`
  return `${normalized.replace(/\/$/, '')}/${encodeURIComponent(id)}`
}

/** The nav belongs to the signed-in workspace experience only — not auth pages,
 * the public landing, or standalone settings routes. */
function shouldShowNav(pathname: string, signedIn: boolean): boolean {
  if (!signedIn) return false
  if (pathname === '/' || pathname === '') return true
  return pathname.startsWith('/workspace/')
}

export function WorkspaceProjectsShell({
  children,
  apiBaseUrl = '',
  workspacePathPrefix = '/workspace',
}: WorkspaceProjectsShellProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const session = useSession()
  const currentWorkspace = useCurrentWorkspace()
  const signedIn = Boolean(session.data?.user)

  const workspacesQuery = useQuery({ queryKey: WORKSPACES_QUERY_KEY, queryFn: workspacesQueryFn, enabled: signedIn })
  const workspaces = useMemo(() => workspacesQuery.data ?? [], [workspacesQuery.data])

  const [projectSessions, setProjectSessions] = useState<Record<string, ProjectSessionsState | undefined>>({})

  const fetchSessions = useCallback(
    async (projectId: string, offset: number): Promise<SessionItem[]> => {
      const query = offset > 0 ? `?limit=${SESSION_PAGE}&offset=${offset}` : ''
      // WIP: this route currently BOOTS the runtime binding (getService →
      // getOrCreateRuntimeBinding). PR0 must add a no-boot session-list route
      // (via getSessionStoreForRequest) and this fetch must point at it before
      // multi-project lazy expansion ships. See plan §0 (P0).
      const res = await fetch(`${apiBaseUrl}/api/v1/agent/pi-chat/sessions${query}`, {
        headers: { 'x-boring-workspace-id': projectId, 'x-boring-storage-scope': projectId },
      })
      if (!res.ok) throw new Error(`sessions ${res.status}`)
      const body = (await res.json()) as Array<{ id: string; title?: string | null; updatedAt?: string | number }>
      return body.map((s) => ({ id: s.id, title: s.title ?? 'New session', updatedAt: s.updatedAt }))
    },
    [apiBaseUrl],
  )

  const loadProject = useCallback(
    (projectId: string) => {
      setProjectSessions((current) => {
        const existing = current[projectId]
        if (existing && !existing.error && !existing.loading) return current // cached
        return { ...current, [projectId]: { sessions: existing?.sessions ?? [], loading: true } }
      })
      void fetchSessions(projectId, 0)
        .then((sessions) =>
          setProjectSessions((current) => ({
            ...current,
            [projectId]: { sessions, hasMore: sessions.length >= SESSION_PAGE },
          })),
        )
        .catch(() =>
          setProjectSessions((current) => ({ ...current, [projectId]: { sessions: [], error: true } })),
        )
    },
    [fetchSessions],
  )

  const loadMore = useCallback(
    (projectId: string) => {
      const offset = projectSessions[projectId]?.sessions.length ?? 0
      setProjectSessions((current) => ({ ...current, [projectId]: { ...current[projectId]!, loadingMore: true } }))
      void fetchSessions(projectId, offset)
        .then((more) =>
          setProjectSessions((current) => {
            const prev = current[projectId]?.sessions ?? []
            return { ...current, [projectId]: { sessions: [...prev, ...more], hasMore: more.length >= SESSION_PAGE } }
          }),
        )
        .catch(() =>
          setProjectSessions((current) => ({ ...current, [projectId]: { ...current[projectId]!, loadingMore: false } })),
        )
    },
    [fetchSessions, projectSessions],
  )

  const openSession = useCallback(
    (projectId: string, sessionId: string | null) => {
      // writeActiveSessionId is a SYNCHRONOUS localStorage write; doing it
      // before navigate is race-free — the target WorkspaceAgentFront reads the
      // key on mount (plan §5.1).
      writeActiveSessionId(sessionId ?? undefined, { storageScope: projectId })
      if (currentWorkspace?.id === projectId) {
        // Same project: navigation is a no-op and the workspace is already
        // mounted. PR2 adds a typed `workspaceEvents.openSession` the live
        // WorkspaceAgentFront consumes to switch sessions. Until then this is a
        // no-op (no ad-hoc CustomEvent — plan §5.1).
        return
      }
      navigate(hrefForWorkspace(workspacePathPrefix, projectId))
    },
    [currentWorkspace?.id, navigate, workspacePathPrefix],
  )

  const newChat = useCallback(
    (projectId: string) => openSession(projectId, null),
    [openSession],
  )

  // New project reuses WorkspaceSwitcher's create Dialog (extracted to
  // CreateWorkspaceDialog) in PR2 — not wired here, so the nav omits
  // onNewProject rather than shipping window.prompt (plan §7.2).

  const projects = useMemo<NavProject[]>(
    () =>
      workspaces.map((w) => ({
        id: w.id,
        name: w.name,
        // No status dot in v1: the Workspace type has no runtime state, so a
        // dot would only ever mean "current" dressed as "running" (plan §7.1).
        status: undefined,
        sessionCount: projectSessions[w.id]?.sessions.length,
      })),
    [workspaces, projectSessions],
  )

  if (!shouldShowNav(location.pathname, signedIn) || workspaces.length === 0) {
    return <>{children}</>
  }

  return (
    <div className="flex h-full min-h-0 w-full">
      <aside className="flex w-[264px] shrink-0 flex-col border-r border-[color:oklch(from_var(--border)_l_c_h/0.6)]">
        <WorkspaceProjectsNav
          projects={projects}
          activeProjectId={currentWorkspace?.id ?? null}
          projectSessions={projectSessions}
          expandedStorageKey="boring-core:projects-nav:expanded"
          footer={
            <div className="px-1.5 py-1.5">
              <UserMenu />
            </div>
          }
          onExpandProject={loadProject}
          onLoadMoreSessions={loadMore}
          onOpenSession={openSession}
          onNewChat={newChat}
        />
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

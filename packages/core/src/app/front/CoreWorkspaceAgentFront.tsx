import type { ReactNode } from 'react'
import { Navigate, Route, useParams } from 'react-router-dom'
import {
  CoreFront,
  ThemeToggle,
  UserMenu,
  WorkspaceSwitcher,
  useCurrentWorkspace,
  type CoreFrontAuthPagesOverride,
} from '../../front/index.js'
import {
  WorkspaceAgentFront,
  type WorkspaceAgentFrontProps,
  type WorkspaceAgentSession,
} from '@boring/workspace/app/front'

const DEFAULT_WORKSPACE_ROUTE = '/workspace/:id'
const DEFAULT_WORKSPACE_ID_PARAM = 'id'

export interface CoreWorkspaceAgentFrontProps<
  TSession extends WorkspaceAgentSession = WorkspaceAgentSession,
> extends Omit<WorkspaceAgentFrontProps<TSession>, 'workspaceId'> {
  authPages?: CoreFrontAuthPagesOverride
  cspNonce?: string
  children?: ReactNode
  workspaceRoute?: string
  workspaceIdParam?: string
  workspaceHref?: (workspaceId: string) => string
  loadingFallback?: ReactNode
}

function DefaultTopBarRight() {
  return (
    <div className="flex items-center gap-1">
      <ThemeToggle />
      <UserMenu />
    </div>
  )
}

function DefaultLoadingFallback() {
  return (
    <div className="flex h-screen items-center justify-center text-muted-foreground">
      Loading workspace...
    </div>
  )
}

function HomeRedirect({
  loadingFallback,
  workspaceHref,
}: {
  loadingFallback: ReactNode
  workspaceHref: (workspaceId: string) => string
}) {
  const workspace = useCurrentWorkspace()
  if (!workspace) return <>{loadingFallback}</>
  return <Navigate to={workspaceHref(workspace.id)} replace />
}

function WorkspaceRoute<
  TSession extends WorkspaceAgentSession = WorkspaceAgentSession,
>({
  workspaceIdParam,
  loadingFallback,
  workspaceProps,
}: {
  workspaceIdParam: string
  loadingFallback: ReactNode
  workspaceProps: Omit<WorkspaceAgentFrontProps<TSession>, 'workspaceId'>
}) {
  const params = useParams()
  const workspaceId = params[workspaceIdParam]?.trim()
  if (!workspaceId) return <>{loadingFallback}</>

  return (
    <WorkspaceAgentFront
      {...workspaceProps}
      workspaceId={workspaceId}
    />
  )
}

export function CoreWorkspaceAgentFront<
  TSession extends WorkspaceAgentSession = WorkspaceAgentSession,
>({
  authPages,
  cspNonce,
  children,
  workspaceRoute = DEFAULT_WORKSPACE_ROUTE,
  workspaceIdParam = DEFAULT_WORKSPACE_ID_PARAM,
  workspaceHref = (workspaceId) => `/workspace/${workspaceId}`,
  loadingFallback = <DefaultLoadingFallback />,
  topBarLeft = <WorkspaceSwitcher />,
  topBarRight = <DefaultTopBarRight />,
  appTitle = 'Boring',
  bridgeEndpoint = '/api/v1/ui',
  ...workspaceProps
}: CoreWorkspaceAgentFrontProps<TSession>) {
  const resolvedWorkspaceProps: Omit<WorkspaceAgentFrontProps<TSession>, 'workspaceId'> = {
    ...workspaceProps,
    appTitle,
    topBarLeft,
    topBarRight,
    bridgeEndpoint,
  }

  return (
    <CoreFront authPages={authPages} cspNonce={cspNonce}>
      <Route
        path="/"
        element={
          <HomeRedirect
            loadingFallback={loadingFallback}
            workspaceHref={workspaceHref}
          />
        }
      />
      <Route
        path={workspaceRoute}
        element={
          <WorkspaceRoute
            workspaceIdParam={workspaceIdParam}
            loadingFallback={loadingFallback}
            workspaceProps={resolvedWorkspaceProps}
          />
        }
      />
      {children}
    </CoreFront>
  )
}

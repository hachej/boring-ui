import { useMemo, type ReactNode } from 'react'
import { Navigate, Route, useParams } from 'react-router-dom'
import {
  CoreFront,
  UserMenu,
  WorkspaceSwitcher,
  useCurrentWorkspace,
  type CoreFrontAuthPagesOverride,
} from '../../front/index.js'
import {
  WorkspaceAgentFront,
  WorkspaceBootGate,
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
  bootPreloadPaths?: string[]
}

function DefaultTopBarRight() {
  return <UserMenu />
}

function WorkspaceLoadingPage({
  appTitle,
  topBarLeft,
  topBarRight,
}: {
  appTitle: string
  topBarLeft?: ReactNode
  topBarRight?: ReactNode
}) {
  return (
    <div className="flex h-screen min-h-0 flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-card px-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="text-sm font-semibold">{appTitle}</div>
          {topBarLeft}
        </div>
        {topBarRight}
      </header>
      <main className="flex min-h-0 flex-1 items-center justify-center px-6">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
          <div
            aria-hidden="true"
            className="mx-auto mb-4 h-8 w-8 rounded-full border-2 border-muted-foreground/20 border-t-foreground animate-spin will-change-transform"
          />
          <h1 className="text-lg font-semibold">Switching workspace</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Restoring files, sessions, and saved layout.
          </p>
          <p className="mt-4 text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Loading workspace
          </p>
        </div>
      </main>
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
  bootPreloadPaths,
  workspaceProps,
}: {
  workspaceIdParam: string
  loadingFallback: ReactNode
  bootPreloadPaths?: string[]
  workspaceProps: Omit<WorkspaceAgentFrontProps<TSession>, 'workspaceId'>
}) {
  const params = useParams()
  const currentWorkspace = useCurrentWorkspace()
  const workspaceId = params[workspaceIdParam]?.trim() ?? ''
  const requestHeaders = useMemo(
    () => ({ ...workspaceProps.requestHeaders, 'x-boring-workspace-id': workspaceId }),
    [workspaceId, workspaceProps.requestHeaders],
  )
  const authHeaders = useMemo(
    () => ({ ...workspaceProps.authHeaders, 'x-boring-workspace-id': workspaceId }),
    [workspaceId, workspaceProps.authHeaders],
  )

  if (!workspaceId) return <>{loadingFallback}</>

  if (currentWorkspace?.id !== workspaceId) return <>{loadingFallback}</>

  return (
    <WorkspaceBootGate
      workspaceId={workspaceId}
      requestHeaders={requestHeaders}
      apiBaseUrl={workspaceProps.apiBaseUrl}
      preloadPaths={bootPreloadPaths}
      loadingFallback={loadingFallback}
    >
      <WorkspaceAgentFront
        {...workspaceProps}
        workspaceId={workspaceId}
        requestHeaders={requestHeaders}
        authHeaders={authHeaders}
      />
    </WorkspaceBootGate>
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
  loadingFallback,
  bootPreloadPaths,
  topBarLeft = <WorkspaceSwitcher />,
  topBarRight = <DefaultTopBarRight />,
  appTitle = 'Boring',
  bridgeEndpoint = '/api/v1/ui',
  ...workspaceProps
}: CoreWorkspaceAgentFrontProps<TSession>) {
  const resolvedLoadingFallback = loadingFallback ?? (
    <WorkspaceLoadingPage
      appTitle={appTitle}
      topBarLeft={topBarLeft}
      topBarRight={topBarRight}
    />
  )

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
            loadingFallback={resolvedLoadingFallback}
            workspaceHref={workspaceHref}
          />
        }
      />
      <Route
        path={workspaceRoute}
        element={
          <WorkspaceRoute
            workspaceIdParam={workspaceIdParam}
            loadingFallback={resolvedLoadingFallback}
            bootPreloadPaths={bootPreloadPaths}
            workspaceProps={resolvedWorkspaceProps}
          />
        }
      />
      {children}
    </CoreFront>
  )
}

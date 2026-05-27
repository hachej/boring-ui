import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Navigate, Route, useLocation, useParams } from 'react-router-dom'
import {
  CoreFront,
  UserMenu,
  WorkspaceSwitcher,
  useCurrentWorkspace,
  useSession,
  useWorkspaceRouteStatus,
  type CoreFrontAuthPagesOverride,
} from '../../front/index.js'
import {
  WorkspaceAgentFront,
  type WorkspaceAgentFrontProps,
  type WorkspaceAgentSession,
} from '@hachej/boring-workspace/app/front'
import { ChatFirstAuthenticatedShell } from './chatFirst/ChatFirstAuthenticatedShell.js'
import { ChatFirstPublicShell } from './chatFirst/ChatFirstPublicShell.js'
import {
  clearPendingChatEntry,
  DEFAULT_CHAT_FIRST_PENDING_WORKSPACE_ID,
  PENDING_CHAT_ENTRY_CHANGED_EVENT,
  pendingChatEntryMatchesLocation,
  readPendingChatEntry,
  type PendingChatEntryState,
  workspaceIdFromPath,
} from './chatFirst/pendingChatEntry.js'

const DEFAULT_WORKSPACE_ROUTE = '/workspace/:id'
const DEFAULT_WORKSPACE_ID_PARAM = 'id'

type ChatEntryMode = 'auth-first' | 'chat-first'

export interface CoreWorkspaceAgentFrontProps<
  TSession extends WorkspaceAgentSession = WorkspaceAgentSession,
> extends Omit<WorkspaceAgentFrontProps<TSession>, 'workspaceId' | 'frontPluginHotReload' | 'hotReloadEnabled'> {
  /** Core consumes plugins statically for now; app-level hot reload is explicitly unsupported. */
  hotReload?: false
  chatEntryMode?: ChatEntryMode
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

function usePendingChatDraft() {
  const session = useSession()
  const userId = session.data?.user?.id ?? null
  const [pending, setPending] = useState<PendingChatEntryState | null>(() => (
    userId ? readPendingChatEntry() : null
  ))
  useEffect(() => {
    if (!userId) {
      setPending(null)
      return
    }
    setPending(readPendingChatEntry())
    const syncPending = () => setPending(readPendingChatEntry())
    globalThis.addEventListener?.(PENDING_CHAT_ENTRY_CHANGED_EVENT, syncPending)
    return () => globalThis.removeEventListener?.(PENDING_CHAT_ENTRY_CHANGED_EVENT, syncPending)
  }, [userId])
  return pending
}

function HomeRedirect<TSession extends WorkspaceAgentSession = WorkspaceAgentSession>({
  loadingFallback,
  workspaceHref,
  chatEntryMode,
  appTitle,
  workspaceProps,
}: {
  loadingFallback: ReactNode
  workspaceHref: (workspaceId: string) => string
  chatEntryMode: ChatEntryMode
  appTitle: string
  workspaceProps: Omit<WorkspaceAgentFrontProps<TSession>, 'workspaceId' | 'frontPluginHotReload' | 'hotReloadEnabled'>
}) {
  const location = useLocation()
  const session = useSession()
  const workspace = useCurrentWorkspace()
  const pendingChatEntry = usePendingChatDraft()
  const restorePendingDraft = pendingChatEntryMatchesLocation(
    pendingChatEntry,
    location.pathname,
    location.search,
    location.hash,
  )
  if (!session.data?.user && chatEntryMode === 'chat-first') return <ChatFirstPublicShell appTitle={appTitle} workspaceProps={workspaceProps} />
  if (!workspace && chatEntryMode === 'chat-first' && session.data?.user && restorePendingDraft) {
    return (
      <ChatFirstAuthenticatedShell
        appTitle={appTitle}
        workspaceId={pendingChatEntry?.intendedWorkspaceId ?? DEFAULT_CHAT_FIRST_PENDING_WORKSPACE_ID}
        initialDraft={pendingChatEntry?.draft}
        workspaceProps={workspaceProps}
      />
    )
  }
  if (!workspace) return <>{loadingFallback}</>
  return <Navigate to={workspaceHref(workspace.id)} replace />
}

function WorkspaceRouteErrorPage({ status, message }: { status: 'not-found' | 'forbidden' | 'switch-failed'; message: string }) {
  const title = status === 'not-found'
    ? 'Workspace not found'
    : status === 'forbidden'
      ? 'Workspace unavailable'
      : 'Workspace failed to open'
  return (
    <div className="flex h-screen min-h-0 items-center justify-center bg-background px-6 text-foreground">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  )
}

function WorkspaceRoute<
  TSession extends WorkspaceAgentSession = WorkspaceAgentSession,
>({
  workspaceIdParam,
  loadingFallback,
  bootPreloadPaths,
  workspaceProps,
  chatEntryMode,
  appTitle,
  workspaceRoute,
}: {
  workspaceIdParam: string
  loadingFallback: ReactNode
  bootPreloadPaths?: string[]
  workspaceProps: Omit<WorkspaceAgentFrontProps<TSession>, 'workspaceId' | 'frontPluginHotReload' | 'hotReloadEnabled'>
  chatEntryMode: ChatEntryMode
  appTitle: string
  workspaceRoute: string
}) {
  const params = useParams()
  const location = useLocation()
  const session = useSession()
  const pendingChatEntry = usePendingChatDraft()
  const currentWorkspace = useCurrentWorkspace()
  const routeStatus = useWorkspaceRouteStatus()
  const workspaceId = params[workspaceIdParam]?.trim() ?? workspaceIdFromPath(location.pathname, workspaceRoute, workspaceIdParam) ?? ''
  const restorePendingDraft = pendingChatEntryMatchesLocation(
    pendingChatEntry,
    location.pathname,
    location.search,
    location.hash,
  ) || (
    pendingChatEntry?.returnTo === '/' &&
    currentWorkspace?.id === workspaceId &&
    (!pendingChatEntry.intendedWorkspaceId || pendingChatEntry.intendedWorkspaceId === workspaceId)
  )
  const requestHeaders = useMemo(
    () => ({ ...workspaceProps.requestHeaders, 'x-boring-workspace-id': workspaceId }),
    [workspaceId, workspaceProps.requestHeaders],
  )
  const authHeaders = useMemo(
    () => ({ ...workspaceProps.authHeaders, 'x-boring-workspace-id': workspaceId }),
    [workspaceId, workspaceProps.authHeaders],
  )

  if (!workspaceId) return <>{loadingFallback}</>

  if (!session.data?.user && chatEntryMode === 'chat-first') {
    return <ChatFirstPublicShell appTitle={appTitle} intendedWorkspaceId={workspaceId} workspaceProps={workspaceProps} />
  }

  if (routeStatus.status === 'not-found' || routeStatus.status === 'forbidden' || routeStatus.status === 'switch-failed') {
    return <WorkspaceRouteErrorPage status={routeStatus.status} message={routeStatus.message} />
  }

  if (chatEntryMode === 'chat-first' && restorePendingDraft && (routeStatus.status !== 'matched' || currentWorkspace?.id !== workspaceId)) {
    return (
      <ChatFirstAuthenticatedShell
        appTitle={appTitle}
        workspaceId={workspaceId}
        initialDraft={pendingChatEntry?.draft}
        workspaceProps={workspaceProps}
      />
    )
  }

  if (routeStatus.status !== 'matched' || currentWorkspace?.id !== workspaceId) return <>{loadingFallback}</>

  const shouldRestorePendingDraft = restorePendingDraft && Boolean(pendingChatEntry?.draft)
  const chatParams = {
    ...workspaceProps.chatParams,
    ...(shouldRestorePendingDraft ? { initialDraft: pendingChatEntry?.draft } : {}),
    ...(shouldRestorePendingDraft ? { autoSubmitInitialDraft: true } : {}),
    onBeforeSubmit: async (draft: string, ctx: unknown) => {
      const existing = workspaceProps.chatParams?.onBeforeSubmit as ((draft: string, ctx: unknown) => false | void | Promise<false | void>) | undefined
      const result = await existing?.(draft, ctx)
      if (result !== false) clearPendingChatEntry()
      return result
    },
  }

  return (
    <WorkspaceAgentFront
      key={workspaceId}
      {...workspaceProps}
      workspaceId={workspaceId}
      requestHeaders={requestHeaders}
      authHeaders={authHeaders}
      chatParams={chatParams}
      bootPreloadPaths={bootPreloadPaths}
      frontPluginHotReload={false}
      hotReloadEnabled={false}
    />
  )
}

function chatFirstPublicPaths(workspaceRoute: string): string[] {
  return Array.from(new Set(['/', workspaceRoute, '/workspace/:id', '/w/:id']))
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
  hotReload = false,
  chatEntryMode = 'auth-first',
  ...workspaceProps
}: CoreWorkspaceAgentFrontProps<TSession>) {
  if ((hotReload as unknown) !== false) {
    throw new Error(
      'CoreWorkspaceAgentFront does not support hotReload yet; use static plugin consumption or WorkspaceAgentFront for standalone hot reload.',
    )
  }
  const resolvedLoadingFallback = loadingFallback ?? (
    <WorkspaceLoadingPage
      appTitle={appTitle}
      topBarLeft={topBarLeft}
      topBarRight={topBarRight}
    />
  )

  const resolvedWorkspaceProps: Omit<WorkspaceAgentFrontProps<TSession>, 'workspaceId' | 'frontPluginHotReload' | 'hotReloadEnabled'> = {
    ...workspaceProps,
    appTitle,
    topBarLeft,
    topBarRight,
    bridgeEndpoint,
  }

  return (
    <CoreFront
      authPages={authPages}
      cspNonce={cspNonce}
      workspaceRoute={workspaceRoute}
      workspaceIdParam={workspaceIdParam}
      publicPaths={chatEntryMode === 'chat-first' ? chatFirstPublicPaths(workspaceRoute) : undefined}
    >
      <Route
        path="/"
        element={
          <HomeRedirect
            loadingFallback={resolvedLoadingFallback}
            workspaceHref={workspaceHref}
            chatEntryMode={chatEntryMode}
            appTitle={appTitle}
            workspaceProps={resolvedWorkspaceProps}
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
            chatEntryMode={chatEntryMode}
            appTitle={appTitle}
            workspaceRoute={workspaceRoute}
          />
        }
      />
      {children}
    </CoreFront>
  )
}

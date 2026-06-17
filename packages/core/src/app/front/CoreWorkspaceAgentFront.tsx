import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Navigate, Route, useLocation, useParams } from 'react-router-dom'
import { WorkspaceProvider } from '@hachej/boring-workspace'
import { ErrorState } from '@hachej/boring-ui-kit'
import {
  CoreFront,
  UserMenu,
  WorkspaceSwitcher,
  useConfig,
  useCurrentWorkspace,
  useSession,
  useWorkspaceRouteStatus,
  type CoreFrontAuthPagesOverride,
} from '../../front/index.js'
import {
  parseFullPagePanelLocation,
  WorkspaceAgentFront,
  WorkspaceBootGate,
  WorkspaceFullPagePanel,
  type WorkspaceAgentFrontProps,
  type WorkspaceAgentSession,
} from '@hachej/boring-workspace/app/front'
import { ChatFirstAuthenticatedShell } from './chatFirst/ChatFirstAuthenticatedShell.js'
import { ChatFirstPublicShell, type ChatFirstPublicShellOptions } from './chatFirst/ChatFirstPublicShell.js'
import { installVitePreloadRecovery } from './vitePreloadRecovery.js'
import {
  clearPendingChatEntry,
  DEFAULT_CHAT_FIRST_PENDING_WORKSPACE_ID,
  PENDING_CHAT_ENTRY_CHANGED_EVENT,
  pendingChatEntryMatchesLocation,
  readPendingChatEntry,
  type PendingChatEntryState,
  workspaceIdFromPath,
} from './chatFirst/pendingChatEntry.js'

installVitePreloadRecovery()

const DEFAULT_WORKSPACE_ROUTE = '/workspace/:id'
const DEFAULT_WORKSPACE_ID_PARAM = 'id'
const DEFAULT_FULL_PAGE_BASE_PATH = '/full-page'

type ChatEntryMode = 'auth-first' | 'chat-first'
type RoutedWorkspaceAgentProps<TSession extends WorkspaceAgentSession = WorkspaceAgentSession> = Omit<WorkspaceAgentFrontProps<TSession>, 'workspaceId' | 'frontPluginHotReload' | 'hotReloadEnabled'>

export interface CoreWorkspaceAgentFrontProps<
  TSession extends WorkspaceAgentSession = WorkspaceAgentSession,
> extends RoutedWorkspaceAgentProps<TSession> {
  /** Core consumes plugins statically for now; app-level hot reload is explicitly unsupported. */
  hotReload?: false
  chatEntryMode?: ChatEntryMode
  chatFirstPublicShell?: ChatFirstPublicShellOptions
  /** Extra workspace props used only by the unauthenticated chat-first public shell. */
  chatFirstPublicWorkspaceProps?: Partial<RoutedWorkspaceAgentProps<TSession>>
  publicPaths?: string[]
  authPages?: CoreFrontAuthPagesOverride
  cspNonce?: string
  children?: ReactNode
  workspaceRoute?: string
  workspaceIdParam?: string
  workspaceHref?: (workspaceId: string) => string
  loadingFallback?: ReactNode
  bootPreloadPaths?: string[]
}

/** Default top-bar right content. Exported so apps can compose extra widgets
 * (e.g. a credit balance badge) alongside the user menu. */
export function DefaultTopBarRight() {
  // Theme switching lives in the UserMenu for the full app, so no separate
  // top-bar toggle here (that's only for standalone hosts like the playground).
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

function mergePublicWorkspaceProps<TSession extends WorkspaceAgentSession = WorkspaceAgentSession>(
  workspaceProps: RoutedWorkspaceAgentProps<TSession>,
  publicWorkspaceProps?: Partial<RoutedWorkspaceAgentProps<TSession>>,
): RoutedWorkspaceAgentProps<TSession> {
  if (!publicWorkspaceProps) return workspaceProps
  return {
    ...workspaceProps,
    ...publicWorkspaceProps,
    requestHeaders: {
      ...workspaceProps.requestHeaders,
      ...publicWorkspaceProps.requestHeaders,
    },
    authHeaders: {
      ...workspaceProps.authHeaders,
      ...publicWorkspaceProps.authHeaders,
    },
    chatParams: {
      ...workspaceProps.chatParams,
      ...publicWorkspaceProps.chatParams,
    },
  }
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
  topBarLeft,
  topBarRight,
  workspaceProps,
  chatFirstPublicShell,
  chatFirstPublicWorkspaceProps,
}: {
  loadingFallback?: ReactNode
  workspaceHref: (workspaceId: string) => string
  chatEntryMode: ChatEntryMode
  appTitle?: string
  topBarLeft?: ReactNode
  topBarRight?: ReactNode
  workspaceProps: RoutedWorkspaceAgentProps<TSession>
  chatFirstPublicShell?: ChatFirstPublicShellOptions
  chatFirstPublicWorkspaceProps?: Partial<RoutedWorkspaceAgentProps<TSession>>
}) {
  const config = useConfig()
  const resolvedAppTitle = appTitle ?? config.appName
  const resolvedTopBarLeft = topBarLeft === undefined ? <WorkspaceSwitcher appTitle={resolvedAppTitle} /> : topBarLeft
  const resolvedLoadingFallback = loadingFallback ?? (
    <WorkspaceLoadingPage
      appTitle={resolvedAppTitle}
      topBarLeft={resolvedTopBarLeft}
      topBarRight={topBarRight}
    />
  )
  const resolvedWorkspaceProps: RoutedWorkspaceAgentProps<TSession> = {
    ...workspaceProps,
    appTitle: resolvedAppTitle,
    topBarLeft: resolvedTopBarLeft,
    topBarRight,
  }
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
  if (!session.data?.user && chatEntryMode === 'chat-first') {
    return (
      <ChatFirstPublicShell
        appTitle={resolvedAppTitle}
        publicShell={chatFirstPublicShell}
        workspaceProps={mergePublicWorkspaceProps(resolvedWorkspaceProps, chatFirstPublicWorkspaceProps)}
      />
    )
  }
  if (!workspace && chatEntryMode === 'chat-first' && session.data?.user && restorePendingDraft) {
    return (
      <ChatFirstAuthenticatedShell
        appTitle={resolvedAppTitle}
        workspaceId={pendingChatEntry?.intendedWorkspaceId ?? DEFAULT_CHAT_FIRST_PENDING_WORKSPACE_ID}
        initialDraft={pendingChatEntry?.draft}
        workspaceProps={resolvedWorkspaceProps}
      />
    )
  }
  if (!workspace) return <>{resolvedLoadingFallback}</>
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
  topBarLeft,
  topBarRight,
  workspaceRoute,
  chatFirstPublicShell,
  chatFirstPublicWorkspaceProps,
}: {
  workspaceIdParam: string
  loadingFallback?: ReactNode
  bootPreloadPaths?: string[]
  workspaceProps: RoutedWorkspaceAgentProps<TSession>
  chatEntryMode: ChatEntryMode
  appTitle?: string
  topBarLeft?: ReactNode
  topBarRight?: ReactNode
  workspaceRoute: string
  chatFirstPublicShell?: ChatFirstPublicShellOptions
  chatFirstPublicWorkspaceProps?: Partial<RoutedWorkspaceAgentProps<TSession>>
}) {
  const config = useConfig()
  const resolvedAppTitle = appTitle ?? config.appName
  const resolvedTopBarLeft = topBarLeft === undefined ? <WorkspaceSwitcher appTitle={resolvedAppTitle} /> : topBarLeft
  const resolvedLoadingFallback = loadingFallback ?? (
    <WorkspaceLoadingPage
      appTitle={resolvedAppTitle}
      topBarLeft={resolvedTopBarLeft}
      topBarRight={topBarRight}
    />
  )
  const resolvedWorkspaceProps: RoutedWorkspaceAgentProps<TSession> = {
    ...workspaceProps,
    appTitle: resolvedAppTitle,
    topBarLeft: resolvedTopBarLeft,
    topBarRight,
  }
  const params = useParams()
  const location = useLocation()
  const session = useSession()
  const pendingChatEntry = usePendingChatDraft()
  const currentWorkspace = useCurrentWorkspace()
  const routeStatus = useWorkspaceRouteStatus()
  const workspaceId = params[workspaceIdParam]?.trim() ?? workspaceIdFromPath(location.pathname, workspaceRoute, workspaceIdParam) ?? ''
  const pendingDraftTargetsWorkspace = !pendingChatEntry?.intendedWorkspaceId || pendingChatEntry.intendedWorkspaceId === workspaceId
  const restorePendingDraft = pendingDraftTargetsWorkspace && (
    pendingChatEntryMatchesLocation(
      pendingChatEntry,
      location.pathname,
      location.search,
      location.hash,
    ) || (
      pendingChatEntry?.returnTo === '/' &&
      currentWorkspace?.id === workspaceId
    )
  )
  const requestHeaders = useMemo(
    () => ({ ...resolvedWorkspaceProps.requestHeaders, 'x-boring-workspace-id': workspaceId }),
    [workspaceId, resolvedWorkspaceProps.requestHeaders],
  )
  const authHeaders = useMemo(
    () => ({ ...resolvedWorkspaceProps.authHeaders, 'x-boring-workspace-id': workspaceId }),
    [workspaceId, resolvedWorkspaceProps.authHeaders],
  )
  const scopedFullPageBasePath = useMemo(
    () => resolvedWorkspaceProps.fullPageBasePath
      ? withWorkspaceIdSearch(resolvedWorkspaceProps.fullPageBasePath, workspaceId)
      : undefined,
    [resolvedWorkspaceProps.fullPageBasePath, workspaceId],
  )

  if (!workspaceId) return <>{resolvedLoadingFallback}</>

  if (!session.data?.user && chatEntryMode === 'chat-first') {
    return (
      <ChatFirstPublicShell
        appTitle={resolvedAppTitle}
        intendedWorkspaceId={workspaceId}
        publicShell={chatFirstPublicShell}
        workspaceProps={mergePublicWorkspaceProps(resolvedWorkspaceProps, chatFirstPublicWorkspaceProps)}
      />
    )
  }

  if (routeStatus.status === 'not-found' || routeStatus.status === 'forbidden' || routeStatus.status === 'switch-failed') {
    return <WorkspaceRouteErrorPage status={routeStatus.status} message={routeStatus.message} />
  }

  if (chatEntryMode === 'chat-first' && restorePendingDraft && (routeStatus.status !== 'matched' || currentWorkspace?.id !== workspaceId)) {
    return (
      <ChatFirstAuthenticatedShell
        appTitle={resolvedAppTitle}
        workspaceId={workspaceId}
        initialDraft={pendingChatEntry?.draft}
        workspaceProps={resolvedWorkspaceProps}
      />
    )
  }

  if (routeStatus.status !== 'matched' || currentWorkspace?.id !== workspaceId) return <>{resolvedLoadingFallback}</>

  const shouldRestorePendingDraft = restorePendingDraft && Boolean(pendingChatEntry?.draft)
  const chatParams = {
    ...resolvedWorkspaceProps.chatParams,
    ...(shouldRestorePendingDraft ? { initialDraft: pendingChatEntry?.draft } : {}),
    ...(shouldRestorePendingDraft ? { autoSubmitInitialDraft: true } : {}),
    onBeforeSubmit: async (draft: string, ctx: unknown) => {
      const existing = resolvedWorkspaceProps.chatParams?.onBeforeSubmit as ((draft: string, ctx: unknown) => false | void | Promise<false | void>) | undefined
      const result = await existing?.(draft, ctx)
      if (result !== false) clearPendingChatEntry()
      return result
    },
  }

  return (
    <WorkspaceAgentFront
      key={workspaceId}
      {...resolvedWorkspaceProps}
      workspaceId={workspaceId}
      workspaceLabel={resolvedWorkspaceProps.workspaceLabel ?? currentWorkspace.name}
      requestHeaders={requestHeaders}
      authHeaders={authHeaders}
      fullPageBasePath={scopedFullPageBasePath}
      chatParams={chatParams}
      bootPreloadPaths={bootPreloadPaths}
      frontPluginHotReload={false}
      hotReloadEnabled={false}
      showThemeToggle={false}
    />
  )
}

function fullPageRoutePath(basePath: string): string {
  const path = basePath.split(/[?#]/, 1)[0]?.trim()
  return path || DEFAULT_FULL_PAGE_BASE_PATH
}

function workspaceIdFromFullPageSearch(search: string): string | null {
  const workspaceId = new URLSearchParams(search).get('workspaceId')?.trim()
  return workspaceId || null
}

function withWorkspaceIdSearch(basePath: string, workspaceId: string): string {
  const [pathWithSearch, hash = ''] = basePath.split('#', 2)
  const [path, rawSearch = ''] = pathWithSearch.split('?', 2)
  const search = new URLSearchParams(rawSearch)
  search.set('workspaceId', workspaceId)
  return `${path}?${search.toString()}${hash ? `#${hash}` : ''}`
}

function scopedWorkspaceHeaders(
  workspaceId: string,
  headers: Record<string, string> | undefined,
): Record<string, string> {
  return { ...(headers ?? {}), 'x-boring-workspace-id': workspaceId }
}

function FullPageRouteErrorPage({ code, title, description }: { code: string; title: string; description: string }) {
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground"
      data-testid="full-page-error-state"
      data-full-page-error-code={code}
    >
      <ErrorState className="w-full max-w-lg" title={title} description={description} />
    </div>
  )
}

function CoreFullPagePanelRoute<TSession extends WorkspaceAgentSession = WorkspaceAgentSession>({
  fullPageBasePath,
  loadingFallback,
  bootPreloadPaths,
  workspaceProps,
  appTitle,
}: {
  fullPageBasePath: string
  loadingFallback?: ReactNode
  bootPreloadPaths?: string[]
  workspaceProps: RoutedWorkspaceAgentProps<TSession>
  appTitle?: string
}) {
  const location = useLocation()
  const parsed = useMemo(() => parseFullPagePanelLocation(location.search), [location.search])
  const currentWorkspace = useCurrentWorkspace()
  const workspaceId = workspaceIdFromFullPageSearch(location.search) ?? currentWorkspace?.id ?? ''

  const scopedFullPageBasePath = workspaceId
    ? withWorkspaceIdSearch(fullPageBasePath, workspaceId)
    : fullPageBasePath
  const requestHeaders = workspaceId
    ? scopedWorkspaceHeaders(workspaceId, workspaceProps.requestHeaders)
    : workspaceProps.requestHeaders
  const authHeaders = workspaceId
    ? scopedWorkspaceHeaders(workspaceId, { ...(workspaceProps.requestHeaders ?? {}), ...(workspaceProps.authHeaders ?? {}) })
    : { ...(workspaceProps.requestHeaders ?? {}), ...(workspaceProps.authHeaders ?? {}) }

  if (parsed.error || !parsed.componentId) {
    return (
      <FullPageRouteErrorPage
        code={parsed.error?.code ?? 'FULL_PAGE_PANEL_MISSING_COMPONENT'}
        title="Invalid full-page panel route"
        description={parsed.error?.message ?? 'Missing full-page panel component id.'}
      />
    )
  }

  if (!workspaceId) {
    return <>{loadingFallback ?? (
      <FullPageRouteErrorPage
        code="FULL_PAGE_PANEL_MISSING_WORKSPACE"
        title="Workspace unavailable"
        description="The full-page panel route needs a workspace id. Open it from a workspace or include workspaceId in the URL."
      />
    )}</>
  }

  return (
    <WorkspaceProvider
      chatPanel={workspaceProps.chatPanel}
      plugins={workspaceProps.plugins}
      excludeDefaults={workspaceProps.excludeDefaults}
      panels={workspaceProps.panels}
      commands={workspaceProps.commands}
      catalogs={workspaceProps.catalogs}
      capabilities={workspaceProps.capabilities}
      apiBaseUrl={workspaceProps.apiBaseUrl}
      authHeaders={authHeaders}
      apiTimeout={workspaceProps.apiTimeout}
      defaultTheme={workspaceProps.defaultTheme}
      onThemeChange={workspaceProps.onThemeChange}
      workspaceId={workspaceId}
      workspaceLabel={currentWorkspace?.id === workspaceId ? currentWorkspace.name : workspaceProps.workspaceLabel}
      appTitle={appTitle}
      storageKey={workspaceProps.providerStorageKey ?? `boring-ui-v2:layout:${workspaceId}`}
      persistenceEnabled={workspaceProps.persistenceEnabled}
      manageDocumentTitle={false}
      bridgeEndpoint={null}
      onAuthError={workspaceProps.onAuthError}
      onOpenFile={workspaceProps.onOpenFile}
      debug={workspaceProps.debug}
      frontPluginHotReload={false}
      fullPageBasePath={scopedFullPageBasePath}
    >
      <WorkspaceBootGate
        workspaceId={workspaceId}
        requestHeaders={requestHeaders}
        apiBaseUrl={workspaceProps.apiBaseUrl}
        preloadPaths={bootPreloadPaths}
        provisionWorkspace={workspaceProps.provisionWorkspace}
      >
        <WorkspaceFullPagePanel componentId={parsed.componentId} params={parsed.params} />
      </WorkspaceBootGate>
    </WorkspaceProvider>
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
  topBarLeft,
  topBarRight = <DefaultTopBarRight />,
  appTitle,
  bridgeEndpoint = '/api/v1/ui',
  fullPageBasePath = DEFAULT_FULL_PAGE_BASE_PATH,
  hotReload = false,
  chatEntryMode = 'auth-first',
  chatFirstPublicShell,
  chatFirstPublicWorkspaceProps,
  publicPaths,
  ...workspaceProps
}: CoreWorkspaceAgentFrontProps<TSession>) {
  if ((hotReload as unknown) !== false) {
    throw new Error(
      'CoreWorkspaceAgentFront does not support hotReload yet; use static plugin consumption or WorkspaceAgentFront for standalone hot reload.',
    )
  }
  const routedWorkspaceProps: RoutedWorkspaceAgentProps<TSession> = {
    ...workspaceProps,
    bridgeEndpoint,
    fullPageBasePath,
  }

  return (
    <CoreFront
      authPages={authPages}
      cspNonce={cspNonce}
      workspaceRoute={workspaceRoute}
      workspaceIdParam={workspaceIdParam}
      publicPaths={chatEntryMode === 'chat-first' ? [...chatFirstPublicPaths(workspaceRoute), ...(publicPaths ?? [])] : publicPaths}
    >
      <Route
        path="/"
        element={
          <HomeRedirect
            loadingFallback={loadingFallback}
            workspaceHref={workspaceHref}
            chatEntryMode={chatEntryMode}
            appTitle={appTitle}
            topBarLeft={topBarLeft}
            topBarRight={topBarRight}
            workspaceProps={routedWorkspaceProps}
            chatFirstPublicShell={chatFirstPublicShell}
            chatFirstPublicWorkspaceProps={chatFirstPublicWorkspaceProps}
          />
        }
      />
      <Route
        path={workspaceRoute}
        element={
          <WorkspaceRoute
            workspaceIdParam={workspaceIdParam}
            loadingFallback={loadingFallback}
            bootPreloadPaths={bootPreloadPaths}
            workspaceProps={routedWorkspaceProps}
            chatEntryMode={chatEntryMode}
            appTitle={appTitle}
            topBarLeft={topBarLeft}
            topBarRight={topBarRight}
            workspaceRoute={workspaceRoute}
            chatFirstPublicShell={chatFirstPublicShell}
            chatFirstPublicWorkspaceProps={chatFirstPublicWorkspaceProps}
          />
        }
      />
      <Route
        path={fullPageRoutePath(fullPageBasePath)}
        element={
          <CoreFullPagePanelRoute
            fullPageBasePath={fullPageBasePath}
            loadingFallback={loadingFallback}
            bootPreloadPaths={bootPreloadPaths}
            workspaceProps={routedWorkspaceProps}
            appTitle={appTitle}
          />
        }
      />
      {children}
    </CoreFront>
  )
}

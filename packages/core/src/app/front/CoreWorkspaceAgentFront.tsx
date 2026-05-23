import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Navigate, Route, useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  CoreFront,
  UserMenu,
  WorkspaceSwitcher,
  routes,
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

const DEFAULT_WORKSPACE_ROUTE = '/workspace/:id'
const DEFAULT_WORKSPACE_ID_PARAM = 'id'
const PENDING_CHAT_ENTRY_KEY = 'boring:pending-chat-entry'
const PENDING_CHAT_ENTRY_TTL_MS = 24 * 60 * 60 * 1000

type ChatEntryMode = 'auth-first' | 'chat-first'

interface PendingChatEntryState {
  draft: string
  returnTo: string
  intendedWorkspaceId?: string
  createdAt: number
}

function browserSessionStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

function safeReturnTo(pathname: string, search: string, hash: string): string {
  const candidate = `${pathname || '/'}${search || ''}${hash || ''}`
  if (!candidate.startsWith('/') || candidate.startsWith('//') || /[\0\r\n<>"'`]/.test(candidate)) return '/'
  return candidate
}

function readPendingChatEntry(): PendingChatEntryState | null {
  const storage = browserSessionStorage()
  if (!storage) return null
  try {
    const raw = storage.getItem(PENDING_CHAT_ENTRY_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PendingChatEntryState>
    if (typeof parsed.draft !== 'string' || typeof parsed.returnTo !== 'string' || typeof parsed.createdAt !== 'number') return null
    if (Date.now() - parsed.createdAt > PENDING_CHAT_ENTRY_TTL_MS) {
      storage.removeItem(PENDING_CHAT_ENTRY_KEY)
      return null
    }
    return {
      draft: parsed.draft,
      returnTo: parsed.returnTo,
      intendedWorkspaceId: typeof parsed.intendedWorkspaceId === 'string' ? parsed.intendedWorkspaceId : undefined,
      createdAt: parsed.createdAt,
    }
  } catch {
    return null
  }
}

function writePendingChatEntry(input: Omit<PendingChatEntryState, 'createdAt'>): void {
  const storage = browserSessionStorage()
  if (!storage) return
  storage.setItem(PENDING_CHAT_ENTRY_KEY, JSON.stringify({ ...input, createdAt: Date.now() }))
}

function clearPendingChatEntry(): void {
  browserSessionStorage()?.removeItem(PENDING_CHAT_ENTRY_KEY)
}

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

function ChatFirstPublicShell({
  appTitle,
  intendedWorkspaceId,
}: {
  appTitle: string
  intendedWorkspaceId?: string
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const [draft, setDraft] = useState(() => readPendingChatEntry()?.draft ?? '')
  const returnTo = safeReturnTo(location.pathname, location.search, location.hash)
  const saveAndSignIn = () => {
    writePendingChatEntry({ draft, returnTo, ...(intendedWorkspaceId ? { intendedWorkspaceId } : {}) })
    navigate(`${routes.signin}?redirect=${encodeURIComponent(returnTo)}`)
  }

  return (
    <div className="flex h-screen min-h-0 flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-card px-3">
        <div className="text-sm font-semibold">{appTitle}</div>
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted"
          onClick={saveAndSignIn}
        >
          Sign in
        </button>
      </header>
      <main className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(360px,520px)_1fr]">
        <section className="flex min-h-0 flex-col border-r border-border bg-background p-4">
          <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-5">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Boring agent</p>
              <h1 className="mt-2 text-2xl font-semibold">What do you want to build?</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Type your first prompt. We’ll ask you to sign in before any private workspace, session, or agent call runs.
              </p>
            </div>
            <form
              className="rounded-2xl border border-border bg-card p-3 shadow-sm"
              onSubmit={(event) => {
                event.preventDefault()
                if (draft.trim()) saveAndSignIn()
              }}
            >
              <textarea
                className="min-h-32 w-full resize-none rounded-xl bg-transparent p-2 text-sm outline-none placeholder:text-muted-foreground"
                placeholder="Ask the agent to create an app, analyze a repo, or change files…"
                value={draft}
                onChange={(event) => setDraft(event.currentTarget.value)}
              />
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">Your draft stays local until you sign in.</p>
                <button
                  type="submit"
                  className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                  disabled={!draft.trim()}
                >
                  Send
                </button>
              </div>
            </form>
          </div>
        </section>
        <section className="flex min-h-0 items-center justify-center bg-muted/20 p-6">
          <div className="max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm">
            <h2 className="text-lg font-semibold">Your workspace will appear here</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              After you send your first message and sign in, the agent can create files, open previews, and show artifacts in this area.
            </p>
          </div>
        </section>
      </main>
    </div>
  )
}

function usePendingChatDraft() {
  const session = useSession()
  const [pending, setPending] = useState<PendingChatEntryState | null>(null)
  useEffect(() => {
    if (!session.data?.user) return
    setPending(readPendingChatEntry())
  }, [session.data?.user])
  return pending
}

function HomeRedirect({
  loadingFallback,
  workspaceHref,
  chatEntryMode,
  appTitle,
}: {
  loadingFallback: ReactNode
  workspaceHref: (workspaceId: string) => string
  chatEntryMode: ChatEntryMode
  appTitle: string
}) {
  const session = useSession()
  const workspace = useCurrentWorkspace()
  if (!session.data?.user && chatEntryMode === 'chat-first') return <ChatFirstPublicShell appTitle={appTitle} />
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
}: {
  workspaceIdParam: string
  loadingFallback: ReactNode
  bootPreloadPaths?: string[]
  workspaceProps: Omit<WorkspaceAgentFrontProps<TSession>, 'workspaceId' | 'frontPluginHotReload' | 'hotReloadEnabled'>
  chatEntryMode: ChatEntryMode
  appTitle: string
}) {
  const params = useParams()
  const session = useSession()
  const pendingChatEntry = usePendingChatDraft()
  const currentWorkspace = useCurrentWorkspace()
  const routeStatus = useWorkspaceRouteStatus()
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

  if (!session.data?.user && chatEntryMode === 'chat-first') {
    return <ChatFirstPublicShell appTitle={appTitle} intendedWorkspaceId={workspaceId} />
  }

  if (routeStatus.status === 'not-found' || routeStatus.status === 'forbidden' || routeStatus.status === 'switch-failed') {
    return <WorkspaceRouteErrorPage status={routeStatus.status} message={routeStatus.message} />
  }

  if (routeStatus.status !== 'matched' || currentWorkspace?.id !== workspaceId) return <>{loadingFallback}</>

  const chatParams = {
    ...workspaceProps.chatParams,
    ...(pendingChatEntry?.draft ? { initialDraft: pendingChatEntry.draft } : {}),
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
      publicPaths={chatEntryMode === 'chat-first' ? ['/', '/workspace', '/w'] : undefined}
    >
      <Route
        path="/"
        element={
          <HomeRedirect
            loadingFallback={resolvedLoadingFallback}
            workspaceHref={workspaceHref}
            chatEntryMode={chatEntryMode}
            appTitle={appTitle}
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
          />
        }
      />
      {children}
    </CoreFront>
  )
}

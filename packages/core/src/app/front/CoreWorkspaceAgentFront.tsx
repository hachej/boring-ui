import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { matchPath, Navigate, Route, useLocation, useParams } from 'react-router-dom'
import {
  CoreFront,
  UserMenu,
  WorkspaceSwitcher,
  routes,
  useCurrentWorkspace,
  useSession,
  useSignIn,
  useSignUp,
  useWorkspaceRouteStatus,
  type CoreFrontAuthPagesOverride,
} from '../../front/index.js'
import {
  WorkspaceAgentFront,
  type WorkspaceAgentFrontProps,
  type WorkspaceAgentSession,
} from '@hachej/boring-workspace/app/front'
import { useWorkspaceAttention } from '@hachej/boring-workspace'

const DEFAULT_WORKSPACE_ROUTE = '/workspace/:id'
const DEFAULT_WORKSPACE_ID_PARAM = 'id'
const PENDING_CHAT_ENTRY_KEY = 'boring:pending-chat-entry'
const PENDING_CHAT_ENTRY_TTL_MS = 24 * 60 * 60 * 1000
const DEFAULT_CHAT_FIRST_PENDING_WORKSPACE_ID = 'pending'

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

function routePatterns(route: string): string[] {
  const normalized = route.endsWith('/*') ? route.slice(0, -2) : route
  return [`${normalized}/*`, normalized]
}

function workspaceIdFromPath(
  pathname: string,
  workspaceRoute = DEFAULT_WORKSPACE_ROUTE,
  workspaceIdParam = DEFAULT_WORKSPACE_ID_PARAM,
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

function writePendingChatEntry(input: Omit<PendingChatEntryState, 'createdAt'>): void {
  const storage = browserSessionStorage()
  if (!storage) return
  storage.setItem(PENDING_CHAT_ENTRY_KEY, JSON.stringify({ ...input, createdAt: Date.now() }))
}

function clearPendingChatEntry(): void {
  browserSessionStorage()?.removeItem(PENDING_CHAT_ENTRY_KEY)
}

function pendingChatEntryMatchesLocation(
  pending: PendingChatEntryState | null,
  pathname: string,
  search: string,
  hash: string,
): boolean {
  return Boolean(pending && pending.returnTo === safeReturnTo(pathname, search, hash))
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

function readComposerDraftFromDom(): string {
  if (typeof document === 'undefined') return ''
  const input = document.querySelector('[data-boring-agent-part="composer-input"]') as HTMLTextAreaElement | HTMLInputElement | null
  return input?.value ?? ''
}

function AuthCard({
  returnTo,
  onClose,
}: {
  returnTo: string
  onClose?: () => void
}) {
  const signIn = useSignIn()
  const signUp = useSignUp()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const result = mode === 'signin'
        ? await signIn.email({ email, password })
        : await signUp.email({ email, password, name: name || email })
      if (result.error) {
        setError(result.error.message ?? `${mode === 'signin' ? 'Sign in' : 'Sign up'} failed`)
        return
      }
      window.location.assign(returnTo)
    } catch (err) {
      setError(err instanceof Error ? err.message : `${mode === 'signin' ? 'Sign in' : 'Sign up'} failed`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-4 shadow-2xl">
      {onClose ? (
        <div className="mb-3 flex justify-end">
          <button type="button" className="rounded-full px-2 py-1 text-sm text-muted-foreground hover:bg-muted" onClick={onClose} aria-label="Close sign in">×</button>
        </div>
      ) : null}
        <h2 id="auth-modal-title" className="text-center text-xl font-semibold">
          {mode === 'signin' ? 'Sign in to continue' : 'Create your account'}
        </h2>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          Keep your draft and unlock the full workspace.
        </p>
        <div className="mt-4 grid grid-cols-2 rounded-xl bg-muted p-1 text-sm">
          <button type="button" className={`rounded-lg px-3 py-2 ${mode === 'signin' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`} onClick={() => setMode('signin')}>Sign in</button>
          <button type="button" className={`rounded-lg px-3 py-2 ${mode === 'signup' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`} onClick={() => setMode('signup')}>Sign up</button>
        </div>
        <form className="mt-4 space-y-2.5" onSubmit={submit}>
          {error ? <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive" role="alert">{error}</div> : null}
          {mode === 'signup' ? (
            <input className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-ring" placeholder="Name" value={name} onChange={(event) => setName(event.currentTarget.value)} />
          ) : null}
          <input className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-ring" type="email" autoComplete="email" placeholder="Email" value={email} onChange={(event) => setEmail(event.currentTarget.value)} required />
          <input className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-ring" type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} placeholder="Password" value={password} onChange={(event) => setPassword(event.currentTarget.value)} required />
          <button type="submit" className="w-full rounded-xl bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50" disabled={submitting}>
            {submitting ? 'Please wait…' : mode === 'signin' ? 'Continue with email' : 'Create account'}
          </button>
        </form>
        <p className="mt-4 text-center text-xs text-muted-foreground">By continuing, you agree to continue into your private workspace.</p>
    </div>
  )
}

function AuthModal({ onClose, returnTo }: { onClose: () => void; returnTo: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
      <AuthCard returnTo={returnTo} onClose={onClose} />
    </div>
  )
}

function ChatFirstComposerBlocker() {
  const { addBlocker, removeBlocker } = useWorkspaceAttention()

  useEffect(() => {
    const blocker = {
      id: 'chat-first-workspace-preparing',
      reason: 'workspace-preparing',
      label: 'Preparing workspace… Send will work in a moment.',
    }
    addBlocker(blocker)
    return () => removeBlocker(blocker.id)
  }, [addBlocker, removeBlocker])

  return null
}

function ChatFirstAuthenticatedShell<TSession extends WorkspaceAgentSession = WorkspaceAgentSession>({
  appTitle,
  workspaceId,
  initialDraft,
  workspaceProps,
  showComposerBlocker = true,
}: {
  appTitle: string
  workspaceId: string
  initialDraft?: string
  workspaceProps: Omit<WorkspaceAgentFrontProps<TSession>, 'workspaceId' | 'frontPluginHotReload' | 'hotReloadEnabled'>
  showComposerBlocker?: boolean
}) {
  return (
    <WorkspaceAgentFront
      {...workspaceProps}
      workspaceId={workspaceId}
      appTitle={appTitle}
      topBarLeft={null}
      sessions={[]}
      activeSessionId={null}
      onSwitchSession={() => undefined}
      onCreateSession={() => undefined}
      onDeleteSession={() => undefined}
      provisionWorkspace={false}
      bootPreloadPaths={[]}
      bridgeEndpoint={null}
      excludeDefaults={['filesystem']}
      plugins={[]}
      catalogs={[]}
      commands={[]}
      persistenceEnabled={false}
      navEnabled={false}
      defaultNavOpen={false}
      defaultSurfaceOpen={false}
      beforeShell={showComposerBlocker ? <>{workspaceProps.beforeShell}<ChatFirstComposerBlocker /></> : workspaceProps.beforeShell}
      chatParams={{
        ...workspaceProps.chatParams,
        composerBlockers: undefined,
        ...(initialDraft ? { initialDraft } : {}),
        serverResourcesEnabled: false,
        hydrateMessages: false,
        onBeforeSubmit: workspaceProps.chatParams?.onBeforeSubmit ?? (() => false as const),
      }}
      frontPluginHotReload={false}
      hotReloadEnabled={false}
    />
  )
}

function ChatFirstPublicShell<TSession extends WorkspaceAgentSession = WorkspaceAgentSession>({
  appTitle,
  intendedWorkspaceId,
  workspaceProps,
}: {
  appTitle: string
  intendedWorkspaceId?: string
  workspaceProps: Omit<WorkspaceAgentFrontProps<TSession>, 'workspaceId' | 'frontPluginHotReload' | 'hotReloadEnabled'>
}) {
  const location = useLocation()
  const [modalOpen, setModalOpen] = useState(false)
  const returnTo = safeReturnTo(location.pathname, location.search, location.hash)
  const workspaceId = intendedWorkspaceId || 'public'
  const openAuth = (draft = readComposerDraftFromDom()) => {
    writePendingChatEntry({ draft, returnTo, ...(intendedWorkspaceId ? { intendedWorkspaceId } : {}) })
    setModalOpen(true)
  }
  return (
    <div className="relative h-screen min-h-0">
      <ChatFirstAuthenticatedShell
        appTitle={appTitle}
        workspaceId={workspaceId}
        showComposerBlocker={false}
        workspaceProps={{
          ...workspaceProps,
          topBarRight: <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted" onClick={() => openAuth()}>Sign in</button>,
          surfaceButtonBottomOffset: 420,
          chatParams: {
            ...workspaceProps.chatParams,
            emptyPlacement: 'hero',
            composerPlaceholder: 'Describe the app, bug, or repo task you want help with…',
            emptyState: {
              eyebrow: 'Start here',
              title: 'What do you want to build?',
              description: 'Type a prompt or pick an example. Sign in on send to unlock your private workspace.',
            },
            suggestions: [
              { label: 'Build an app from scratch', hint: 'Creates files, installs deps, opens a preview', prompt: 'Build a full-stack app with auth, a dashboard, and sample data.' },
              { label: 'Understand a codebase', hint: 'Maps the repo and explains where to start', prompt: 'Explain this codebase, map the architecture, and suggest first improvements.' },
              { label: 'Fix a bug safely', hint: 'Finds the cause, edits files, runs tests', prompt: 'Trace a bug, edit the right files, update tests, and summarize the diff.' },
              { label: 'Prototype an interface', hint: 'Turns an idea into an interactive UI', prompt: 'Build an interactive prototype and open it in the workspace.' },
            ],
            onBeforeSubmit: (draft: string) => {
              openAuth(draft)
              return false as const
            },
          },
        }}
      />
      <aside className="pointer-events-none fixed bottom-6 right-6 z-20 w-[320px]">
        <div className="pointer-events-auto">
          <AuthCard returnTo={returnTo} />
        </div>
      </aside>
      {modalOpen ? <AuthModal returnTo={returnTo} onClose={() => setModalOpen(false)} /> : null}
    </div>
  )
}

function usePendingChatDraft() {
  const session = useSession()
  const [pending, setPending] = useState<PendingChatEntryState | null>(() => (
    session.data?.user ? readPendingChatEntry() : null
  ))
  useEffect(() => {
    if (!session.data?.user) {
      setPending(null)
      return
    }
    setPending(readPendingChatEntry())
  }, [session.data?.user])
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

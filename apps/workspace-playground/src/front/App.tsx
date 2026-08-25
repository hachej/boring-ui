import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createDeckPlugin } from "@hachej/boring-deck/front"
import type { DeckWidgetDefinition } from "@hachej/boring-deck/shared"
import { WorkspaceProvider, useWorkspaceAttention, type WorkspaceChatPanelProps } from "@hachej/boring-workspace"
import { WorkspaceAgentFront, WorkspaceFullPagePanel, parseFullPagePanelLocation, type WorkspaceAgentSession } from "@hachej/boring-workspace/app/front"
import { createAskUserPlugin } from "@hachej/boring-ask-user/front"
import { diagramPlugin } from "@hachej/boring-diagram/front"
import { createTasksPlugin } from "@hachej/boring-tasks/front"
import { SHOWCASE_SESSION_ID, seedShowcase } from "./showcaseMessages"
import { LoadingStatesShowcase, type LoadingStateMode } from "./LoadingStatesShowcase"
import { isConsoleSpikeRoute } from "./consoleSpikeRoute"
import { isJobThreadRoute } from "./jobThreadRoute"
import { JobThreadView } from "./JobThreadView"

function isShowcaseRoute(): boolean {
  if (typeof window === "undefined") return false
  return new URLSearchParams(window.location.search).get("showcase") === "1"
}

const showcaseSessionTitles = [
  "Navigation polish review",
  "Fix mobile drawer focus",
  "Investigate session persistence",
  "Prepare release checklist",
  "Review workspace permissions",
  "Refactor command routing",
  "Debug background task status",
  "Plan analytics dashboard",
  "Improve empty states",
  "Audit keyboard navigation",
  "Update onboarding copy",
  "Long-running migration follow-up and rollback planning",
  "Trace file synchronization",
  "Review pull request feedback",
  "Prototype data explorer",
  "Resolve flaky integration test",
  "Document runtime architecture",
  "Optimize initial workspace load",
  "Design notification preferences",
  "Test narrow viewport behavior",
  "Review dependency updates",
  "Investigate API timeout",
  "Draft customer handoff",
  "Polish dark mode contrast",
  "Verify deployment health",
  "Explore plugin permissions",
  "Triage accessibility findings",
  "Plan session search",
  "Compare model responses",
  "Archive completed experiments",
]

function showcaseSessionCount(): number {
  if (typeof window === "undefined") return 1
  const requested = Number(new URLSearchParams(window.location.search).get("sessions") ?? 1)
  return Number.isFinite(requested) ? Math.min(100, Math.max(1, Math.floor(requested))) : 1
}

function createInitialShowcaseSessions() {
  const count = showcaseSessionCount()
  const now = Date.now()
  return Array.from({ length: count }, (_, index) => ({
    id: index === 0 ? SHOWCASE_SESSION_ID : `${SHOWCASE_SESSION_ID}-${index + 1}`,
    title: showcaseSessionTitles[index % showcaseSessionTitles.length] ?? `Session ${index + 1}`,
    updatedAt: now - index * 60_000,
  }))
}

function loadingStateMode(): LoadingStateMode | null {
  if (typeof window === "undefined") return null
  const mode = new URLSearchParams(window.location.search).get("loading-state")
  return mode === "workspace" || mode === "sessions" || mode === "workbench" || mode === "error" ? mode : null
}

function isFullPageRoute(): boolean {
  if (typeof window === "undefined") return false
  return window.location.pathname === "/full-page" || window.location.pathname === "/full-page/"
}

function isMultiFilesystemPlaygroundRoute(): boolean {
  if ((import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_PLAYGROUND_MULTI_FS === "1") return true
  if (typeof window === "undefined") return false
  return new URLSearchParams(window.location.search).get("multiFilesystem") === "1"
}

interface WorkspaceMeta {
  projectName?: string
  workspaceId?: string
  defaultAgentTypeId?: string
}

interface ConsoleSpikeSession extends WorkspaceAgentSession {
  projectId: string
}

const consoleSpikeAgents = [
  { agentTypeId: "builder", label: "Boring Builder", description: "Implementation Agent" },
  { agentTypeId: "reviewer", label: "Boring Reviewer", description: "Review Agent" },
  { agentTypeId: "researcher", label: "Boring Researcher", description: "Research Agent" },
]

/**
 * JOB THREAD SPIKE (`?jobThread=1`).
 *
 * The Job Thread reuses the console pane wholesale — the point of the spike is
 * to see the merged timeline sitting in the SAME shell, not a second shell. So
 * the route is the console route plus: two K7 seat Agents on the roster, one
 * extra Recent row for the job, and the mocked thread as the centre panel.
 */
const JOB_THREAD_SESSION_ID = "job-grow-my-audience"
const JOB_THREAD_WORKER = "creator-growth-worker"
const JOB_THREAD_REVIEWER = "creator-growth-reviewer"

const jobThreadAgents = [
  ...consoleSpikeAgents,
  { agentTypeId: JOB_THREAD_WORKER, label: "Growth Worker", description: "Creator-growth Agent" },
  { agentTypeId: JOB_THREAD_REVIEWER, label: "Growth Reviewer", description: "Creator-growth Reviewer" },
]

/**
 * HONEST LIMIT: the row shows ONE chip, not two.
 *
 * `ConsoleSpikeRowSlots.leadingBadge` is filled by the pane itself from
 * `session.agentTypeId` (AppLeftPaneConsoleSpike `viewRowSlots`); the host
 * cannot pass slots in, and `AppLeftPaneSession` has no participant list. A
 * two-chip job row therefore needs the row model to gain a `kind`/participants
 * discriminator — exactly the change §4 of the plan says is NOT yet built.
 * Faking it here would have meant editing the shipped pane for a mock, so the
 * row wears the worker's chip and the second seat is visible in the thread
 * header instead.
 */
const jobThreadRow = {
  id: JOB_THREAD_SESSION_ID,
  agentTypeId: JOB_THREAD_WORKER,
  projectId: "launch",
  title: "Grow my audience",
  updatedAt: Date.now() - 18 * 60_000,
  nativeSessionId: JOB_THREAD_SESSION_ID,
  hasAssistantReply: true,
}

/**
 * Every fixture is a DURABLE, replied-to chat: `nativeSessionId === id` plus
 * `hasAssistantReply` is the exact rule the pane gates Rename on, and a fixture
 * set that misses it makes Rename look unimplemented rather than ineligible.
 */
const initialConsoleSpikeSessions: ConsoleSpikeSession[] = [
  { id: "launch-plan", agentTypeId: "builder", projectId: "launch", title: "Plan launch checklist", updatedAt: Date.now() - 4 * 60_000 },
  { id: "launch-review", agentTypeId: "reviewer", projectId: "launch", title: "Review release risks", updatedAt: Date.now() - 18 * 60_000 },
  { id: "console-nav", agentTypeId: "builder", projectId: "console", title: "Implement console navigation", updatedAt: Date.now() - 35 * 60_000 },
  { id: "console-research", agentTypeId: "researcher", projectId: "console", title: "Compare session groupings", updatedAt: Date.now() - 62 * 60_000 },
  { id: "console-copy", agentTypeId: "reviewer", projectId: "console", title: "Check Project semantics", updatedAt: Date.now() - 95 * 60_000 },
].map((session) => ({ ...session, nativeSessionId: session.id, hasAssistantReply: true }))

/**
 * FIXTURE-DERIVED demo attention. The spike route has no Agent runtime, so
 * nothing would ever block on a human, and the whole attention language — row
 * badges, collapsed-header rollups, the Inbox count — would be invisible.
 * These two stand in for the real ask-user plugin's output: they are seeded
 * once and are not driven by anything the operator does.
 */
const consoleSpikeDemoBlockers = [
  {
    id: "console-spike-demo:launch-review",
    reason: "ask-user.question",
    sessionId: "launch-review",
    agentTypeId: "reviewer",
    // `inbox` is what makes a blocker an INBOX item, and the Inbox is the
    // single triage surface — a demo blocker without it marks the row but
    // never reaches the Inbox or its rail count.
    inbox: { kind: "question", sourceLabel: "Boring Reviewer" },
    sessionBadge: { kind: "question", label: "question", tone: "attention", priority: 10 },
  },
  {
    id: "console-spike-demo:console-research",
    reason: "ask-user.approval",
    sessionId: "console-research",
    agentTypeId: "researcher",
    inbox: { kind: "approval", sourceLabel: "Boring Researcher" },
    sessionBadge: { kind: "approval", label: "approve", tone: "warning", priority: 20 },
  },
] as const

function ConsoleSpikeAttentionSeed() {
  const { addBlocker } = useWorkspaceAttention()
  useEffect(() => {
    for (const blocker of consoleSpikeDemoBlockers) addBlocker({ ...blocker })
  }, [addBlocker])
  return null
}

/**
 * FIXTURE attention for the job row, mirroring the inline gate in the thread:
 * the same "Needs you" must be true in the pane and the Inbox, or the mock
 * would show a gate that nothing outside the thread knows about.
 */
function JobThreadAttentionSeed() {
  const { addBlocker } = useWorkspaceAttention()
  useEffect(() => {
    addBlocker({
      id: "job-thread-spike:approve-outreach",
      reason: "ask-user.approval",
      sessionId: JOB_THREAD_SESSION_ID,
      agentTypeId: JOB_THREAD_WORKER,
      inbox: { kind: "approval", sourceLabel: "Growth Worker" },
      sessionBadge: { kind: "approval", label: "approve", tone: "warning", priority: 20 },
    })
  }, [addBlocker])
  return null
}

function ConsoleSpikeChatPanel({ sessionId, agentTypeId, sessions }: WorkspaceChatPanelProps & { sessions: readonly ConsoleSpikeSession[] }) {
  const session = sessions.find((item) => item.id === sessionId && item.agentTypeId === agentTypeId)
  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-background p-6" data-boring-workspace-part="console-spike-chat-panel">
      {/* The panel is the spike's only component INSIDE the attention provider,
          so it is where the demo blockers are seeded from. */}
      <ConsoleSpikeAttentionSeed />
      <div className="max-w-md text-center">
        <div className="text-sm font-medium text-foreground">{session?.title ?? "New chat"}</div>
        <p className="mt-1 text-sm text-muted-foreground">
          Project organizes chats only. Workspace and Agent remain the active context.
        </p>
      </div>
    </div>
  )
}

const playgroundDeckWidgets: DeckWidgetDefinition[] = [
  {
    name: "PlaygroundBadge",
    display: "inline",
    render: ({ attrs }) => (
      <span className="inline-flex rounded-full border border-border/60 bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
        {attrs.text ?? "badge"}
      </span>
    ),
  },
]

const playgroundDeckPlugin = createDeckPlugin({
  widgets: playgroundDeckWidgets,
  theme: {
    className: "workspace-playground-deck",
    slideClassName: "workspace-playground-deck-slide",
  },
})

const askUserPlugin = createAskUserPlugin({ appLeftInbox: true })
const tasksPlugin = createTasksPlugin()
const workspacePlugins = [askUserPlugin, tasksPlugin, playgroundDeckPlugin, diagramPlugin]
const externalPluginsEnabled = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_BORING_EXTERNAL_PLUGINS === "1"

function resetPlaygroundStorageIfRequested(): void {
  if (typeof window === "undefined") return
  const params = new URLSearchParams(window.location.search)
  if (params.get("fresh") !== "1") return
  const prefixes = [
    "boring-ui-v2:layout:playground",
    "boring-workspace:",
    "boring-agent:",
  ]
  for (const key of Object.keys(window.localStorage)) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) {
      window.localStorage.removeItem(key)
    }
  }
  params.delete("fresh")
  const nextSearch = params.toString()
  window.history.replaceState(null, "", `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`)
}

function WorkspaceFullPageShell({ agentTypeId }: { agentTypeId: string }) {
  const parsed = parseFullPagePanelLocation(window.location.search)

  if (!parsed.componentId || parsed.error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-lg rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-foreground">
          <div className="font-medium">Invalid full-page panel route</div>
          <div className="mt-1 text-muted-foreground">
            {parsed.error?.message ?? "Missing full-page panel component."}
          </div>
        </div>
      </div>
    )
  }

  return (
    <WorkspaceProvider
      agentTypeId={agentTypeId}
      apiBaseUrl=""
      plugins={workspacePlugins}
      persistenceEnabled
      manageDocumentTitle={false}
      workspaceId="playground-full-page"
      fullPageBasePath="/full-page"
    >
      <WorkspaceFullPagePanel componentId={parsed.componentId} params={parsed.params} />
    </WorkspaceProvider>
  )
}

export function WorkspaceShell() {
  resetPlaygroundStorageIfRequested()
  const showcase = useMemo(isShowcaseRoute, [])
  const jobThread = useMemo(isJobThreadRoute, [])
  // The Job Thread spike renders inside the console shell, so every
  // `consoleSpike` branch below must also fire for it.
  const consoleSpike = useMemo(() => isConsoleSpikeRoute() || isJobThreadRoute(), [])
  const loadingShowcase = useMemo(loadingStateMode, [])
  const fullPage = useMemo(isFullPageRoute, [])
  const multiFilesystem = useMemo(isMultiFilesystemPlaygroundRoute, [])
  const [defaultAgentTypeId, setDefaultAgentTypeId] = useState(consoleSpike ? "builder" : "")
  const [projectName, setProjectName] = useState(consoleSpike ? "Boring" : "Workspace")
  const [workspaceId, setWorkspaceId] = useState(consoleSpike ? "console-spike-workspace" : "Workspace")
  const [metaLoaded, setMetaLoaded] = useState(Boolean(loadingShowcase || consoleSpike))
  const [metaError, setMetaError] = useState<string | null>(null)
  const [showcaseActiveSessionId, setShowcaseActiveSessionId] = useState(SHOWCASE_SESSION_ID)
  const [showcaseSessions, setShowcaseSessions] = useState(createInitialShowcaseSessions)
  const [consoleSpikeAgentTypeId, setConsoleSpikeAgentTypeId] = useState(jobThread ? JOB_THREAD_WORKER : "builder")
  const [consoleSpikeActiveSession, setConsoleSpikeActiveSession] = useState<{ id: string; agentTypeId: string }>(
    jobThread
      ? { id: JOB_THREAD_SESSION_ID, agentTypeId: JOB_THREAD_WORKER }
      : { id: "launch-plan", agentTypeId: "builder" },
  )
  const [consoleSpikeSessions, setConsoleSpikeSessions] = useState<ConsoleSpikeSession[]>(
    jobThread ? [jobThreadRow, ...initialConsoleSpikeSessions] : initialConsoleSpikeSessions,
  )
  const [consoleSpikeProjectNames, setConsoleSpikeProjectNames] = useState<Record<string, string>>({ launch: "Launch", console: "Agent Console" })
  const sessions = showcase ? showcaseSessions : undefined
  const liveShowcaseSessionIds = useRef(new Set<string>())
  const createShowcaseSession = useCallback(async () => {
    const response = await fetch(`/api/v1/agents/${encodeURIComponent(defaultAgentTypeId)}/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-boring-workspace-id": "default",
      },
      body: JSON.stringify({ title: "New chat" }),
    })
    if (!response.ok) throw new Error(`showcase session create failed (${response.status})`)
    const payload = await response.json() as { agentTypeId?: string; sessionId?: string }
    if (!payload.sessionId) throw new Error("showcase session create returned no session id")
    const session = {
      id: payload.sessionId,
      agentTypeId: payload.agentTypeId ?? defaultAgentTypeId,
      title: "New chat",
      updatedAt: Date.now(),
    }
    liveShowcaseSessionIds.current.add(session.id)
    setShowcaseSessions((current) => [...current, session])
    setShowcaseActiveSessionId(session.id)
    return session
  }, [defaultAgentTypeId])
  const renameShowcaseSession = useCallback((sessionId: string, title: string) => {
    setShowcaseSessions((current) => current.map((session) => (
      session.id === sessionId ? { ...session, title, updatedAt: Date.now() } : session
    )))
  }, [])
  const handleActiveSessionIdChange = useCallback(
    (sessionId: string | null) => {
      if (showcase && sessionId) {
        if (!liveShowcaseSessionIds.current.has(sessionId)) seedShowcase(sessionId)
        setShowcaseActiveSessionId(sessionId)
      }
    },
    [showcase],
  )

  const consoleSpikeProjects = useMemo(() => [
    { id: "launch", name: consoleSpikeProjectNames.launch ?? "Launch", sessions: consoleSpikeSessions.filter((session) => session.projectId === "launch") },
    { id: "console", name: consoleSpikeProjectNames.console ?? "Agent Console", sessions: consoleSpikeSessions.filter((session) => session.projectId === "console") },
  ], [consoleSpikeProjectNames, consoleSpikeSessions])
  const renameConsoleSpikeProject = useCallback((projectId: string, name: string) => {
    setConsoleSpikeProjectNames((current) => ({ ...current, [projectId]: name }))
  }, [])
  const useConsoleSpikeAgentSelection = useCallback(() => ({
    agents: jobThread ? jobThreadAgents : consoleSpikeAgents,
    selectedAgentTypeId: consoleSpikeAgentTypeId,
    loading: false,
    error: undefined,
    selectAgentTypeId: setConsoleSpikeAgentTypeId,
  }), [consoleSpikeAgentTypeId, jobThread])
  const createConsoleSpikeSession = useCallback((
    // The pane hands down the Agent it asked for; falling back to the current
    // one only when it asked for nothing. Ignoring it made the host's own
    // owner-consistency guard delete every per-Agent chat right after creating
    // it, which read as "the Agent submenu does nothing".
    agentTypeId = consoleSpikeAgentTypeId,
  ) => {
    const id = `console-spike-${Date.now()}`
    const created: ConsoleSpikeSession = {
      id,
      agentTypeId,
      projectId: "console",
      title: "New chat",
      updatedAt: Date.now(),
      nativeSessionId: id,
      // A freshly created chat has no reply yet, so it is correctly NOT
      // renamable until one arrives — the same rule the real host applies.
      hasAssistantReply: false,
    }
    setConsoleSpikeSessions((current) => [created, ...current])
    setConsoleSpikeAgentTypeId(agentTypeId)
    setConsoleSpikeActiveSession({ id: created.id, agentTypeId })
    return created
  }, [consoleSpikeAgentTypeId])
  const deleteConsoleSpikeSession = useCallback((id: string, agentTypeId?: string) => {
    setConsoleSpikeSessions((current) => current.filter((session) => (
      session.id !== id || (agentTypeId !== undefined && session.agentTypeId !== agentTypeId)
    )))
  }, [])
  const renameConsoleSpikeSession = useCallback((id: string, title: string, agentTypeId?: string) => {
    setConsoleSpikeSessions((current) => current.map((session) => (
      session.id === id && (agentTypeId === undefined || session.agentTypeId === agentTypeId)
        ? { ...session, title }
        : session
    )))
  }, [])
  const consoleSpikeChatPanel = useCallback(
    (props: WorkspaceChatPanelProps) => {
      // Only the job row opens the Job Thread; the other rows keep the plain
      // console stand-in, so the contrast between "a chat" and "a job" is what
      // the owner actually sees when clicking around.
      if (jobThread && props.sessionId === JOB_THREAD_SESSION_ID) {
        return (
          <>
            <JobThreadAttentionSeed />
            <JobThreadView />
          </>
        )
      }
      return <ConsoleSpikeChatPanel {...props} sessions={consoleSpikeSessions} />
    },
    [consoleSpikeSessions, jobThread],
  )

  useEffect(() => {
    if (loadingShowcase || consoleSpike) return
    let cancelled = false
    void fetch("/api/v1/workspace/meta")
      .then(async (res) => {
        if (!res.ok) throw new Error(`workspace metadata request failed (${res.status})`)
        return await res.json() as WorkspaceMeta
      })
      .then((meta) => {
        if (cancelled) return
        const next = meta?.projectName?.trim()
        const nextWorkspaceId = meta?.workspaceId?.trim() || next
        const nextDefaultAgentTypeId = meta?.defaultAgentTypeId?.trim()
        if (!nextDefaultAgentTypeId) throw new Error("workspace metadata did not include a default agent")
        if (next && !showcase) {
          setProjectName(next)
        }
        if (nextWorkspaceId && !showcase) {
          setWorkspaceId(nextWorkspaceId)
        }
        if (nextDefaultAgentTypeId) setDefaultAgentTypeId(nextDefaultAgentTypeId)
        setMetaLoaded(true)
      })
      .catch(() => {
        if (!cancelled) setMetaError("The playground could not load its agent roster. Reload to try again.")
      })
    return () => { cancelled = true }
  }, [showcase, loadingShowcase, consoleSpike])

  if (showcase) seedShowcase(SHOWCASE_SESSION_ID)

  if (loadingShowcase) {
    return <LoadingStatesShowcase mode={loadingShowcase} />
  }

  if (!metaLoaded || !defaultAgentTypeId) {
    if (metaError) {
      return (
        <div className="flex h-screen w-screen items-center justify-center bg-background p-6">
          <p role="alert" className="max-w-md text-center text-sm text-destructive">{metaError}</p>
        </div>
      )
    }
    return <div className="h-screen w-screen bg-background" />
  }

  if (fullPage) {
    return <WorkspaceFullPageShell agentTypeId={defaultAgentTypeId} />
  }

  if (consoleSpike) {
    return (
      <WorkspaceAgentFront<ConsoleSpikeSession>
        workspaceId="console-spike-workspace"
        agentTypeId="builder"
        addressedAgentSelection
        useAddressedAgentSelection={useConsoleSpikeAgentSelection}
        apiBaseUrl=""
        // Pins, the chosen view and the pane layout are settings the operator
        // SET; a demo that forgets them on every reload reads as a demo where
        // the controls do nothing. The host already owns this state behind
        // guarded localStorage reads/writes, so switching it on is the whole
        // fix — a second pinned-set in this file would be two stores fighting
        // over one piece of state. Namespaced below, and ?fresh=1 clears it.
        persistenceEnabled
        providerStorageKey="boring-ui-v2:layout:console-spike"
        appTitle="Boring"
        workspaceLabel="Workspace playground"
        workspaceLayout="plugin-tabs"
        appLeftLayoutMode="multi-project"
        appLeftHeaderMode="full"
        workspaceSectionTitle="Projects"
        appLeftProjects={consoleSpikeProjects}
        appLeftActiveProjectId="console-spike-workspace"
        // The playground owns its own route, so the playground is what turns
        // the variant on.
        appLeftConsoleSpike
        appLeftConsoleSpikeRenameProject={renameConsoleSpikeProject}
        defaultSessionTitle="New chat"
        provisionWorkspace={false}
        bootPreloadPaths={[]}
        sessions={consoleSpikeSessions}
        activeSessionId={consoleSpikeActiveSession.id}
        activeSessionAgentTypeId={consoleSpikeActiveSession.agentTypeId}
        onSwitchSession={(id, agentTypeId) => {
          const owner = agentTypeId ?? consoleSpikeSessions.find((session) => session.id === id)?.agentTypeId ?? consoleSpikeAgentTypeId
          setConsoleSpikeAgentTypeId(owner)
          setConsoleSpikeActiveSession({ id, agentTypeId: owner })
        }}
        onCreateSession={createConsoleSpikeSession}
        onDeleteSession={deleteConsoleSpikeSession}
        onRenameSession={renameConsoleSpikeSession}
        chatPanel={consoleSpikeChatPanel}
        externalPlugins={false}
        hotReloadEnabled={false}
        plugins={workspacePlugins}
      />
    )
  }

  return (
    <WorkspaceAgentFront
      workspaceId={showcase ? "default" : workspaceId}
      agentTypeId={defaultAgentTypeId}
      addressedAgentSelection={!showcase && !multiFilesystem}
      apiBaseUrl=""
      persistenceEnabled
      providerStorageKey={showcase ? "boring-ui-v2:layout:playground" : `boring-ui-v2:layout:playground:${multiFilesystem ? "multi-fs:" : ""}${workspaceId}`}
      appTitle={showcase ? "Boring" : projectName}
      workspaceLabel={showcase ? undefined : projectName}
      workspaceLayout={multiFilesystem ? "classic" : "plugin-tabs"}
      defaultSessionTitle="New chat"
      externalPlugins={externalPluginsEnabled}
      frontPluginHotReload={externalPluginsEnabled ? "vite" : undefined}
      fullPageBasePath="/full-page"
      provisionWorkspace={!showcase}
      sessions={sessions}
      activeSessionId={showcase ? showcaseActiveSessionId : undefined}
      onActiveSessionIdChange={handleActiveSessionIdChange}
      onSwitchSession={showcase ? handleActiveSessionIdChange : undefined}
      onCreateSession={showcase ? createShowcaseSession : undefined}
      onRenameSession={showcase ? renameShowcaseSession : undefined}
      plugins={workspacePlugins}
      chatParams={{ thinkingControl: true }}
    />
  )
}

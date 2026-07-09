import { useMemo, useState, type ReactNode } from "react"
import { ChatPanel, type ChatPanelProps } from "@hachej/boring-agent/front"
import { ChatLayout, WorkspaceProvider, type PanelConfig, type PaneProps } from "@hachej/boring-workspace"

type MobileSpikeState = "pages" | "one" | "two" | "drawer" | "workbench" | "dense"

type MobileSpikePage = "chat" | "workspace"

const SPIKE_STATES: Array<{ id: MobileSpikeState; label: string; description: string }> = [
  { id: "pages", label: "Chat ↔ Workspace", description: "Hypothesis test: phone UX as two pages, no split panes, mobile panel switcher." },
  { id: "one", label: "One chat", description: "Single real ChatLayout chat pane with the agent composer mounted." },
  { id: "two", label: "Two chats", description: "Two ChatLayout chat panes in the real pane stage." },
  { id: "drawer", label: "Drawer open", description: "Session drawer over the mobile shell." },
  { id: "workbench", label: "Workbench open", description: "Workbench surface takes over the mobile viewport." },
  { id: "dense", label: "Dense panel", description: "Workbench surface with a dense, scroll-heavy placeholder." },
]

const DEFAULT_SPIKE_STATE: MobileSpikeState = "pages"

export function isMobileSpikeRoute(): boolean {
  if (typeof window === "undefined") return false
  return window.location.pathname === "/mobile-spike" || window.location.pathname === "/mobile-spike/"
}

function initialSpikeState(): MobileSpikeState {
  if (typeof window === "undefined") return DEFAULT_SPIKE_STATE
  const candidate = new URLSearchParams(window.location.search).get("state")
  return isSpikeState(candidate) ? candidate : DEFAULT_SPIKE_STATE
}

function isSpikeState(value: string | null): value is MobileSpikeState {
  return value === "pages" || value === "one" || value === "two" || value === "drawer" || value === "workbench" || value === "dense"
}

export function MobileSpikeShell() {
  const [state, setState] = useState<MobileSpikeState>(initialSpikeState)
  const panels = useMemo<PanelConfig[]>(() => [
    { id: "mobile-spike-chat", title: "Mobile spike chat", lazy: false, component: MobileSpikeChatPanel },
    { id: "mobile-spike-sessions", title: "Mobile spike sessions", lazy: false, component: MobileSpikeSessionDrawer },
    { id: "mobile-spike-workbench", title: "Mobile spike workbench", lazy: false, component: MobileSpikeWorkbenchPanel },
    { id: "mobile-spike-dense", title: "Mobile spike dense panel", lazy: false, component: MobileSpikeDensePanel },
  ], [])
  const selected = SPIKE_STATES.find((item) => item.id === state) ?? SPIKE_STATES[0]

  function selectState(next: MobileSpikeState) {
    setState(next)
    if (typeof window === "undefined") return
    const url = new URL(window.location.href)
    url.searchParams.set("state", next)
    window.history.replaceState(null, "", `${url.pathname}${url.search}`)
  }

  return (
    <WorkspaceProvider
      panels={panels}
      persistenceEnabled={false}
      manageDocumentTitle={false}
      workspaceId="mobile-spike"
      workspaceLabel="Mobile spike"
      appTitle="Mobile spike"
      defaultTheme="light"
      frontPluginHotReload={false}
      bridgeEndpoint={null}
    >
      <div className="mobile-spike-page">
        <header className="mobile-spike-header">
          <div>
            <p className="mobile-spike-kicker">Issue #580 front-only mobile shell spike</p>
            <h1>ChatLayout + real agent composer mobile fixtures</h1>
            <p>{selected.description}</p>
          </div>
          <a href="/" className="mobile-spike-back">Back to playground</a>
        </header>

        <div className="mobile-spike-statebar" aria-label="Mobile spike fixture states">
          {SPIKE_STATES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === state ? "is-active" : undefined}
              onClick={() => selectState(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <main className="mobile-spike-workspace">
          <section className="mobile-spike-phone" data-state={state} aria-label={`${selected.label} phone fixture`}>
            <div className="mobile-spike-phone-status" aria-hidden="true">
              <span>9:41</span>
              <span>{state === "pages" ? "two-page hypothesis" : "mobileShellEnabled"}</span>
            </div>
            {state === "pages" ? (
              <MobileTwoPageHypothesis />
            ) : (
              <ChatLayout
                className="mobile-spike-layout"
                mobileShellEnabled
                storageKey={`mobile-spike:${state}`}
                nav={state === "drawer" ? "mobile-spike-sessions" : null}
                navParams={{ onClose: () => selectState("one"), onCreate: () => selectState("one") }}
                center="mobile-spike-chat"
                centerParams={{ sessionId: "mobile-one", fixtureTitle: "Mobile design review" }}
                chatPanes={state === "two" ? [
                  { id: "mobile-one", title: "Design review", panel: "mobile-spike-chat", params: { sessionId: "mobile-one", fixtureTitle: "Design review" } },
                  { id: "mobile-two", title: "Implementation notes", panel: "mobile-spike-chat", params: { sessionId: "mobile-two", fixtureTitle: "Implementation notes" } },
                ] : undefined}
                activeChatPaneId={state === "two" ? "mobile-one" : undefined}
                surface={state === "workbench" ? "mobile-spike-workbench" : state === "dense" ? "mobile-spike-dense" : undefined}
                surfaceParams={{ onClose: () => selectState("one") }}
                onOpenNav={() => selectState("drawer")}
                onOpenSurface={() => selectState("workbench")}
                onActiveChatPaneChange={() => {}}
                onCloseChatPane={() => {}}
                onCreateChatPaneAfter={() => {}}
              />
            )}
          </section>

          <aside className="mobile-spike-notes" aria-label="Proof notes">
            <h2>Proof checklist</h2>
            <ul>
              <li>Real <code>ChatLayout</code> is mounted with <code>mobileShellEnabled</code>.</li>
              <li>Real <code>ChatPanel</code> composer is mounted in every chat fixture.</li>
              <li>Use state buttons or <code>?state=pages|one|two|drawer|workbench|dense</code>.</li>
              <li>No server/API/persistence changes; fixture sessions are in-memory only.</li>
            </ul>
          </aside>
        </main>
      </div>
    </WorkspaceProvider>
  )
}

function MobileTwoPageHypothesis() {
  const [page, setPage] = useState<MobileSpikePage>("chat")
  const [workspacePanel, setWorkspacePanel] = useState<"file" | "preview" | "tasks">("file")
  const createRemoteSession = useMemo(
    () => ((options: { sessionId: string }) => makeFixtureRemoteSession(options.sessionId || "mobile-pages")) as unknown as NonNullable<ChatPanelProps["createRemoteSession"]>,
    [],
  )

  return (
    <div className="mobile-two-page-shell" data-page={page}>
      <div className="mobile-two-page-nav" role="tablist" aria-label="Mobile page switcher">
        <button type="button" className={page === "chat" ? "is-active" : undefined} onClick={() => setPage("chat")}>Chat</button>
        <button type="button" className={page === "workspace" ? "is-active" : undefined} onClick={() => setPage("workspace")}>Workspace</button>
      </div>

      {page === "chat" ? (
        <div className="mobile-two-page-view mobile-two-page-chat">
          <div className="mobile-two-page-toolbar">
            <div>
              <strong>Chat</strong>
              <span>No split panes. One active thread.</span>
            </div>
            <button type="button" onClick={() => setPage("workspace")}>Open file →</button>
          </div>
          <ChatPanel
            sessionId="mobile-pages"
            hydrateMessages={false}
            serverResourcesEnabled={false}
            showSessions={false}
            chrome={false}
            storageScope="mobile-spike:pages"
            createRemoteSession={createRemoteSession}
            composerPlaceholder="Ask, then open artifacts in Workspace…"
            initialDraft="Open the current file and keep chat readable."
            suggestions={[]}
            emptyState={{
              eyebrow: "Two-page hypothesis",
              title: "Chat is the phone home page",
              description: "The composer owns this page. Files and dense UI navigate to Workspace instead of squeezing beside chat.",
            }}
          />
        </div>
      ) : (
        <div className="mobile-two-page-view mobile-two-page-workspace">
          <div className="mobile-two-page-toolbar">
            <button type="button" onClick={() => setPage("chat")}>← Chat</button>
            <div>
              <strong>Workspace</strong>
              <span>One active panel, mobile tabs.</span>
            </div>
          </div>
          <div className="mobile-two-page-tabs" role="tablist" aria-label="Workspace panels">
            {(["file", "preview", "tasks"] as const).map((item) => (
              <button key={item} type="button" className={workspacePanel === item ? "is-active" : undefined} onClick={() => setWorkspacePanel(item)}>
                {item === "file" ? "File" : item === "preview" ? "Preview" : "Tasks"}
              </button>
            ))}
          </div>
          {workspacePanel === "file" ? <MobileFilePanel /> : workspacePanel === "preview" ? <MobilePreviewPanel /> : <MobileTasksPanel />}
        </div>
      )}
    </div>
  )
}

function MobileFilePanel() {
  return (
    <div className="mobile-two-page-panel">
      <p>Editing surface</p>
      <h2>src/front/App.tsx</h2>
      <pre>{`function MobileShell() {\n  return <ChatOrWorkspace />\n}\n\n// No side-by-side splits on phone.\n// Tabs become a compact page selector.`}</pre>
    </div>
  )
}

function MobilePreviewPanel() {
  return (
    <div className="mobile-two-page-panel">
      <p>Artifact preview</p>
      <h2>Responsive report</h2>
      <div className="mobile-spike-artifact-preview">
        <div />
        <div />
        <div />
        <div />
      </div>
    </div>
  )
}

function MobileTasksPanel() {
  return (
    <div className="mobile-two-page-panel">
      <p>Dense panel as list</p>
      <h2>Review queue</h2>
      <div className="mobile-spike-dense-list">
        {Array.from({ length: 14 }, (_, index) => (
          <div key={index} className="mobile-spike-dense-row">
            <span>MOB-{String(index + 1).padStart(3, "0")}</span>
            <strong>{index % 2 ? "Review" : "Ready"}</strong>
            <em>{index % 2 ? "Agent" : "Owner"}</em>
          </div>
        ))}
      </div>
    </div>
  )
}

function MobileSpikeChatPanel({ params }: PaneProps<Record<string, unknown> | undefined>) {
  const sessionId = typeof params?.sessionId === "string" ? params.sessionId : "mobile-one"
  const fixtureTitle = typeof params?.fixtureTitle === "string" ? params.fixtureTitle : "Mobile chat"
  const createRemoteSession = useMemo(
    () => ((options: { sessionId: string }) => makeFixtureRemoteSession(options.sessionId || sessionId)) as unknown as NonNullable<ChatPanelProps["createRemoteSession"]>,
    [sessionId],
  )

  return (
    <div className="mobile-spike-chat-panel">
      <div className="mobile-spike-pane-label">{fixtureTitle}</div>
      <ChatPanel
        sessionId={sessionId}
        hydrateMessages={false}
        serverResourcesEnabled={false}
        showSessions={false}
        chrome={false}
        storageScope={`mobile-spike:${sessionId}`}
        createRemoteSession={createRemoteSession}
        composerPlaceholder="Message the agent from a phone…"
        initialDraft="Can you review this mobile shell?"
        suggestions={[]}
        emptyState={{
          eyebrow: "Mobile spike",
          title: "Real agent composer",
          description: "This fixture uses the production ChatPanel composer with an in-memory session.",
        }}
      />
    </div>
  )
}

function MobileSpikeSessionDrawer() {
  return (
    <div className="mobile-spike-drawer-panel">
      <div className="mobile-spike-panel-heading">
        <span>Sessions</span>
        <button type="button">New</button>
      </div>
      <FixtureSession title="Design review" active meta="3 min ago" />
      <FixtureSession title="Implementation notes" meta="Today" />
      <FixtureSession title="Workbench takeover" meta="Yesterday" />
      <FixtureSession title="Dense panel QA" meta="Mon" />
    </div>
  )
}

function FixtureSession({ title, meta, active }: { title: string; meta: string; active?: boolean }) {
  return (
    <div className={active ? "mobile-spike-session is-active" : "mobile-spike-session"}>
      <strong>{title}</strong>
      <span>{meta}</span>
    </div>
  )
}

function MobileSpikeWorkbenchPanel() {
  return (
    <FixturePanelShell title="Workbench" eyebrow="Surface takeover">
      <div className="mobile-spike-card-grid">
        <FixtureCard title="Files" value="12 changed" />
        <FixtureCard title="Preview" value="Ready" />
        <FixtureCard title="Tests" value="3 queued" />
      </div>
      <div className="mobile-spike-artifact-preview">
        <div />
        <div />
        <div />
        <div />
      </div>
    </FixturePanelShell>
  )
}

function MobileSpikeDensePanel() {
  const rows = Array.from({ length: 28 }, (_, index) => ({
    id: `MOB-${String(index + 1).padStart(3, "0")}`,
    state: index % 3 === 0 ? "Blocked" : index % 3 === 1 ? "Review" : "Ready",
    owner: ["Agent", "User", "Plugin"][index % 3],
  }))

  return (
    <FixturePanelShell title="Dense placeholder" eyebrow="Scroll + tap target stress">
      <div className="mobile-spike-dense-toolbar">
        <button type="button">Filter</button>
        <button type="button">Sort</button>
        <button type="button">Export</button>
      </div>
      <div className="mobile-spike-dense-list">
        {rows.map((row) => (
          <div key={row.id} className="mobile-spike-dense-row">
            <span>{row.id}</span>
            <strong>{row.state}</strong>
            <em>{row.owner}</em>
          </div>
        ))}
      </div>
    </FixturePanelShell>
  )
}

function FixturePanelShell({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <div className="mobile-spike-fixture-panel">
      <p>{eyebrow}</p>
      <h2>{title}</h2>
      {children}
    </div>
  )
}

function FixtureCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="mobile-spike-card">
      <span>{title}</span>
      <strong>{value}</strong>
    </div>
  )
}

function makeFixtureRemoteSession(sessionId: string) {
  const listeners = new Set<() => void>()
  const state = {
    sessionId,
    workspaceId: "mobile-spike",
    storageScope: `mobile-spike:${sessionId}`,
    status: "idle",
    lastSeq: 4,
    committedMessages: [
      {
        id: `${sessionId}:user:1`,
        role: "user",
        status: "done",
        createdAt: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
        parts: [{ type: "text", id: `${sessionId}:user:1:text`, text: "Prototype a mobile shell for ChatLayout." }],
      },
      {
        id: `${sessionId}:assistant:1`,
        role: "assistant",
        status: "done",
        createdAt: new Date(Date.now() - 1000 * 60 * 7).toISOString(),
        parts: [{
          type: "text",
          id: `${sessionId}:assistant:1:text`,
          text: "Here is a front-only fixture: drawer overlays the chat, workbench takes over the viewport, and the composer remains reachable at phone width.",
        }],
      },
    ],
    history: { mode: "full", messageCount: 2 },
    queue: { followUps: [] },
    optimisticOutbox: {},
    pendingToolCallIds: new Set<string>(),
    connection: { state: "connected", lastHeartbeatAt: Date.now() },
    notices: [],
    hydrated: true,
  }

  return {
    getState: () => state,
    getDebugState: () => ({
      sessionId,
      lastSeq: state.lastSeq,
      status: state.status,
      connection: state.connection.state,
      lastHeartbeatAt: state.connection.lastHeartbeatAt,
      queue: { followUps: 0, optimisticOutbox: 0, pendingToolCalls: 0 },
      recentEventTypes: [],
      gapCount: 0,
      history: { mode: "full", messageCount: state.committedMessages.length, streamingMessageCount: 0 },
      disposed: false,
      generation: 0,
      streamRunId: 0,
      reconnectAttempt: 0,
      hasReconnectTimer: false,
      inflightFetches: 0,
    }),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    dispose: () => { listeners.clear() },
    prompt: async () => ({ accepted: true, cursor: state.lastSeq, clientNonce: `fixture-${Date.now()}` }),
    followUp: async () => ({ accepted: true, cursor: state.lastSeq, clientNonce: `fixture-${Date.now()}`, clientSeq: state.lastSeq + 1, queued: true }),
    clearQueue: async () => ({ accepted: true, cursor: state.lastSeq, cleared: 0 }),
    interrupt: async () => ({ accepted: true, cursor: state.lastSeq }),
    stop: async () => ({ accepted: true, cursor: state.lastSeq, stopped: false, clearedQueue: [] }),
  }
}

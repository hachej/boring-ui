import { useEffect, type ReactNode } from "react"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WorkspaceAttentionProvider, useWorkspaceAttention } from "../../../attention/WorkspaceAttentionProvider"
import { workspaceSessionKey } from "../../../sessionIdentity"
import { AppLeftPane, AppLeftRail, createAppLeftNavigationEntries, type AppLeftPaneAction } from "../AppLeftPane"
import { PluginTabsWorkspaceShell } from "../PluginTabsWorkspaceShell"

const sessions = [
  { id: "s1", title: "First session" },
  { id: "s2", title: "Second session" },
]

function testNavigationEntries(
  actions: readonly AppLeftPaneAction[] = [],
  callbacks: { onOpenChats?: () => void; onOpenCommandPalette?: () => void } = {},
) {
  return createAppLeftNavigationEntries({
    actions,
    onOpenChats: callbacks.onOpenChats ?? vi.fn(),
    onOpenCommandPalette: callbacks.onOpenCommandPalette ?? vi.fn(),
  })
}

const CONSOLE_SPIKE_VIEW_KEY = "boring-workspace:console-spike-view"
const SPIKE_CHIP = '[data-boring-workspace-part="console-spike-agent-chip"]'
const SPIKE_TAG = '[data-boring-workspace-part="console-spike-project-tag"]'
const spikeNow = Date.now()

const spikeProjects = [
  {
    id: "launch",
    name: "Launch",
    sessions: [
      { id: "alpha-one", agentTypeId: "alpha", title: "Alpha launch", updatedAt: spikeNow - 60_000 },
      { id: "beta-one", agentTypeId: "beta", title: "Beta review", updatedAt: spikeNow - 600_000 },
    ],
  },
  {
    id: "console",
    name: "Agent Console",
    sessions: [{ id: "alpha-two", agentTypeId: "alpha", title: "Console nav", updatedAt: spikeNow - 300_000 }],
  },
]
const spikeSessions = [
  { id: "alpha-one", agentTypeId: "alpha", title: "Alpha launch", updatedAt: spikeNow - 60_000 },
  { id: "beta-one", agentTypeId: "beta", title: "Beta review", updatedAt: spikeNow - 600_000 },
  { id: "alpha-two", agentTypeId: "alpha", title: "Console nav", updatedAt: spikeNow - 300_000 },
]
const spikeAgents = [
  { agentTypeId: "alpha", label: "Boring Alpha", sessionsStatus: "loaded" as const },
  { agentTypeId: "beta", label: "Boring Beta", sessionsStatus: "loaded" as const },
]

function renderSpikeConsole(overrides: Partial<Parameters<typeof AppLeftPane>[0]> = {}, extra?: ReactNode) {
  return render(
    <WorkspaceAttentionProvider>
      {extra}
      <AppLeftPane
        appTitle="Test"
        consoleSpike
        layoutMode="multi-project"
        projects={spikeProjects}
        agents={spikeAgents}
        sessions={spikeSessions}
        onCreateSession={vi.fn()}
        navigationEntries={testNavigationEntries()}
        onSwitchSession={vi.fn()}
        onOpenSessionAsPane={vi.fn()}
        onToggleSessionPinned={vi.fn()}
        {...overrides}
      />
    </WorkspaceAttentionProvider>,
  )
}

function spikeRoot(): HTMLElement {
  const root = document.querySelector('[data-boring-workspace-part="app-left-console-spike"]')
  if (!root) throw new Error("console spike pane not rendered")
  return root as HTMLElement
}

function spikeList(): HTMLElement {
  const list = spikeRoot().querySelector('[data-boring-workspace-part="console-spike-list"]')
  if (!list) throw new Error("console spike list not rendered")
  return list as HTMLElement
}

function spikeNeedsYou(): HTMLElement | null {
  return spikeRoot().querySelector('[data-boring-workspace-part="console-spike-needs-you"]')
}

/** Document order of the main list's chat rows, by session id. */
function spikeRowIds(scope: HTMLElement = spikeList()): string[] {
  return [...scope.querySelectorAll('[data-boring-workspace-part="app-session-row"]')]
    .map((row) => row.getAttribute("data-boring-session-id") ?? "")
}

function spikeRow(title: string, scope: HTMLElement = spikeList()): HTMLElement {
  const row = within(scope).getByText(title).closest('[data-boring-workspace-part="app-session-row"]')
  if (!row) throw new Error(`no chat row for ${title}`)
  return row as HTMLElement
}

async function chooseSpikeView(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole("button", { name: "Display" }))
  fireEvent.click(screen.getByRole("menuitemradio", { name: label }))
}

function renderPane() {
  return render(
    <WorkspaceAttentionProvider>
      <AppLeftPane
        appTitle="Test"
        sessions={sessions}
        activeSessionId="s1"
        openSessionIds={["s1"]}
        pinnedSessionIds={[]}
        onCreateSession={vi.fn()}
        navigationEntries={testNavigationEntries()}
        onSwitchSession={vi.fn()}
        onOpenSessionAsPane={vi.fn()}
        onToggleSessionPinned={vi.fn()}
      />
    </WorkspaceAttentionProvider>,
  )
}

describe("AppLeftPane", () => {
  it("places New chat at the top of Chats before the scrolling session list", () => {
    renderPane()

    const appNav = screen.getByLabelText("App navigation")
    const workspaceHeading = within(appNav).getByRole("heading", { name: "Workspace" })
    const chatsHeading = within(appNav).getByRole("heading", { name: "Chats" })
    const sessionScroll = appNav.querySelector('[data-boring-workspace-part="app-left-session-scroll"]')
    const newChat = appNav.querySelector('[data-boring-workspace-part="app-left-new-chat"]')

    expect(workspaceHeading.compareDocumentPosition(chatsHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(chatsHeading.compareDocumentPosition(newChat as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect((newChat as Node).compareDocumentPosition(sessionScroll as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(sessionScroll).toContainElement(screen.getByText("First session"))
    expect(sessionScroll).not.toContainElement(screen.getByRole("button", { name: "New chat" }))
    expect(newChat).toContainElement(screen.getByRole("button", { name: "New chat" }))
  })

  describe("#1355 console spike", () => {
    const forgetStoredView = () => {
      try {
        globalThis.localStorage?.removeItem(CONSOLE_SPIKE_VIEW_KEY)
      } catch {
        // a storage-less environment is a supported case, not a test failure
      }
    }
    beforeEach(forgetStoredView)
    // The view is persisted on purpose, so a test that switches it leaks into
    // every later render — including the ones outside this block.
    afterEach(forgetStoredView)

    it("defaults to one recency-sorted list across every Project, with the Agent and Project as row metadata", () => {
      renderSpikeConsole()

      expect(screen.getByText("Recent")).toBeInTheDocument()
      // Newest first, and the Project boundary does not interrupt the order.
      expect(spikeRowIds()).toEqual(["alpha-one", "alpha-two", "beta-one"])
      // Flat means flat: neither dimension gets a collapsible header.
      expect(screen.queryByRole("button", { name: /^(Collapse|Expand) Launch$/ })).not.toBeInTheDocument()
      expect(screen.queryByRole("button", { name: /Boring Alpha/ })).not.toBeInTheDocument()

      const row = spikeRow("Console nav")
      expect(row.querySelector(SPIKE_CHIP)).toHaveAttribute("data-boring-agent-type-id", "alpha")
      expect(row.querySelector(SPIKE_CHIP)).toHaveAttribute("title", "Alpha")
      expect(row.querySelector(SPIKE_TAG)).toHaveTextContent("Agent Console")

      // Colour is derived from the Agent id, so it is stable across rows and
      // distinct between Agents.
      const alphaChips = [...spikeRoot().querySelectorAll(`${SPIKE_CHIP}[data-boring-agent-type-id="alpha"]`)]
      const betaChip = spikeRoot().querySelector(`${SPIKE_CHIP}[data-boring-agent-type-id="beta"]`)
      expect(alphaChips).toHaveLength(2)
      expect(alphaChips[0]?.className).toBe(alphaChips[1]?.className)
      expect(betaChip?.className).not.toBe(alphaChips[0]?.className)
    })

    it("groups by Project with a single collapse level and rolls attention up onto a collapsed header", async () => {
      const user = userEvent.setup()
      function BlockBetaReview() {
        const { addBlocker } = useWorkspaceAttention()
        useEffect(() => {
          addBlocker({
            id: "ask:beta-one",
            reason: "ask-user.question",
            sessionId: "beta-one",
            agentTypeId: "beta",
            sessionBadge: { kind: "question", label: "question", tone: "attention", priority: 10 },
          })
        }, [addBlocker])
        return null
      }
      renderSpikeConsole({}, <BlockBetaReview />)
      await chooseSpikeView(user, "By project")

      expect(screen.getByText("By project")).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Collapse Launch" })).toBeInTheDocument()
      // The Agent is metadata here, never a second collapse level.
      expect(screen.queryByRole("button", { name: /Boring Alpha/ })).not.toBeInTheDocument()
      // Only the first Project starts open; each group keeps the pane's one
      // recency order rather than re-sorting by Agent.
      expect(spikeRowIds()).toEqual(["alpha-one", "beta-one"])
      await user.click(screen.getByRole("button", { name: "Expand Agent Console" }))
      expect(spikeRowIds()).toEqual(["alpha-one", "beta-one", "alpha-two"])

      const row = spikeRow("Alpha launch")
      expect(row.querySelector(SPIKE_CHIP)).toHaveAttribute("data-boring-agent-type-id", "alpha")
      // The header already says which Project this is.
      expect(row.querySelector(SPIKE_TAG)).toBeNull()

      // Expanded, the row carries the badge, so the header stays quiet.
      expect(screen.queryByTitle("1 session waiting")).not.toBeInTheDocument()
      await user.click(screen.getByRole("button", { name: "Collapse Launch" }))
      expect(screen.queryByText("Alpha launch")).not.toBeInTheDocument()
      expect(screen.getByTitle("1 session waiting")).toHaveTextContent("1")
    })

    it("groups by Agent with a single collapse level, dropping the chip and keeping the Project tag", async () => {
      const user = userEvent.setup()
      renderSpikeConsole()
      await chooseSpikeView(user, "By agent")

      expect(screen.getByText("By agent")).toBeInTheDocument()
      expect(screen.getByRole("button", { name: /Collapse Boring Alpha/ })).toBeInTheDocument()
      // The Project is metadata here, never a second collapse level.
      expect(screen.queryByRole("button", { name: /^(Collapse|Expand) Launch$/ })).not.toBeInTheDocument()

      const row = spikeRow("Alpha launch")
      expect(row.querySelector(SPIKE_CHIP)).toBeNull()
      expect(row.querySelector(SPIKE_TAG)).toHaveTextContent("Launch")

      expect(spikeRowIds()).toEqual(["alpha-one", "alpha-two"])
      expect(screen.queryByText("Beta review")).not.toBeInTheDocument()
      await user.click(screen.getByRole("button", { name: /Expand Boring Beta/ }))
      expect(spikeRow("Beta review").querySelector(SPIKE_TAG)).toHaveTextContent("Launch")
    })

    it("persists the chosen view and falls back to Recent when storage holds nothing usable", async () => {
      const user = userEvent.setup()
      const chosen = renderSpikeConsole()
      await chooseSpikeView(user, "By project")
      expect(globalThis.localStorage.getItem(CONSOLE_SPIKE_VIEW_KEY)).toBe("project")
      chosen.unmount()

      const restored = renderSpikeConsole()
      expect(screen.getByText("By project")).toBeInTheDocument()
      restored.unmount()

      globalThis.localStorage.setItem(CONSOLE_SPIKE_VIEW_KEY, "by-vibes")
      renderSpikeConsole()
      expect(screen.getByText("Recent")).toBeInTheDocument()
    })

    it("falls back to Recent when a stored by-Agent view is not offered for a one-Agent spike", async () => {
      const user = userEvent.setup()
      globalThis.localStorage.setItem(CONSOLE_SPIKE_VIEW_KEY, "agent")
      renderSpikeConsole({ agents: [{ agentTypeId: "alpha", label: "Boring Alpha" }] })

      expect(screen.getByText("Recent")).toBeInTheDocument()
      await user.click(screen.getByRole("button", { name: "Display" }))
      expect(screen.getAllByRole("menuitemradio").map((item) => item.textContent)).toEqual(["Recent", "By project"])
    })

    it("pins a capped Needs you section above the list, whatever the view", async () => {
      const user = userEvent.setup()
      const blockedSessions = Array.from({ length: 6 }, (_, index) => ({
        id: `blocked-${index}`,
        agentTypeId: "alpha",
        title: `Blocked ${index}`,
        updatedAt: spikeNow - index * 1_000,
      }))
      function BlockEverySession() {
        const { addBlocker } = useWorkspaceAttention()
        useEffect(() => {
          for (const session of blockedSessions) {
            addBlocker({
              id: `ask:${session.id}`,
              reason: "ask-user.question",
              sessionId: session.id,
              agentTypeId: "alpha",
              sessionBadge: { kind: "question", label: "question", tone: "attention", priority: 10 },
            })
          }
        }, [addBlocker])
        return null
      }
      renderSpikeConsole(
        {
          projects: [{ id: "launch", name: "Launch", sessions: blockedSessions }],
          sessions: blockedSessions,
        },
        <BlockEverySession />,
      )

      const capped = spikeNeedsYou()
      expect(capped).not.toBeNull()
      expect(spikeRowIds(capped as HTMLElement)).toEqual([
        "blocked-0", "blocked-1", "blocked-2", "blocked-3", "blocked-4",
      ])

      await user.click(within(capped as HTMLElement).getByRole("button", { name: "+1 more" }))
      expect(spikeRowIds(spikeNeedsYou() as HTMLElement)).toHaveLength(6)

      // Grouping changes the list below it; the section keeps its contents and
      // its place above that list.
      await chooseSpikeView(user, "By project")
      const grouped = spikeNeedsYou() as HTMLElement
      expect(spikeRowIds(grouped)).toHaveLength(6)
      expect(grouped.compareDocumentPosition(spikeList()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it("starts the default chat from the split button's primary half, no menu step", async () => {
      const user = userEvent.setup()
      const onCreateSession = vi.fn()
      const onCreateSplitSession = vi.fn()
      const onCreatePopoverSession = vi.fn()
      renderSpikeConsole({ onCreateSession, onCreateSplitSession, onCreatePopoverSession })

      await user.click(screen.getByRole("button", { name: "New chat" }))
      // Default placement, no Agent forced: the host keeps its own targeting.
      expect(onCreateSession).toHaveBeenCalledWith(undefined)
      expect(onCreateSplitSession).not.toHaveBeenCalled()
      expect(onCreatePopoverSession).not.toHaveBeenCalled()
      expect(document.querySelector('[data-boring-workspace-part="app-left-fleet-new-chat"]')).toBeNull()
    })

    it("puts every placement behind the chevron and routes each to its own host callback", async () => {
      const user = userEvent.setup()
      const onCreateSession = vi.fn()
      const onCreateSplitSession = vi.fn()
      const onCreatePopoverSession = vi.fn()
      renderSpikeConsole({ onCreateSession, onCreateSplitSession, onCreatePopoverSession })

      const openPlacements = async () => {
        await user.click(screen.getByRole("button", { name: "Choose where the new chat opens" }))
        return screen.getByRole("menu")
      }

      const menu = await openPlacements()
      expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent))
        .toEqual(["New chat", "New in split view", "New quick chat", "Alpha\u203a", "Beta\u203a"])

      fireEvent.click(within(menu).getByRole("menuitem", { name: "New in split view" }))
      expect(onCreateSplitSession).toHaveBeenCalledWith(undefined)

      fireEvent.click(within(await openPlacements()).getByRole("menuitem", { name: "New quick chat" }))
      expect(onCreatePopoverSession).toHaveBeenCalledWith(undefined)

      fireEvent.click(within(await openPlacements()).getByRole("menuitem", { name: "New chat" }))
      expect(onCreateSession).toHaveBeenCalledWith(undefined)
    })

    it("targets one Agent through its placement submenu once the fleet has more than one", async () => {
      const user = userEvent.setup()
      const onCreateSplitSession = vi.fn()
      renderSpikeConsole({ onCreateSplitSession })

      await user.click(screen.getByRole("button", { name: "Choose where the new chat opens" }))
      await user.click(screen.getByRole("menuitem", { name: /^Beta/ }))
      const submenu = await screen.findByRole("menu", { name: /^Beta/ })
      fireEvent.click(within(submenu).getByRole("menuitem", { name: "New in split view" }))

      expect(onCreateSplitSession).toHaveBeenCalledWith("beta")
    })

    it("drops the Agent submenu for a one-Agent fleet, where it would choose nothing", async () => {
      const user = userEvent.setup()
      renderSpikeConsole({ agents: [{ agentTypeId: "alpha", label: "Boring Alpha" }] })

      await user.click(screen.getByRole("button", { name: "Choose where the new chat opens" }))
      expect(screen.getAllByRole("menuitem").map((item) => item.textContent))
        .toEqual(["New chat", "New in split view", "New quick chat"])
    })

    it("keeps in-Project create on the Project header, the only place that names a Project", async () => {
      const user = userEvent.setup()
      const onScopedCreateSession = vi.fn()
      renderSpikeConsole({
        consoleSpikeCreateSession: onScopedCreateSession,
        addressedAgentTypeId: "beta",
      })
      await chooseSpikeView(user, "By project")

      await user.click(screen.getByRole("button", { name: "New chat in Agent Console" }))
      expect(onScopedCreateSession).toHaveBeenCalledWith("beta", "console", "default")
    })
  })

  it("keeps colliding ownerless session ids unassigned instead of duplicating or misattributing them", () => {
    render(
      <WorkspaceAttentionProvider>
        <AppLeftPane
          appTitle="Test"
          consoleSpike
          projects={[{ id: "launch", name: "Launch", sessions: [{ id: "shared", title: "Owner unknown" }] }]}
          agents={[
            { agentTypeId: "alpha", label: "Boring Alpha" },
            { agentTypeId: "beta", label: "Boring Beta" },
          ]}
          sessions={[
            { id: "shared", agentTypeId: "alpha", title: "Shared alpha" },
            { id: "shared", agentTypeId: "beta", title: "Shared beta" },
          ]}
          onCreateSession={vi.fn()}
          navigationEntries={testNavigationEntries()}
          onSwitchSession={vi.fn()}
          onOpenSessionAsPane={vi.fn()}
          onToggleSessionPinned={vi.fn()}
        />
      </WorkspaceAttentionProvider>,
    )

    expect(screen.getAllByText(/Shared (alpha|beta)/)).toHaveLength(2)
    const alphaRow = spikeRow("Shared alpha")
    const betaRow = spikeRow("Shared beta")
    expect(alphaRow.querySelector(SPIKE_TAG)).toHaveTextContent("Unassigned")
    expect(alphaRow.querySelector(SPIKE_CHIP)).toHaveAttribute("title", "Alpha")
    expect(betaRow.querySelector(SPIKE_TAG)).toHaveTextContent("Unassigned")
    expect(betaRow.querySelector(SPIKE_CHIP)).toHaveAttribute("title", "Beta")
  })

  it("keeps invalid Project rename input visible and restores disclosure focus after a valid rename", async () => {
    const user = userEvent.setup()
    const onRenameProject = vi.fn()
    render(
      <WorkspaceAttentionProvider>
        <AppLeftPane
          appTitle="Test"
          consoleSpike
          projects={[{ id: "launch", name: "Launch", sessions: [] }]}
          agents={[{ agentTypeId: "alpha", label: "Boring Alpha" }]}
          sessions={[]}
          onCreateSession={vi.fn()}
          consoleSpikeRenameProject={onRenameProject}
          navigationEntries={testNavigationEntries()}
          onSwitchSession={vi.fn()}
          onOpenSessionAsPane={vi.fn()}
          onToggleSessionPinned={vi.fn()}
        />
      </WorkspaceAttentionProvider>,
    )

    await chooseSpikeView(user, "By project")
    await user.click(screen.getByRole("button", { name: "Launch options" }))
    await user.click(screen.getByRole("menuitem", { name: "Rename project" }))
    const input = screen.getByRole("textbox", { name: "Rename Launch" })
    await user.clear(input)
    await user.keyboard("{Enter}")
    expect(input).toHaveAttribute("aria-invalid", "true")
    expect(onRenameProject).not.toHaveBeenCalled()

    await user.type(input, "Roadmap{Enter}")
    expect(onRenameProject).toHaveBeenCalledWith("launch", "Roadmap")
    await waitFor(() => expect(screen.getByRole("button", { name: "Collapse Launch" })).toHaveFocus())
  })

  function renderFleetPane(overrides: Partial<Parameters<typeof AppLeftPane>[0]> = {}) {
    const handlers = {
      onCreateSession: vi.fn(),
      onCreateSplitSession: vi.fn(),
      onCreatePopoverSession: vi.fn(),
      onOpenAgentSettings: vi.fn(),
      onSelectAgent: vi.fn(),
    }
    render(
      <WorkspaceAttentionProvider>
        <AppLeftPane
          appTitle="Test"
          agents={[
            { agentTypeId: "alpha", label: "Boring Alpha", description: "Ships code", sessionsStatus: "loaded" },
            { agentTypeId: "beta", label: "Boring Beta", sessionsStatus: "loaded" },
          ]}
          selectedAgentTypeId="alpha"
          pinnedSessionRefs={[{ agentTypeId: "alpha", sessionId: "alpha-one" }]}
          sessions={[
            { id: "alpha-one", agentTypeId: "alpha", title: "Alpha session" },
            { id: "alpha-two", agentTypeId: "alpha", title: "Alpha follow-up" },
            { id: "beta-one", agentTypeId: "beta", title: "Beta session" },
          ]}
          navigationEntries={testNavigationEntries()}
          onSwitchSession={vi.fn()}
          onOpenSessionAsPane={vi.fn()}
          onToggleSessionPinned={vi.fn()}
          {...handlers}
          {...overrides}
        />
      </WorkspaceAttentionProvider>,
    )
    return handlers
  }

  it("renders an Agent card per fleet member with its own new-chat action", async () => {
    const user = userEvent.setup()
    const handlers = renderFleetPane()

    const cards = screen.getAllByRole("button", { name: /Boring .*chats?$/ })
    expect(cards.map((card) => card.getAttribute("aria-label"))).toEqual([
      "Collapse Boring Alpha; 2 chats",
      "Expand Boring Beta; 1 chat",
    ])
    // Compact rows: the description survives only as the row tooltip; the row
    // itself stays a single line at session-row density.
    expect(screen.queryByText("Ships code")).not.toBeInTheDocument()
    expect(cards[0]).toHaveAttribute("title", "Boring Alpha — Ships code")
    expect(cards[1]).toHaveTextContent(/^Beta1$/)
    // The addressed Agent starts disclosed; the other starts collapsed.
    expect(cards[0]).toHaveAttribute("aria-expanded", "true")
    expect(cards[1]).toHaveAttribute("aria-expanded", "false")

    // Owner-ratified: default click means exactly one thing — disclosure. It
    // never silently retargets new chats.
    await user.click(cards[1]!)
    expect(cards[1]).toHaveAttribute("aria-expanded", "true")
    expect(handlers.onSelectAgent).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "New chat with Boring Beta" }))
    expect(handlers.onCreateSession).toHaveBeenCalledWith("beta")
    // Placement variants live behind the single caret menu (owner: three
    // creation icons were too many).
    expect(screen.queryByRole("button", { name: "New chat with Boring Beta in split pane" })).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "New chat options for Boring Beta" }))
    await user.click(screen.getByText("New chat in split pane"))
    expect(handlers.onCreateSplitSession).toHaveBeenCalledWith("beta")
    await user.click(screen.getByRole("button", { name: "New chat options for Boring Beta" }))
    await user.click(screen.getByText("Quick chat"))
    expect(handlers.onCreatePopoverSession).toHaveBeenCalledWith("beta")
    await user.click(screen.getByRole("button", { name: "Settings for Boring Beta" }))
    expect(handlers.onOpenAgentSettings).toHaveBeenCalledWith("beta")
  })

  it("retargets new chats from the picker without creating one", async () => {
    const user = userEvent.setup()
    const handlers = renderFleetPane()

    await user.click(screen.getByRole("button", { name: "Choose Agent for new chat" }))
    await user.click(screen.getByRole("menuitem", { name: /Beta/ }))
    // Picking an Agent only changes the target; the user still decides when
    // to start the chat.
    expect(handlers.onSelectAgent).toHaveBeenCalledWith("beta")
    expect(handlers.onCreateSession).not.toHaveBeenCalled()
  })

  // Issue #1160's intent — every Agents-section control is a >=44px touch
  // target on a coarse pointer — is still the contract. What changed is where
  // that intent can honestly be checked.
  //
  // The original test asserted it by CLASS STRING (`size-11 sm:size-7`,
  // `h-11 sm:h-6`, `min-h-11 sm:min-h-0`). Those width-keyed Tailwind pairs
  // were the defect, not the guarantee: the button size keyed to VIEWPORT
  // WIDTH while the space reserved for it keyed to POINTER TYPE, so the two
  // agreed at the two viewports anyone sampled and disagreed everywhere else.
  // Sizing now comes from one custom property under one condition in
  // globals.css, and re-pinning a class string here would pin that bug back in.
  //
  // jsdom has no layout, so nothing here can measure 44 of anything; an
  // assertion that pretended to would be the same lie in a new shape. The
  // split is deliberate:
  //   - HERE: the structural contract. Every control sits on the shared
  //     surface the stylesheet sizes, and the actions that moved into the
  //     consolidated "..." menu are still REACHABLE rather than quietly gone.
  //   - REAL PIXELS: the `agent-touch-targets` hard gate in
  //     tools/ui-review/src/review-specs/workspace-agent-sidebar, which
  //     measures getBoundingClientRect at four width x pointer corners and
  //     sweeps the portalled app-left menus as well as the pane.
  it("keeps every Agents-section control on the touch-sized surfaces (issue #1160)", async () => {
    const user = userEvent.setup()
    renderFleetPane()

    // Fleet new-chat row: the row carries the surface CSS grows to 44px, and
    // the primary button fills it rather than restating a height of its own.
    const fleetRow = document.querySelector('[data-boring-workspace-part="app-left-fleet-new-chat"]')
    expect(fleetRow).toHaveClass("app-left-new-chat-action")
    expect(screen.getByRole("button", { name: "Start new chat with Boring Alpha" })).toHaveClass("h-full")
    for (const name of [
      "Start split chat with Boring Alpha",
      "Start quick chat with Boring Alpha",
      "Choose Agent for new chat",
    ]) {
      expect(screen.getByRole("button", { name })).toHaveClass("app-left-secondary-action")
    }

    // The filter affordance in both of its states. The Agents section header
    // is no longer a control at all (owner decision: static title), so there
    // is nothing there left to size — its assertion is dropped rather than
    // weakened, and every other control below keeps its own.
    await user.click(screen.getByRole("button", { name: "Filter Agents" }))
    expect(screen.getByRole("searchbox", { name: "Filter Agents" })).toHaveClass("app-left-filter-input")

    // Every Agent card is a sized surface, and its always-visible icon
    // actions sit on the shared secondary-action surface.
    const cards = document.querySelectorAll(".app-left-agent-card")
    expect(cards).toHaveLength(2)
    expect(screen.getByRole("button", { name: /^Collapse Boring Alpha;/ })).toHaveClass("self-stretch")
    for (const name of [
      "Settings for Boring Alpha",
      "New chat options for Boring Alpha",
      "New chat with Boring Alpha",
    ]) {
      expect(screen.getByRole("button", { name })).toHaveClass("app-left-secondary-action")
    }

    // The other half of the intent: split and quick chat did not disappear
    // when their icons did. They are menu items now, inside a menu tagged with
    // the part hook that both the 44px rule and the review gate use to reach
    // past the Radix portal — a control that leaves the pane subtree leaves
    // every sweep that only looks at the pane subtree.
    await user.click(screen.getByRole("button", { name: "New chat options for Boring Alpha" }))
    const menu = screen.getByRole("menu")
    expect(menu.closest('[data-boring-workspace-part="app-left-menu"]')).not.toBeNull()
    for (const name of ["New chat", "New chat in split pane", "Quick chat"]) {
      expect(within(menu).getByRole("menuitem", { name })).toBeInTheDocument()
    }
  })

  // Replaces "collapses the Agents section including the nested chats": the
  // owner removed section-level collapsing, so that behaviour has no contract
  // left to assert. Its two still-true claims were already covered elsewhere
  // and are NOT lost — nested chats collapsing with their own Agent and pinned
  // chats staying top-level are both asserted by "nests each Agent's chats
  // under its card behind a disclosure" below, which is what they describe.
  it("renders Agents as a static section title, never a disclosure", () => {
    renderFleetPane()

    const heading = document.querySelector('[data-boring-workspace-part="app-left-agents-heading"]')
    expect(heading).toHaveTextContent("Agents")
    // A title, not a control: nothing to press, nothing to expand.
    expect(heading?.closest("button")).toBeNull()
    expect(screen.queryByRole("button", { name: /^Agents/ })).not.toBeInTheDocument()
    expect(document.querySelector('[aria-controls="boring-app-left-agents-panel"]')).toBeNull()
    // The seat summary sits with the title, like the pinned section's count.
    expect(document.querySelector('[data-boring-workspace-part="app-left-agents-count"]')).toHaveTextContent("2 seats")
    // The Agent cards are unconditionally present, as is the filter icon that
    // used to be gated on the section being open.
    expect(screen.getByRole("button", { name: /Boring Alpha;/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Filter Agents" })).toBeInTheDocument()
  })

  it("nests each Agent's chats under its card behind a disclosure", async () => {
    const user = userEvent.setup()
    renderFleetPane()

    // The addressed Agent (alpha) starts expanded; its unpinned chats render
    // in the guided sub-list under the card. Pinned chats stay top-level.
    const alphaSessions = screen.getByText("Alpha follow-up").closest('[data-boring-workspace-part="app-left-agent-sessions"]')
    expect(alphaSessions).toBeInTheDocument()
    expect(screen.getByText("Pinned chats")).toBeInTheDocument()
    // Pinning is a shortcut, not a move: the pinned chat shows in Pinned AND
    // stays inside its Agent's nested list, keeping the count honest.
    expect(screen.getAllByText("Alpha session")).toHaveLength(2)
    // Beta is collapsed: its chats are hidden until disclosed.
    expect(screen.queryByText("Beta session")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /Boring Beta; 1 chat$/ }))
    expect(screen.getByText("Beta session").closest('[data-boring-workspace-part="app-left-agent-sessions"]')).toBeInTheDocument()

    // Collapse alpha again: its nested chats disappear, beta's stay.
    await user.click(screen.getByRole("button", { name: /Boring Alpha; 2 chats$/ }))
    expect(screen.queryByText("Alpha follow-up")).not.toBeInTheDocument()
    expect(screen.getByText("Beta session")).toBeInTheDocument()
  })

  it("keeps nested session-row chat actions a genuine 44px+ mobile touch target", () => {
    renderFleetPane()

    // Regression for the ui-review mobile touch gate (#1110 / #1162 lineage):
    // the per-session chat-actions trigger on rows nested under agent rows is
    // sized by `.app-left-session-secondary-action` (globals.css), which reads
    // `--app-session-action-slot` (28px fine / 44px coarse-or-narrow) so the
    // button always fills exactly the slot the strip reserves for it. It must
    // carry that class and NO Tailwind size utility that could disagree with
    // the slot (post-#1176 contract; same as AppLeftPaneSessionRow shortcuts).
    const triggers = screen.getAllByRole("button", { name: /^Chat actions for / })
    expect(triggers.length).toBeGreaterThan(0)
    for (const trigger of triggers) {
      expect(trigger).toHaveClass("app-left-session-secondary-action", "shrink-0")
      expect(trigger.className).not.toMatch(/(?:^|[\s:])size-\d/)
    }
  })

  it("drops the per-Agent lens in nested mode: disclosure is the only scoping", () => {
    renderFleetPane()

    // With chats nested under their Agents there is no shared list left to
    // filter, so the confusing per-card filter state is gone entirely.
    expect(screen.queryByRole("button", { name: /^Show only .* chats$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("region", { name: "Chats" })).not.toBeInTheDocument()
  })

  it("marks the active chat with a quiet rail, not a dot", () => {
    renderFleetPane({ activeSessionRef: { agentTypeId: "alpha", sessionId: "alpha-one" } })

    // The static dot is reserved for working chats; the open chat gets the
    // discreet accent rail at the row edge instead.
    const activeRow = document.querySelector('[data-boring-session-state="active"]')
    expect(activeRow?.querySelector('[data-boring-workspace-part="app-session-active-rail"]')).toBeTruthy()
    expect(screen.queryByTitle("Active session")).not.toBeInTheDocument()
  })

  it("aggregates working and attention counts on the Agent card", async () => {
    renderFleetPane()

    expect(document.querySelector('[data-boring-workspace-part="agent-card-working-count"]')).toBeNull()
    act(() => window.dispatchEvent(new CustomEvent("boring:chat-session-status", {
      detail: { sessionId: "alpha-two", agentTypeId: "alpha", working: true },
    })))
    await waitFor(() => {
      const workingCount = document.querySelector('[data-boring-workspace-part="agent-card-working-count"]')
      expect(workingCount?.textContent).toContain("1")
    })
  })

  it("shows a quiet relative age on idle session rows with the exact time on hover", () => {
    const twoHoursAgo = Date.now() - 2 * 3_600_000
    renderFleetPane({
      sessions: [
        { id: "alpha-one", agentTypeId: "alpha", title: "Alpha session", updatedAt: twoHoursAgo },
        { id: "alpha-two", agentTypeId: "alpha", title: "Alpha follow-up", updatedAt: twoHoursAgo },
        { id: "beta-one", agentTypeId: "beta", title: "Beta session" },
      ],
    })

    const age = document.querySelector('[data-boring-workspace-part="app-session-age"]')
    expect(age?.textContent).toBe("2h")
    const row = age?.closest("button")
    expect(row?.getAttribute("title")).toContain("Last activity:")
  })

  it("shows working state on fleet rows and filters cards by name", async () => {
    const user = userEvent.setup()
    renderFleetPane()

    expect(screen.queryByTitle("Working")).not.toBeInTheDocument()
    act(() => window.dispatchEvent(new CustomEvent("boring:chat-session-status", {
      detail: { sessionId: "alpha-one", agentTypeId: "alpha", working: true },
    })))
    // The working (pulsing) dot appears on the pinned row and its nested twin.
    await waitFor(() => expect(screen.getAllByTitle("Working")).toHaveLength(2))

    // The filter hides behind its icon until asked for.
    expect(screen.queryByRole("searchbox", { name: "Filter Agents" })).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Filter Agents" }))
    await user.type(screen.getByRole("searchbox", { name: "Filter Agents" }), "beta")
    expect(screen.queryByRole("button", { name: /Boring Alpha;/ })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Boring Beta;/ })).toBeInTheDocument()
  })

  it("defaults the plain fleet new chat to the selected Agent", async () => {
    const user = userEvent.setup()
    const handlers = renderFleetPane()

    await user.click(screen.getByRole("button", { name: "Start new chat with Boring Alpha" }))
    expect(handlers.onCreateSession).toHaveBeenCalledWith("alpha")
    // Picking another Agent retargets the button; it does not start a chat.
    await user.click(screen.getByRole("button", { name: "Choose Agent for new chat" }))
    await user.click(screen.getByRole("menuitem", { name: "Beta" }))
    expect(handlers.onSelectAgent).toHaveBeenCalledWith("beta")
    expect(handlers.onCreateSession).toHaveBeenCalledTimes(1)
  })

  it("keeps the flat Chats shell when no addressed fleet is supplied", () => {
    render(
      <WorkspaceAttentionProvider>
        <AppLeftPane
          appTitle="Test"
          layoutMode="multi-project"
          projects={[{ id: "project", name: "Project", sessions: [] }]}
          activeProjectId="project"
          sessions={[]}
          onCreateSession={vi.fn()}
          onCreateSplitSession={vi.fn()}
          onCreatePopoverSession={vi.fn()}
          navigationEntries={testNavigationEntries()}
          onSwitchSession={vi.fn()}
          onOpenSessionAsPane={vi.fn()}
          onToggleSessionPinned={vi.fn()}
        />
      </WorkspaceAttentionProvider>,
    )

    expect(screen.getByRole("heading", { name: "Chats" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "New chat" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Use / })).not.toBeInTheDocument()
    expect(screen.getByText("Project")).toBeInTheDocument()
  })

  // Supersedes "gives a one-Agent addressed fleet its own card". Owner ruling:
  // a fleet of one is not a fleet — the per-Agent section, its card and the New
  // chat Agent picker all describe a choice that does not exist, so the pane
  // falls back to the plain "Chats" list. Known consequence, accepted by the
  // owner: the card was the pane's route to that Agent's settings, so with one
  // Agent those settings are reached from the Agent surfaces outside the pane.
  it("renders a flat Chats list with no fleet chrome for a one-Agent fleet", async () => {
    const user = userEvent.setup()
    const onOpenAgentSettings = vi.fn()
    const onCreateSession = vi.fn()
    render(
      <WorkspaceAttentionProvider>
        <AppLeftPane
          appTitle="Test"
          agents={[{ agentTypeId: "solo", label: "Boring Solo", sessionsStatus: "loaded" }]}
          selectedAgentTypeId="solo"
          sessions={[{ id: "s1", agentTypeId: "solo", title: "Solo session" }]}
          activeSessionRef={{ agentTypeId: "solo", sessionId: "s1" }}
          onCreateSession={onCreateSession}
          onOpenAgentSettings={onOpenAgentSettings}
          navigationEntries={testNavigationEntries()}
          onSwitchSession={vi.fn()}
          onOpenSessionAsPane={vi.fn()}
          onToggleSessionPinned={vi.fn()}
        />
      </WorkspaceAttentionProvider>,
    )

    // Header + flat list, exactly like the no-fleet shell.
    expect(screen.getByRole("heading", { name: "Chats" })).toBeInTheDocument()
    expect(screen.getByText("Solo session")).toBeInTheDocument()
    // No grouping chrome: no Agents section, no Agent card, no seat count.
    expect(document.querySelector('[data-boring-workspace-part="app-left-pane-agents"]')).toBeNull()
    expect(document.querySelector('[data-boring-workspace-part="app-left-agent-tree"]')).toBeNull()
    expect(document.querySelector('[data-boring-workspace-part="app-left-agents-count"]')).toBeNull()
    expect(screen.queryByRole("button", { name: /Boring Solo; 1 chat$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Settings for Boring Solo" })).not.toBeInTheDocument()
    expect(onOpenAgentSettings).not.toHaveBeenCalled()
    // New chat is a plain button: no Agent dropdown, no per-Agent variant.
    expect(document.querySelector('[data-boring-workspace-part="app-left-new-chat"]')).not.toBeNull()
    expect(screen.queryByRole("button", { name: /^Start new chat with / })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Choose Agent for new chat" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "New chat with Boring Solo" })).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "New chat" }))
    expect(onCreateSession).toHaveBeenCalled()
    // Session cards keep the fleet row idiom: the active rail only renders when
    // the row is in fleet (accent-dot) mode, so its presence proves the cards
    // are untouched by dropping the surrounding chrome.
    expect(document.querySelector('[data-boring-workspace-part="app-session-active-rail"]')).not.toBeNull()
  })

  it("keeps the fleet sections and the New chat Agent picker for two or more Agents", () => {
    renderFleetPane()

    expect(document.querySelector('[data-boring-workspace-part="app-left-pane-agents"]')).not.toBeNull()
    expect(document.querySelector('[data-boring-workspace-part="app-left-agents-count"]')).toHaveTextContent("2 seats")
    expect(screen.getByRole("button", { name: /Boring Alpha;/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Boring Beta;/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Start new chat with Boring Alpha" })).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Chats" })).not.toBeInTheDocument()
  })

  it("unifies the multi-project fleet: labeled project rows, a lens that filters them, and a global new chat", async () => {
    const user = userEvent.setup()
    const onCreateSession = vi.fn()
    render(
      <WorkspaceAttentionProvider>
        <AppLeftPane
          appTitle="Test"
          layoutMode="multi-project"
          projects={[{ id: "project", name: "Project" }]}
          activeProjectId="project"
          agents={[
            { agentTypeId: "alpha", label: "Boring Alpha", sessionsStatus: "loaded" },
            { agentTypeId: "beta", label: "Boring Beta", sessionsStatus: "loaded" },
          ]}
          selectedAgentTypeId="alpha"
          sessions={[
            { id: "alpha-one", agentTypeId: "alpha", title: "Alpha session" },
            { id: "beta-one", agentTypeId: "beta", title: "Beta session" },
          ]}
          onCreateSession={onCreateSession}
          onCreateSplitSession={vi.fn()}
          onCreatePopoverSession={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          navigationEntries={testNavigationEntries()}
          onSwitchSession={vi.fn()}
          onOpenSessionAsPane={vi.fn()}
          onToggleSessionPinned={vi.fn()}
        />
      </WorkspaceAttentionProvider>,
    )

    // Item 6: the global fleet new chat exists here too, naming its Agent.
    await user.click(screen.getByRole("button", { name: "Start new chat with Boring Alpha" }))
    expect(onCreateSession).toHaveBeenCalledWith("alpha")

    // Item 4: project rows name their owning Agent.
    const alphaRow = screen.getByText("Alpha session").closest('[data-boring-workspace-part="app-session-row"]')
    expect(alphaRow).toHaveTextContent("Alpha")
    expect(screen.getByText("Beta session").closest('[data-boring-workspace-part="app-session-row"]')).toHaveTextContent("Beta")

    // Item 5: the lens narrows the project tree, not just a separate flat list.
    await user.click(screen.getByRole("button", { name: "Show only Boring Beta chats" }))
    expect(screen.queryByText("Alpha session")).not.toBeInTheDocument()
    expect(screen.getByText("Beta session")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Clear Beta chat filter" }))
    expect(screen.getByText("Alpha session")).toBeInTheDocument()
  })

  it("shows a loading state instead of a false empty when the lensed Agent is still loading", async () => {
    const user = userEvent.setup()
    renderFleetPane({
      agents: [
        { agentTypeId: "alpha", label: "Boring Alpha", sessionsStatus: "loaded" },
        { agentTypeId: "beta", label: "Boring Beta", sessionsStatus: "loading" },
      ],
      sessions: [{ id: "alpha-one", agentTypeId: "alpha", title: "Alpha session" }],
      pinnedSessionRefs: [],
    })

    await user.click(screen.getByRole("button", { name: /Boring Beta; 0 chats$/ }))
    expect(screen.queryByText("No chats yet.")).not.toBeInTheDocument()
    expect(screen.getByLabelText("Loading chats")).toBeInTheDocument()
  })

  it("renders icon-only collapsed shortcuts with accessible labels", () => {
    const onOpenChats = vi.fn()
    const onCreateSession = vi.fn()
    const onOpenCommandPalette = vi.fn()
    const onOpenTasks = vi.fn()
    const navigationEntries = testNavigationEntries([
      { id: "tasks", label: "Tasks", icon: <span>T</span>, onClick: onOpenTasks, active: true },
      { id: "inbox", label: "Inbox", icon: null, trailing: "3", onClick: vi.fn() },
    ], { onOpenChats, onOpenCommandPalette })
    render(
      <AppLeftRail
        navigationEntries={navigationEntries}
        onCreateSession={onCreateSession}
      />,
    )

    const rail = screen.getByLabelText("Collapsed app navigation")
    expect(rail).toHaveClass("border-border")
    expect(rail).toHaveClass("bg-[color:oklch(from_var(--background)_calc(l-0.012)_c_h)]")
    fireEvent.click(within(rail).getByRole("button", { name: "Chats" }))
    fireEvent.click(within(rail).getByRole("button", { name: "Search" }))
    fireEvent.click(within(rail).getByRole("button", { name: "Tasks" }))
    fireEvent.click(within(rail).getByRole("button", { name: "New chat" }))

    expect(onOpenChats).toHaveBeenCalledOnce()
    expect(onOpenCommandPalette).toHaveBeenCalledOnce()
    expect(onOpenTasks).toHaveBeenCalledOnce()
    expect(onCreateSession).toHaveBeenCalledOnce()
    expect(within(rail).getByRole("button", { name: "Tasks" })).toHaveAttribute("aria-current", "page")
    expect(within(rail).getByRole("button", { name: "Inbox" }).querySelector("svg")).toBeInTheDocument()
    expect(within(rail).getByText("3")).toBeInTheDocument()
    expect(within(rail).queryByText("Search")).not.toBeInTheDocument()
    expect(within(rail).queryByText("Chats")).not.toBeInTheDocument()
    expect(within(rail).queryByText("New chat")).not.toBeInTheDocument()
  })

  it("keeps collapsed and expanded navigation entries in the same order", () => {
    const actions = [
      { id: "inbox", label: "Inbox", icon: <span>I</span>, onClick: vi.fn() },
      { id: "tasks", label: "Tasks", icon: <span>T</span>, onClick: vi.fn() },
      { id: "automations", label: "Automations", icon: <span>A</span>, onClick: vi.fn() },
      { id: "skills", label: "Agent", icon: <span>S</span>, onClick: vi.fn() },
    ]
    const navigationEntries = testNavigationEntries(actions)
    render(
      <WorkspaceAttentionProvider>
        <div data-testid="expanded-navigation">
          <AppLeftPane
            appTitle="Test"
            sessions={sessions}
            navigationEntries={navigationEntries}
            onCreateSession={vi.fn()}
            onSwitchSession={vi.fn()}
            onOpenSessionAsPane={vi.fn()}
            onToggleSessionPinned={vi.fn()}
          />
        </div>
        <div data-testid="collapsed-navigation">
          <AppLeftRail
            navigationEntries={navigationEntries}
            onCreateSession={vi.fn()}
          />
        </div>
      </WorkspaceAttentionProvider>,
    )

    const orderWithin = (root: HTMLElement) => Array.from(
      root.querySelectorAll<HTMLElement>("[data-boring-app-left-nav-key]"),
      (entry) => entry.dataset.boringAppLeftNavKey,
    )

    const expandedOrder = orderWithin(screen.getByTestId("expanded-navigation"))
    const collapsedOrder = orderWithin(screen.getByTestId("collapsed-navigation"))
    expect(expandedOrder).toEqual(navigationEntries.map((entry) => entry.key))
    expect(collapsedOrder).toEqual(expandedOrder)
  })

  it("uses the rail icon and hit-area tokens for the app-navigation toggle", () => {
    render(
      <PluginTabsWorkspaceShell
        collapsed
        leftPane={<div>App navigation</div>}
        collapsedRail={<div>Rail</div>}
        onExpand={vi.fn()}
        onCollapse={vi.fn()}
      >
        <div>Content</div>
      </PluginTabsWorkspaceShell>,
    )

    const toggle = screen.getByRole("button", { name: "Open app navigation" })
    expect(toggle).toHaveClass("h-8", "w-8")
    expect(toggle.querySelector("svg")).toHaveClass("size-4")
  })

  it("keeps mobile drawer controls open for multi-step interactions", () => {
    const originalWidth = window.innerWidth
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 500 })
    const onProjectExpand = vi.fn()
    render(
      <PluginTabsWorkspaceShell
        collapsed={false}
        mobileShellEnabled
        leftPane={(
          <aside data-boring-workspace-part="app-left-pane" style={{ width: 420, minWidth: 420, maxWidth: 420 }}>
            <button type="button" onClick={onProjectExpand}>Expand project</button>
            <button type="button" data-boring-mobile-dismiss="true">Open chat</button>
          </aside>
        )}
        collapsedRail={<div>Rail</div>}
        onExpand={vi.fn()}
        onCollapse={vi.fn()}
      >
        <div>Content</div>
      </PluginTabsWorkspaceShell>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Open app navigation" }))
    const overlay = document.querySelector('[data-boring-workspace-part="app-left-mobile-overlay"]')
    expect(overlay).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Expand project" }))
    expect(onProjectExpand).toHaveBeenCalledOnce()
    expect(overlay).toBeInTheDocument()
    expect(overlay).toHaveClass("[&>[data-boring-workspace-part=app-left-pane]]:!w-full")
    fireEvent.click(screen.getByRole("button", { name: "Open chat" }))
    expect(document.querySelector('[data-boring-workspace-part="app-left-mobile-overlay"]')).not.toBeInTheDocument()
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth })
  })

  it("shows loading, then a resolved empty state, then loaded chats without flashing empty", () => {
    const baseProps = {
      appTitle: "Test",
      onCreateSession: vi.fn(),
      navigationEntries: testNavigationEntries(),
      onSwitchSession: vi.fn(),
      onOpenSessionAsPane: vi.fn(),
      onToggleSessionPinned: vi.fn(),
    }
    const { rerender } = render(
      <WorkspaceAttentionProvider>
        <AppLeftPane
          {...baseProps}
          sessions={[]}
          sessionsLoading
        />
      </WorkspaceAttentionProvider>,
    )

    expect(screen.getByRole("status", { name: "Loading chats" })).toBeInTheDocument()
    expect(screen.queryByText("No chats yet.")).not.toBeInTheDocument()

    rerender(
      <WorkspaceAttentionProvider>
        <AppLeftPane {...baseProps} sessions={[]} sessionsLoading={false} />
      </WorkspaceAttentionProvider>,
    )
    expect(screen.getByText("No chats yet.")).toBeInTheDocument()
    expect(screen.queryByRole("status", { name: "Loading chats" })).not.toBeInTheDocument()

    rerender(
      <WorkspaceAttentionProvider>
        <AppLeftPane {...baseProps} sessions={[{ id: "loaded", title: "Loaded chat" }]} sessionsLoading={false} />
      </WorkspaceAttentionProvider>,
    )
    expect(screen.queryByText("No chats yet.")).not.toBeInTheDocument()
    expect(screen.getByText("Loaded chat")).toBeInTheDocument()
  })

  it("keeps multi-project chats loading until the active project inventory resolves", () => {
    const baseProps = {
      appTitle: "Test",
      layoutMode: "multi-project" as const,
      projects: [{ id: "project", name: "Project" }],
      activeProjectId: "project",
      onCreateSession: vi.fn(),
      navigationEntries: testNavigationEntries(),
      onSwitchSession: vi.fn(),
      onOpenSessionAsPane: vi.fn(),
      onToggleSessionPinned: vi.fn(),
    }
    const { rerender } = render(
      <WorkspaceAttentionProvider>
        <AppLeftPane {...baseProps} sessions={[]} sessionsLoading />
      </WorkspaceAttentionProvider>,
    )

    expect(screen.getByRole("status", { name: "Loading chats" })).toBeInTheDocument()
    expect(screen.queryByText("No chats yet.")).not.toBeInTheDocument()

    rerender(
      <WorkspaceAttentionProvider>
        <AppLeftPane {...baseProps} sessions={[]} sessionsLoading={false} />
      </WorkspaceAttentionProvider>,
    )
    expect(screen.getByText("No chats yet.")).toBeInTheDocument()

    rerender(
      <WorkspaceAttentionProvider>
        <AppLeftPane {...baseProps} sessions={[{ id: "loaded-project", title: "Loaded project chat" }]} sessionsLoading={false} />
      </WorkspaceAttentionProvider>,
    )
    expect(screen.queryByText("No chats yet.")).not.toBeInTheDocument()
    expect(screen.getByText("Loaded project chat")).toBeInTheDocument()
  })

  it("shows working state beside session names", () => {
    renderPane()

    act(() => {
      window.dispatchEvent(new CustomEvent("boring:chat-session-status", {
        detail: { sessionId: "s2", working: true },
      }))
    })

    const badge = document.querySelector('[data-boring-badge="working"]')
    expect(badge).toBeInTheDocument()
    expect(badge?.closest('[data-boring-workspace-part="app-session-row"]')).toHaveTextContent("Second session")
  })

  it("requests current working state when the session list mounts after the chat panel", async () => {
    const onRequest = () => window.dispatchEvent(new CustomEvent("boring:chat-session-status", {
      detail: { sessionId: "s2", working: true },
    }))
    window.addEventListener("boring:chat-session-status-request", onRequest)

    try {
      renderPane()

      await waitFor(() => expect(document.querySelector('[data-boring-badge="working"]')
        ?.closest('[data-boring-workspace-part="app-session-row"]')).toHaveTextContent("Second session"))
    } finally {
      window.removeEventListener("boring:chat-session-status-request", onRequest)
    }
  })

  it("clears optimistic working state from an authoritative idle session refresh", async () => {
    const props = {
      appTitle: "Test",
      activeSessionId: "s1",
      openSessionIds: ["s1"],
      pinnedSessionIds: [],
      onCreateSession: vi.fn(),
      navigationEntries: testNavigationEntries(),
      onSwitchSession: vi.fn(),
      onOpenSessionAsPane: vi.fn(),
      onToggleSessionPinned: vi.fn(),
    }
    const { rerender } = render(
      <WorkspaceAttentionProvider>
        <AppLeftPane {...props} sessions={sessions} />
      </WorkspaceAttentionProvider>,
    )
    act(() => window.dispatchEvent(new CustomEvent("boring:chat-session-status", {
      detail: { sessionId: "s2", working: true },
    })))
    expect(document.querySelector('[data-boring-badge="working"]')).toBeInTheDocument()

    rerender(
      <WorkspaceAttentionProvider>
        <AppLeftPane {...props} sessions={sessions.map((session) => ({ ...session, status: "idle" as const }))} />
      </WorkspaceAttentionProvider>,
    )

    await waitFor(() => expect(document.querySelector('[data-boring-badge="working"]')).toBeNull())
  })

  it("shows a hover action for creating a quick popover chat", () => {
    const onCreateSession = vi.fn()
    const onCreatePopoverSession = vi.fn()
    render(
      <WorkspaceAttentionProvider>
        <AppLeftPane
          appTitle="Test"
          sessions={sessions}
          activeSessionId="s1"
          openSessionIds={["s1"]}
          pinnedSessionIds={[]}
          onCreateSession={onCreateSession}
          onCreatePopoverSession={onCreatePopoverSession}
          navigationEntries={testNavigationEntries()}
          onSwitchSession={vi.fn()}
          onOpenSessionAsPane={vi.fn()}
          onToggleSessionPinned={vi.fn()}
        />
      </WorkspaceAttentionProvider>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Quick chat" }))

    expect(onCreatePopoverSession).toHaveBeenCalledTimes(1)
    expect(onCreateSession).not.toHaveBeenCalled()
    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
  })

  it("keeps the main New chat button as an action, not an active item", () => {
    const onCreateSession = vi.fn()
    render(
      <WorkspaceAttentionProvider>
        <AppLeftPane
          appTitle="Test"
          sessions={sessions}
          activeSessionId="s1"
          openSessionIds={["s1"]}
          pinnedSessionIds={[]}
          onCreateSession={onCreateSession}
          onCreatePopoverSession={vi.fn()}
          navigationEntries={testNavigationEntries()}
          onSwitchSession={vi.fn()}
          onOpenSessionAsPane={vi.fn()}
          onToggleSessionPinned={vi.fn()}
        />
      </WorkspaceAttentionProvider>,
    )

    fireEvent.click(screen.getByRole("button", { name: "New chat" }))
    expect(onCreateSession).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("button", { name: "New chat" })).not.toHaveAttribute("data-active")
  })

  it("mutes the active session row when an overlay owns nav selection", () => {
    render(
      <WorkspaceAttentionProvider>
        <AppLeftPane
          appTitle="Test"
          sessions={sessions}
          activeSessionId="s1"
          muteActiveSession
          openSessionIds={["s1"]}
          pinnedSessionIds={[]}
          onCreateSession={vi.fn()}
          navigationEntries={testNavigationEntries()}
          onSwitchSession={vi.fn()}
          onOpenSessionAsPane={vi.fn()}
          onToggleSessionPinned={vi.fn()}
        />
      </WorkspaceAttentionProvider>,
    )

    expect(screen.getByText("First session").closest('[data-boring-workspace-part="app-session-row"]')).toHaveAttribute("data-boring-session-state", "open")
  })

  it("calls onSwitchSession when reselecting the active session", () => {
    const onSwitchSession = vi.fn()
    render(
      <WorkspaceAttentionProvider>
        <AppLeftPane
          appTitle="Test"
          sessions={sessions}
          activeSessionId="s1"
          openSessionIds={["s1"]}
          pinnedSessionIds={[]}
          onCreateSession={vi.fn()}
          navigationEntries={testNavigationEntries()}
          onSwitchSession={onSwitchSession}
          onOpenSessionAsPane={vi.fn()}
          onToggleSessionPinned={vi.fn()}
        />
      </WorkspaceAttentionProvider>,
    )

    fireEvent.click(screen.getByText("First session"))
    expect(onSwitchSession).toHaveBeenCalledWith("s1")
  })

  it("keeps the status badge area clickable for switching sessions", () => {
    const onSwitchSession = vi.fn()
    render(
      <WorkspaceAttentionProvider>
        <AppLeftPane
          appTitle="Test"
          sessions={sessions}
          activeSessionId="s1"
          openSessionIds={["s1"]}
          pinnedSessionIds={[]}
          onCreateSession={vi.fn()}
          navigationEntries={testNavigationEntries()}
          onSwitchSession={onSwitchSession}
          onOpenSessionAsPane={vi.fn()}
          onToggleSessionPinned={vi.fn()}
        />
      </WorkspaceAttentionProvider>,
    )

    act(() => {
      window.dispatchEvent(new CustomEvent("boring:chat-session-status", {
        detail: { sessionId: "s2", working: true },
      }))
    })

    const badge = document.querySelector('[data-boring-badge="working"]')
    expect(badge).toBeInTheDocument()
    fireEvent.click(badge as Element)
    expect(onSwitchSession).toHaveBeenCalledWith("s2")
  })

  it("keeps structured addressed refs distinct from a colliding raw legacy id", async () => {
    const user = userEvent.setup()
    const addressedKey = workspaceSessionKey("shared", "alpha")
    const onSwitchSession = vi.fn()
    const onToggleSessionPinned = vi.fn()
    render(
      <WorkspaceAttentionProvider>
        <AppLeftPane
          appTitle="Test"
          sessions={[
            { id: "shared", agentTypeId: "alpha", title: "Addressed session" },
            { id: addressedKey, title: "Legacy collision" },
          ]}
          activeSessionRef={{ sessionId: "shared", agentTypeId: "alpha" }}
          openSessionIds={[addressedKey]}
          pinnedSessionRefs={[{ sessionId: "shared", agentTypeId: "alpha" }]}
          onCreateSession={vi.fn()}
          navigationEntries={testNavigationEntries()}
          onSwitchSession={onSwitchSession}
          onOpenSessionAsPane={vi.fn()}
          onToggleSessionPinned={onToggleSessionPinned}
        />
      </WorkspaceAttentionProvider>,
    )

    expect(screen.getByText("Addressed session").closest('[data-boring-workspace-part="app-session-row"]')).toHaveAttribute("data-boring-session-state", "active")
    expect(screen.getByText("Legacy collision").closest('[data-boring-workspace-part="app-session-row"]')).toHaveAttribute("data-boring-session-state", "open")
    fireEvent.click(screen.getByText("Addressed session"))
    fireEvent.click(screen.getByText("Legacy collision"))
    await user.click(screen.getByRole("button", { name: "Chat actions for Addressed session" }))
    await user.click(screen.getByRole("menuitem", { name: "Unpin chat" }))
    expect(onSwitchSession).toHaveBeenNthCalledWith(1, "shared", "alpha")
    expect(onSwitchSession).toHaveBeenNthCalledWith(2, addressedKey)
    expect(onToggleSessionPinned).toHaveBeenCalledWith("shared", "alpha")
  })

  it("shows question state beside session names", () => {
    function BlockSession() {
      const { addBlocker } = useWorkspaceAttention()
      useEffect(() => {
        addBlocker({
          id: "ask:s2",
          reason: "ask-user.question",
          sessionId: "s2",
          sessionBadge: { kind: "question", label: "question", tone: "attention", priority: 10 },
        })
      }, [addBlocker])
      return null
    }

    render(
      <WorkspaceAttentionProvider>
        <BlockSession />
        <AppLeftPane
          appTitle="Test"
          sessions={sessions}
          activeSessionId="s1"
          openSessionIds={["s1"]}
          pinnedSessionIds={[]}
          onCreateSession={vi.fn()}
          navigationEntries={testNavigationEntries()}
          onSwitchSession={vi.fn()}
          onOpenSessionAsPane={vi.fn()}
          onToggleSessionPinned={vi.fn()}
        />
      </WorkspaceAttentionProvider>,
    )

    const badge = document.querySelector('[data-boring-badge="question"]')
    expect(badge).toBeInTheDocument()
    expect(badge?.closest('[data-boring-workspace-part="app-session-row"]')).toHaveTextContent("Second session")
    expect(screen.getByText("question")).toBeInTheDocument()
  })
})

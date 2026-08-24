import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { useEffect, type ReactNode } from "react"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WorkspaceAttentionProvider, useWorkspaceAttention } from "../../../attention/WorkspaceAttentionProvider"
import { AppLeftPane, createAppLeftNavigationEntries, type AppLeftPaneAction } from "../AppLeftPane"

/**
 * The #1355 console variant's own tests. Split out of AppLeftPane.test.tsx,
 * which they had grown to two thirds of — and which is the SHIPPED pane's
 * test file. Keeping them here means deleting the spike deletes its tests in
 * one move, and the shipped pane's suite stays readable in the meantime.
 */
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


describe("AppLeftPane · #1355 console variant", () => {
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
      // recency order rather than re-sorting by Agent. A chat waiting on a
      // human stays in its group like any other; triage lives in the Inbox.
      expect(spikeRowIds()).toEqual(["alpha-one", "beta-one"])
      await user.click(screen.getByRole("button", { name: "Expand Agent Console" }))
      expect(spikeRowIds()).toEqual(["alpha-one", "beta-one", "alpha-two"])

      const row = spikeRow("Alpha launch")
      expect(row.querySelector(SPIKE_CHIP)).toHaveAttribute("data-boring-agent-type-id", "alpha")
      // The header already says which Project this is.
      expect(row.querySelector(SPIKE_TAG)).toBeNull()

      // Collapsed, the header still counts the promoted chat: it is Launch's
      // chat wherever its row currently sits.
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
        .toEqual(["New chat", "New in split view", "Alpha\u203a", "Beta\u203a"])

      fireEvent.click(within(menu).getByRole("menuitem", { name: "New in split view" }))
      expect(onCreateSplitSession).toHaveBeenCalledWith(undefined)

      fireEvent.click(within(await openPlacements()).getByRole("menuitem", { name: "New chat" }))
      expect(onCreateSession).toHaveBeenCalledWith(undefined)

      // "New quick chat" is deliberately absent: the host's popover-create path
      // is dead for a prop-driven host, and a visible dead verb is worse than a
      // missing one. Nothing can reach onCreatePopoverSession from this menu.
      expect(within(await openPlacements()).queryByRole("menuitem", { name: "New quick chat" })).toBeNull()
      expect(onCreatePopoverSession).not.toHaveBeenCalled()
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
        .toEqual(["New chat", "New in split view"])
    })

    /** A chat that satisfies every eligibility rule the row's verbs are gated on. */
    const renamableSession = {
      id: "alpha-one",
      agentTypeId: "alpha",
      title: "Alpha launch",
      nativeSessionId: "alpha-one",
      hasAssistantReply: true,
      updatedAt: spikeNow - 60_000,
    }
    function renderSpikeRowConsole(overrides: Partial<Parameters<typeof AppLeftPane>[0]> = {}) {
      return renderSpikeConsole({
        projects: [{ id: "launch", name: "Launch", sessions: [renamableSession] }],
        sessions: [renamableSession],
        ...overrides,
      })
    }
    const menuLabels = () =>
      within(screen.getByRole("menu")).getAllByRole("menuitem").map((item) => item.textContent?.trim())

    it("offers the same verbs from the kebab and from a right-click on the row", async () => {
      const user = userEvent.setup()
      renderSpikeRowConsole({
        onRenameSession: vi.fn(),
        onDeleteSession: vi.fn(),
        onOpenSessionDetached: vi.fn(),
      })

      await user.click(screen.getByLabelText("Chat actions for Alpha launch"))
      const fromKebab = menuLabels()
      expect(fromKebab).toEqual([
        "Rename", "Open in split view", "Open as quick chat", "Pin chat", "Copy session ID", "Delete",
      ])
      await user.keyboard("{Escape}")
      await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument())

      fireEvent.contextMenu(spikeRow("Alpha launch"), { clientX: 40, clientY: 80 })
      expect(menuLabels()).toEqual(fromKebab)
    })

    it("keeps the verb list identical on the ACTIVE row, where both menus used to lose the placements", async () => {
      // The live page seeds an active chat, and the first parity test did not:
      // every row it looked at was `state="normal"`, so a rule that dropped the
      // placements on `state !== "normal"` passed the test and shipped a pane
      // whose menu lost two entries on exactly one row. Mount what the host
      // actually mounts — an active session — and assert against THAT row.
      const user = userEvent.setup()
      renderSpikeRowConsole({
        activeSessionRef: { sessionId: "alpha-one", agentTypeId: "alpha" },
        openSessionRefs: [{ sessionId: "alpha-one", agentTypeId: "alpha" }],
        onOpenSessionDetached: vi.fn(),
        onDeleteSession: vi.fn(),
        onRenameSession: vi.fn(),
      })

      const row = spikeRow("Alpha launch")
      expect(row).toHaveAttribute("data-boring-session-state", "active")

      await user.click(screen.getByLabelText("Chat actions for Alpha launch"))
      const fromKebab = menuLabels()
      expect(fromKebab).toContain("Open in split view")
      expect(fromKebab).toContain("Open as quick chat")
      await user.keyboard("{Escape}")
      await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument())

      fireEvent.contextMenu(spikeRow("Alpha launch"), { clientX: 40, clientY: 80 })
      expect(menuLabels()).toEqual(fromKebab)
      // The row shortcut follows the same rule, so the strip does not silently
      // lose an icon on the open chat either.
      expect(screen.getByLabelText("Open Alpha launch in a split pane")).toBeInTheDocument()
    })

    it("fires split and quick chat with the chat's own owner, from the row and from the menu", async () => {
      const user = userEvent.setup()
      const onOpenSessionAsPane = vi.fn()
      const onOpenSessionDetached = vi.fn()
      renderSpikeRowConsole({ onOpenSessionAsPane, onOpenSessionDetached })

      // Split is one of the two verbs that earned a place ON the row.
      await user.click(screen.getByLabelText("Open Alpha launch in a split pane"))
      expect(onOpenSessionAsPane).toHaveBeenCalledWith("alpha-one", "alpha")

      // Quick chat is occasional, so it lives in the menu — and works there.
      fireEvent.contextMenu(spikeRow("Alpha launch"), { clientX: 40, clientY: 80 })
      fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Open as quick chat" }))
      expect(onOpenSessionDetached).toHaveBeenCalledWith("alpha-one", "alpha")
    })

    it("toggles the pin from the menu — never a third row icon — and sorts a pinned chat to the top", async () => {
      const user = userEvent.setup()
      const onToggleSessionPinned = vi.fn()
      const unpinned = { id: "beta-one", agentTypeId: "beta", title: "Beta review", updatedAt: spikeNow - 1_000 }
      const rendered = renderSpikeConsole({
        projects: [{ id: "launch", name: "Launch", sessions: [renamableSession, unpinned] }],
        sessions: [renamableSession, unpinned],
        onToggleSessionPinned,
      })

      // Newest first while nothing is pinned.
      expect(spikeRowIds()).toEqual(["beta-one", "alpha-one"])
      // The row carries exactly two affordances: split, and the menu. Pin is
      // not one of them — three icons cost 40% of a touch row.
      expect(screen.queryByLabelText("Pin Alpha launch")).not.toBeInTheDocument()
      expect([...spikeRow("Alpha launch")
        .querySelectorAll('[data-boring-workspace-part="app-session-actions"] button')]
        .map((button) => button.getAttribute("aria-label"))).toEqual([
        "Open Alpha launch in a split pane",
        "Chat actions for Alpha launch",
      ])

      fireEvent.contextMenu(spikeRow("Alpha launch"), { clientX: 40, clientY: 80 })
      fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Pin chat" }))
      expect(onToggleSessionPinned).toHaveBeenCalledWith("alpha-one", "alpha")

      rendered.unmount()
      renderSpikeConsole({
        projects: [{ id: "launch", name: "Launch", sessions: [renamableSession, unpinned] }],
        sessions: [renamableSession, unpinned],
        pinnedSessionRefs: [{ sessionId: "alpha-one", agentTypeId: "alpha" }],
        onToggleSessionPinned,
      })
      // The older chat now leads the list, and the menu offers the inverse verb.
      expect(spikeRowIds()).toEqual(["alpha-one", "beta-one"])
      fireEvent.contextMenu(spikeRow("Alpha launch"), { clientX: 40, clientY: 80 })
      expect(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Unpin chat" })).toBeInTheDocument()
    })

    it("renames from F2 and from the menu, commits on Enter and reverts on Escape", async () => {
      const user = userEvent.setup()
      const onRenameSession = vi.fn()
      renderSpikeRowConsole({ onRenameSession })
      const row = spikeRow("Alpha launch")

      // Escape puts the original title back and calls nothing.
      fireEvent.keyDown(row, { key: "F2" })
      const cancelled = screen.getByRole("textbox", { name: "Rename session" })
      await user.clear(cancelled)
      await user.type(cancelled, "Discarded{Escape}")
      expect(onRenameSession).not.toHaveBeenCalled()
      expect(screen.getByText("Alpha launch")).toBeInTheDocument()

      // The menu entry opens the same editor, and Enter commits it.
      await user.click(screen.getByLabelText("Chat actions for Alpha launch"))
      fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Rename" }))
      const editing = await screen.findByRole("textbox", { name: "Rename session" })
      await user.clear(editing)
      await user.type(editing, "Launch retro{Enter}")
      expect(onRenameSession).toHaveBeenCalledWith("alpha-one", "Launch retro", "alpha")
    })

    it("holds Delete behind a confirmation, and lets the confirmation be declined", async () => {
      const user = userEvent.setup()
      const onDeleteSession = vi.fn()
      renderSpikeRowConsole({ onDeleteSession })

      const openDelete = async () => {
        fireEvent.contextMenu(spikeRow("Alpha launch"), { clientX: 40, clientY: 80 })
        fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Delete" }))
        return screen.findByRole("alertdialog")
      }

      const declined = await openDelete()
      await user.click(within(declined).getByRole("button", { name: "Cancel" }))
      expect(onDeleteSession).not.toHaveBeenCalled()

      const confirmed = await openDelete()
      await user.click(within(confirmed).getByRole("button", { name: "Delete chat" }))
      expect(onDeleteSession).toHaveBeenCalledWith("alpha-one", "alpha")
    })

    it("gives collapsed headers one badge language in every view: the amber waiting count, never a chat count", async () => {
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
      await chooseSpikeView(user, "By agent")

      // Collapsed Beta: the waiting count, and nothing about inventory.
      const betaHeader = screen.getByRole("button", { name: /Expand Boring Beta/ })
      expect(betaHeader).toHaveAccessibleName("Expand Boring Beta; 1 needs you")
      expect(betaHeader.querySelector('[data-boring-agent-session-count="true"]')).toBeEmptyDOMElement()
      // Collapsed Alpha has nothing waiting, so it says nothing at all — where
      // it used to say "2".
      const alphaHeader = screen.getByRole("button", { name: /Boring Alpha/ })
      expect(alphaHeader.querySelector('[data-boring-agent-session-count="true"]')).toBeEmptyDOMElement()

      // Expanded, the rows carry their own state and the header goes quiet.
      await user.click(betaHeader)
      expect(screen.queryByRole("button", { name: /needs you/ })).not.toBeInTheDocument()

      // The Project view's rollup is the SAME amber, not the shipped accent.
      await chooseSpikeView(user, "By project")
      await user.click(screen.getByRole("button", { name: "Collapse Launch" }))
      const projectRollup = screen.getByTitle("1 session waiting")
      expect(projectRollup).toHaveTextContent("1")
      // One token, one mark: the same --attention colour the Agent card and the
      // Agent card uses, and a dot + number rather than a filled pill.
      expect(projectRollup.className).toContain("var(--attention)")
      expect(projectRollup.className).not.toContain("var(--accent)")
      expect(projectRollup.className).not.toContain("rounded-full px")
      expect(projectRollup.querySelector("span.rounded-full")).not.toBeNull()
    })

    it("spends the row's width on the chat's name first, and drops the tag before the title", async () => {
      // jsdom lays nothing out, so the DOM cannot prove pixel widths. What it
      // CAN prove is the contract the widths come from: the title carries a
      // floor and grows, the tag only shrinks, and the drop rule that removes
      // the tag is expressed against the row rather than guessed per surface.
      renderSpikeConsole()
      const row = spikeRow("Console nav")
      const title = row.querySelector('[data-boring-workspace-part="app-session-title"]')
      const tag = row.querySelector('[data-boring-workspace-part="app-session-meta-tag"]')
      expect(title).toHaveTextContent("Console nav")
      expect(title?.className).toContain("app-left-session-title")
      expect(title?.className).toContain("flex-1")
      expect(tag?.className).toContain("app-left-session-meta-tag")
      // The tag must never grow, or it takes room from the name.
      expect(tag?.className).not.toContain("flex-1")
      // The title comes FIRST, so a shrink-to-fit pass reaches the tag first.
      expect((title?.compareDocumentPosition(tag as Node) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

      const css = await readFile(resolve(process.cwd(), "src/globals.css"), "utf8")
      expect(css).toContain(".app-left-session-title {\n  /* ~14 characters at 13px")
      expect(css).toMatch(/\.app-left-session-title \{[^}]*min-width: 7rem/)
      expect(css).toMatch(/\.app-left-session-meta-tag \{[^}]*flex: 0 1 auto/)
      expect(css).toMatch(/@container app-session-line \(max-width: 340px\) \{\s*\.app-left-session-meta-tag \{\s*display: none/)
      // The container must sit on the LINE: putting it on the row would make
      // the row a containing block and pin every right-click menu to the row.
      expect(css).toMatch(/\.app-left-session-line \{[^}]*container-type: inline-size/)
      expect(css).not.toMatch(/\.app-left-session-row \{[^}]*container-type/)
    })

    it("confirms Delete in a real alert dialog that names and describes itself", async () => {
      const user = userEvent.setup()
      const onDeleteSession = vi.fn()
      renderSpikeRowConsole({ onDeleteSession })

      fireEvent.contextMenu(spikeRow("Alpha launch"), { clientX: 40, clientY: 80 })
      fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Delete" }))
      const dialog = await screen.findByRole("alertdialog")

      expect(dialog).toHaveAccessibleName("Delete this chat?")
      expect(dialog).toHaveAccessibleDescription("“Alpha launch” and its transcript are removed for good.")
      // The second sentence was cut: "removed for good" already says it.
      expect(dialog).not.toHaveTextContent("cannot be undone")
      // Portaled out of the pane, so the scrim can cover the whole viewport.
      expect(dialog.closest('[data-boring-workspace-part="app-left-pane"]')).toBeNull()
      expect(document.querySelector('[data-slot="alert-dialog-overlay"]')).not.toBeNull()
      // The trap opens on the non-destructive choice.
      await waitFor(() => expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus())

      await user.keyboard("{Escape}")
      await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
      expect(onDeleteSession).not.toHaveBeenCalled()
    })


    it("keeps a waiting chat in its own list — the pane has no second inbox", async () => {
      // OWNER RULING: the Inbox tab is the single triage surface. A rail
      // section that promoted waiting chats out of the list was a second
      // inbox competing with it, so the pane now only MARKS them.
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

      expect(spikeRoot().textContent).not.toMatch(/needs you/i)
      expect(spikeRoot().querySelector('[data-boring-workspace-part="console-spike-needs-you"]')).toBeNull()
      // Every chat is in the one list, in plain recency order.
      expect(spikeRowIds()).toEqual(["alpha-one", "alpha-two", "beta-one"])
      expect(screen.getAllByText("Beta review")).toHaveLength(1)
      // The row still carries its amber badge — marking stays, triage moved.
      expect(spikeRow("Beta review").querySelector('[data-boring-workspace-part="app-session-badge"]'))
        .toHaveAttribute("data-boring-badge", "question")
    })

    it("reveals the row's actions without hover on a pointer-coarse device", async () => {
      // jsdom resolves no media queries, so the guarantee is asserted where it
      // actually lives: the stylesheet. The "..." trigger is the only path to
      // rename / pin / copy / delete, so a finger must not need hover for it.
      const css = await readFile(resolve(process.cwd(), "src/globals.css"), "utf8")
      const touchBlock = css.slice(css.indexOf("@media (hover: none), (pointer: coarse)"))
      expect(touchBlock).toContain(".app-left-session-actions {\n    opacity: 1;\n  }")
    })

    it("drops the in-Project \"+\", which duplicated New chat and sat in the rollup's slot", async () => {
      const user = userEvent.setup()
      renderSpikeConsole({ addressedAgentTypeId: "beta" })
      await chooseSpikeView(user, "By project")

      expect(screen.queryByRole("button", { name: "New chat in Agent Console" })).not.toBeInTheDocument()
      // Creating a chat is still one click away, from the control that owns it.
      expect(screen.getByRole("button", { name: "New chat" })).toBeInTheDocument()
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

})

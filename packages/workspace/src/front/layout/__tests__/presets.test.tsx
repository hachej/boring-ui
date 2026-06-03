import { describe, it, expect, vi, beforeEach } from "vitest"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useEffect } from "react"
import userEvent from "@testing-library/user-event"
import { buildIdeLayout } from "../IdeLayout"
import { buildChatLayout } from "../ChatLayout"
import { RegistryProvider } from "../../registry"
import { events, userMeta, workspaceEvents } from "../../events"
import { useCommands } from "../../plugin/useCommands"
import { PanelRegistry } from "../../registry/PanelRegistry"
import { CommandRegistry } from "../../../shared/plugins/CommandRegistry"
import { bindStore } from "../../store/selectors"
import { createWorkspaceStore } from "../../store"
import { WorkspaceProvider, useWorkspaceAttention } from "../../provider"
import type { SurfaceShellApi } from "../../chrome/artifact-surface/SurfaceShell"

// Verify barrel exports work
import {
  IdeLayout,
  ChatLayout,
  TopBar,
  ResponsiveDockviewShell,
  buildIdeLayout as barrelBuildIde,
  buildChatLayout as barrelBuildChat,
} from "../index"

function DummyPanel() {
  return <div data-testid="dummy-panel">panel</div>
}

function StreamingChatPanel() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      const target = e.target instanceof HTMLElement ? e.target : null
      if (target?.closest('[role="dialog"], [role="menu"], [role="listbox"]')) return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener("keydown", onKeyDown, { capture: true })
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true })
  }, [])

  return <div data-boring-agent-part="chat" tabIndex={0}>streaming chat</div>
}

function setup(panels: string[]) {
  const store = createWorkspaceStore({ persistenceEnabled: false })
  bindStore(store)

  const panelRegistry = new PanelRegistry()
  for (const id of panels) {
    panelRegistry.register(id, { title: id, lazy: false, component: DummyPanel })
  }
  const commandRegistry = new CommandRegistry()
  return { panelRegistry, commandRegistry }
}

function renderWithRegistry(
  ui: React.ReactElement,
  panels: string[],
) {
  const { panelRegistry, commandRegistry } = setup(panels)
  return render(
    <WorkspaceProvider persistenceEnabled={false}>
      <RegistryProvider panelRegistry={panelRegistry} commandRegistry={commandRegistry}>
        {ui}
      </RegistryProvider>
    </WorkspaceProvider>,
  )
}

function renderWithPanelRegistry(
  ui: React.ReactElement,
  panels: string[],
) {
  const { panelRegistry, commandRegistry } = setup(panels)
  const result = render(
    <WorkspaceProvider persistenceEnabled={false}>
      <RegistryProvider panelRegistry={panelRegistry} commandRegistry={commandRegistry}>
        {ui}
      </RegistryProvider>
    </WorkspaceProvider>,
  )
  return { ...result, panelRegistry }
}

function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  })
  window.dispatchEvent(new Event("resize"))
}

function fireShortcut(key: string, opts: Partial<KeyboardEventInit> = {}) {
  document.dispatchEvent(new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...opts,
  }))
}

describe("barrel exports", () => {
  it("re-exports all layout symbols", () => {
    expect(IdeLayout).toBeDefined()
    expect(ChatLayout).toBeDefined()
    expect(TopBar).toBeDefined()
    expect(ResponsiveDockviewShell).toBeDefined()
    expect(barrelBuildIde).toBe(buildIdeLayout)
    expect(barrelBuildChat).toBe(buildChatLayout)
  })
})

describe("buildIdeLayout", () => {
  it("builds default config with filetree + empty", () => {
    const config = buildIdeLayout()
    expect(config.version).toBe("2.0")
    expect(config.groups).toHaveLength(2)

    const sidebar = config.groups[0]
    expect(sidebar.id).toBe("sidebar")
    expect(sidebar.position).toBe("left")
    expect(sidebar.panel).toBe("filetree")
    expect(sidebar.locked).toBe(true)
    expect(sidebar.collapsible).toBe(true)
    expect(sidebar.collapsedWidth).toBe(40)
    expect(sidebar.constraints).toEqual({
      minWidth: 200,
      maxWidthViewportRatio: 0.5,
    })

    const center = config.groups[1]
    expect(center.id).toBe("center")
    expect(center.position).toBe("center")
    expect(center.panel).toBe("empty")
    expect(center.dynamic).toBe(true)
    expect(center.placeholder).toBe("empty")
    expect(center.constraints).toEqual({ minWidth: 300 })
  })

  it("applies sidebar override", () => {
    const config = buildIdeLayout({ sidebar: "explorer" })
    expect(config.groups[0].panel).toBe("explorer")
  })

  it("adds right rail group when right is set", () => {
    const config = buildIdeLayout({ right: "agent" })
    expect(config.groups).toHaveLength(3)

    const right = config.groups[2]
    expect(right.id).toBe("right")
    expect(right.position).toBe("right")
    expect(right.panel).toBe("agent")
    expect(right.hideHeader).toBe(true)
    expect(right.constraints).toEqual({ minWidth: 250 })
  })

  it("omits right group when right is undefined", () => {
    const config = buildIdeLayout()
    expect(config.groups.find((g) => g.id === "right")).toBeUndefined()
  })
})

describe("buildChatLayout", () => {
  it("builds default config with nav + center", () => {
    const config = buildChatLayout()
    expect(config.version).toBe("2.0")
    expect(config.groups).toHaveLength(2)

    const nav = config.groups[0]
    expect(nav.id).toBe("nav")
    expect(nav.position).toBe("left")
    expect(nav.panel).toBe("session-list")
    expect(nav.locked).toBe(true)
    expect(nav.hideHeader).toBe(true)
    expect(nav.constraints).toEqual({ minWidth: 60, maxWidth: 60 })

    const center = config.groups[1]
    expect(center.id).toBe("center")
    expect(center.position).toBe("center")
    expect(center.panel).toBe("chat")
    expect(center.hideHeader).toBe(true)
    // Collapse is handled by the live flex ChatLayout component, not dock config.
    expect(center.collapsible).toBeUndefined()
    expect(center.collapsedWidth).toBeUndefined()
  })

  it("passes panel params through to layout groups", () => {
    const config = buildChatLayout({
      navParams: { activeId: "s1" },
      centerParams: { sessionId: "s1" },
      surface: "artifact-surface",
      surfaceParams: { storageKey: "surface" },
    })

    expect(config.groups.find((g) => g.id === "nav")?.params).toEqual({ activeId: "s1" })
    expect(config.groups.find((g) => g.id === "center")?.params).toEqual({ sessionId: "s1" })
    expect(config.groups.find((g) => g.id === "surface")?.params).toEqual({ storageKey: "surface" })
  })

  it("omits nav group when nav is null", () => {
    const config = buildChatLayout({ nav: null })
    expect(config.groups.find((g) => g.id === "nav")).toBeUndefined()
    expect(config.groups.find((g) => g.id === "center")).toBeDefined()
  })

  it("adds sidebar group when sidebar is set", () => {
    const config = buildChatLayout({ sidebar: "filetree" })
    const sidebar = config.groups.find((g) => g.id === "sidebar")
    expect(sidebar).toBeDefined()
    expect(sidebar!.position).toBe("left")
    expect(sidebar!.panel).toBe("filetree")
    expect(sidebar!.hideHeader).toBe(true)
    expect(sidebar!.collapsible).toBe(true)
    expect(sidebar!.collapsedWidth).toBe(40)
    expect(sidebar!.constraints).toEqual({
      minWidth: 200,
      maxWidthViewportRatio: 0.5,
    })
  })

  it("adds surface group when surface is set", () => {
    const config = buildChatLayout({ surface: "artifacts" })
    const surface = config.groups.find((g) => g.id === "surface")
    expect(surface).toBeDefined()
    expect(surface!.position).toBe("right")
    expect(surface!.panel).toBe("artifacts")
    expect(surface!.hideHeader).toBe(true)
    expect(surface!.dynamic).toBe(true)
    expect(surface!.placeholder).toBe("empty")
  })

  it("omits sidebar and surface when not set", () => {
    const config = buildChatLayout()
    expect(config.groups.find((g) => g.id === "sidebar")).toBeUndefined()
    expect(config.groups.find((g) => g.id === "surface")).toBeUndefined()
  })
})

describe("IdeLayout component", () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it("renders DockviewShell", () => {
    const { container } = renderWithRegistry(
      <IdeLayout />,
      ["filetree", "empty"],
    )
    expect(container.querySelector(".dv-shell")).toBeInTheDocument()
  })

  it("passes className", () => {
    const { container } = renderWithRegistry(
      <IdeLayout className="custom-ide" />,
      ["filetree", "empty"],
    )
    expect(container.querySelector(".custom-ide")).toBeInTheDocument()
  })
})

describe("IdeLayout responsive behavior", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    setViewport(1280)
  })

  it("shows mobile hamburger under 768px and opens sheet sidebar", async () => {
    setViewport(375)
    const user = userEvent.setup()

    renderWithRegistry(
      <IdeLayout />,
      ["filetree", "empty"],
    )

    const openButton = screen.getByLabelText("Open sidebar menu")
    expect(openButton).toBeInTheDocument()

    await user.click(openButton)
    expect(await screen.findByText("filetree")).toBeInTheDocument()
  })

  it("updates overlay sidebar components when a panel registers after mount", async () => {
    const user = userEvent.setup()
    setViewport(375)

    const { panelRegistry } = renderWithPanelRegistry(
      <ResponsiveDockviewShell layout={buildIdeLayout()} />,
      ["empty"],
    )

    await user.click(screen.getByLabelText("Open sidebar menu"))
    expect(screen.getByText("Loading sidebar...")).toBeInTheDocument()

    act(() => {
      panelRegistry.register("filetree", { title: "filetree", lazy: false, component: DummyPanel })
    })

    await waitFor(() => {
      expect(screen.getAllByTestId("dummy-panel")).toHaveLength(2)
    })
  })

  it("auto-collapses sidebar rail on tablet and supports pin-open", async () => {
    const user = userEvent.setup()

    setViewport(1280)
    renderWithRegistry(
      <IdeLayout />,
      ["filetree", "empty"],
    )

    await waitFor(() => {
      expect(screen.getAllByTestId("dummy-panel")).toHaveLength(2)
    })

    act(() => {
      setViewport(900)
    })

    await waitFor(() => {
      expect(screen.getByLabelText("Open collapsed sidebar")).toBeInTheDocument()
      expect(screen.getAllByTestId("dummy-panel")).toHaveLength(1)
    })

    await user.click(screen.getByLabelText("Open collapsed sidebar"))
    await user.click(await screen.findByLabelText("Pin sidebar open"))

    await waitFor(() => {
      expect(screen.queryByLabelText("Open collapsed sidebar")).not.toBeInTheDocument()
      expect(screen.getAllByTestId("dummy-panel")).toHaveLength(2)
    })
    expect(screen.getByLabelText("Collapse sidebar")).toBeInTheDocument()
  })

  it("transitions desktop → tablet → mobile → desktop modes", async () => {
    renderWithRegistry(
      <IdeLayout />,
      ["filetree", "empty"],
    )

    expect(screen.queryByLabelText("Open sidebar menu")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("Open collapsed sidebar")).not.toBeInTheDocument()

    act(() => {
      setViewport(900)
    })
    await waitFor(() => {
      expect(screen.getByLabelText("Open collapsed sidebar")).toBeInTheDocument()
    })

    act(() => {
      setViewport(600)
    })
    await waitFor(() => {
      expect(screen.getByLabelText("Open sidebar menu")).toBeInTheDocument()
    })

    act(() => {
      setViewport(1280)
    })
    await waitFor(() => {
      expect(screen.queryByLabelText("Open sidebar menu")).not.toBeInTheDocument()
      expect(screen.queryByLabelText("Open collapsed sidebar")).not.toBeInTheDocument()
    })
  })
})

describe("ChatLayout component", () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it("renders main-style flex chrome", () => {
    const { container } = renderWithRegistry(
      <ChatLayout center="empty" />,
      ["session-list", "empty"],
    )
    expect(container.querySelector("aside")).toBeInTheDocument()
    expect(container.querySelector("main")).toBeInTheDocument()
  })

  it("treats nav={null} as a closed session history drawer", () => {
    renderWithRegistry(
      <ChatLayout center="empty" nav={null} onOpenNav={vi.fn()} />,
      ["session-list", "empty"],
    )

    const sessionBrowser = screen.getByLabelText("Session browser")
    expect(sessionBrowser).toHaveAttribute("aria-hidden", "true")
    expect(sessionBrowser).toHaveStyle({ width: "0px" })
  })

  it("registers workspace-owned layout commands", async () => {
    function Inspector() {
      const commands = useCommands()
      return (
        <div>
          <span data-testid="session-command">{String(commands.some((command) => command.id === "workspace:open-session-history"))}</span>
          <span data-testid="workbench-command">{String(commands.some((command) => command.id === "workspace:open-workbench"))}</span>
          <span data-testid="focus-chat-command">{String(commands.some((command) => command.id === "agent:focus-chat"))}</span>
          <span data-testid="new-agent-command">{String(commands.some((command) => command.id === "agent:new-chat"))}</span>
        </div>
      )
    }

    const createSession = vi.fn()
    renderWithRegistry(
      <>
        <ChatLayout nav={null} navParams={{ onCreate: createSession }} surface="artifact-surface" />
        <Inspector />
      </>,
      ["chat", "artifact-surface"],
    )

    await waitFor(() => {
      expect(screen.getByTestId("session-command").textContent).toBe("true")
      expect(screen.getByTestId("workbench-command").textContent).toBe("true")
      expect(screen.getByTestId("focus-chat-command").textContent).toBe("true")
      expect(screen.getByTestId("new-agent-command").textContent).toBe("true")
    })
  })

  it("keeps workspace layout commands active when panes are already open", async () => {
    const closeNav = vi.fn()
    const closeSurface = vi.fn()
    const createSession = vi.fn()

    function Inspector() {
      const commands = useCommands()
      const activeCommands = commands.filter((command) => command.when?.() ?? true)
      return (
        <div>
          <span data-testid="active-count">{activeCommands.length}</span>
          <span data-testid="session-title">
            {activeCommands.find((command) => command.id === "workspace:open-session-history")?.title}
          </span>
          <span data-testid="workbench-title">
            {activeCommands.find((command) => command.id === "workspace:open-workbench")?.title}
          </span>
          <span data-testid="focus-chat-title">
            {activeCommands.find((command) => command.id === "agent:focus-chat")?.title}
          </span>
          <span data-testid="new-agent-title">
            {activeCommands.find((command) => command.id === "agent:new-chat")?.title}
          </span>
        </div>
      )
    }

    renderWithRegistry(
      <>
        <ChatLayout
          nav="session-list"
          navParams={{ onClose: closeNav, onCreate: createSession }}
          surface="artifact-surface"
          surfaceParams={{ onClose: closeSurface }}
        />
        <Inspector />
      </>,
      ["chat", "session-list", "artifact-surface"],
    )

    await waitFor(() => {
      expect(screen.getByTestId("active-count").textContent).toBe("4")
      expect(screen.getByTestId("session-title").textContent).toBe("Close Session History")
      expect(screen.getByTestId("workbench-title").textContent).toBe("Close Workbench")
      expect(screen.getByTestId("focus-chat-title").textContent).toBe("Focus Chat")
      expect(screen.getByTestId("new-agent-title").textContent).toBe("New Chat")
    })
  })

  it("Focus Chat closes session history and workbench together", async () => {
    const user = userEvent.setup()
    const closeNav = vi.fn()
    const closeSurface = vi.fn()

    function Runner() {
      const commands = useCommands()
      const focusChat = commands.find((command) => command.id === "agent:focus-chat")
      return (
        <button type="button" onClick={() => focusChat?.run()}>
          Run focus
        </button>
      )
    }

    renderWithRegistry(
      <>
        <ChatLayout
          nav="session-list"
          navParams={{ onClose: closeNav }}
          surface="artifact-surface"
          surfaceParams={{ onClose: closeSurface }}
        />
        <Runner />
      </>,
      ["chat", "session-list", "artifact-surface"],
    )

    await user.click(screen.getByRole("button", { name: "Run focus" }))

    expect(closeNav).toHaveBeenCalledOnce()
    expect(closeSurface).toHaveBeenCalledOnce()
  })

  it("keeps the shell keyboard shortcuts from the previous chat shell", () => {
    const closeNav = vi.fn()
    const closeSurface = vi.fn()

    renderWithRegistry(
      <ChatLayout
        nav="session-list"
        navParams={{ onClose: closeNav }}
        surface="artifact-surface"
        surfaceParams={{ onClose: closeSurface }}
      />,
      ["chat", "session-list", "artifact-surface"],
    )

    fireShortcut("1", { metaKey: true })
    fireShortcut("2", { metaKey: true })
    fireShortcut("Escape")

    expect(closeNav).toHaveBeenCalledTimes(2)
    expect(closeSurface).toHaveBeenCalledTimes(2)
  })

  it("lets active chat Escape stop streaming before shell close shortcuts run", () => {
    const closeNav = vi.fn()
    const closeSurface = vi.fn()
    const { panelRegistry, commandRegistry } = setup(["chat", "session-list", "artifact-surface"])
    panelRegistry.register("chat", { title: "chat", lazy: false, component: StreamingChatPanel })

    render(
      <WorkspaceProvider persistenceEnabled={false}>
        <RegistryProvider panelRegistry={panelRegistry} commandRegistry={commandRegistry}>
          <ChatLayout
            nav="session-list"
            navParams={{ onClose: closeNav }}
            surface="artifact-surface"
            surfaceParams={{ onClose: closeSurface }}
          />
        </RegistryProvider>
      </WorkspaceProvider>,
    )

    const root = document.querySelector('[data-boring-agent-part="chat"]')
    expect(root).toBeTruthy()

    act(() => {
      fireEvent.keyDown(root ?? document.body, { key: "Escape", bubbles: true, cancelable: true })
    })

    expect(closeNav).not.toHaveBeenCalled()
    expect(closeSurface).not.toHaveBeenCalled()
  })

  it("opens hidden shell panes with the shell keyboard shortcuts", () => {
    const openNav = vi.fn()
    const openSurface = vi.fn()

    renderWithRegistry(
      <ChatLayout
        nav={null}
        onOpenNav={openNav}
        surface={null}
        onOpenSurface={openSurface}
      />,
      ["chat", "session-list", "artifact-surface"],
    )

    fireShortcut("1", { ctrlKey: true })
    fireShortcut("2", { ctrlKey: true })

    expect(openNav).toHaveBeenCalledOnce()
    expect(openSurface).toHaveBeenCalledOnce()
  })

  it("collapses and re-expands the chat panel with the keyboard shortcut", () => {
    renderWithRegistry(
      <ChatLayout center="chat" storageKey="chat-layout-test" />,
      ["chat", "session-list"],
    )

    const chatPanel = screen.getByLabelText("Chat")
    expect(chatPanel).toHaveAttribute("data-boring-state", "expanded")

    act(() => fireShortcut("\\", { metaKey: true }))
    expect(screen.getByLabelText("Collapsed chat")).toHaveAttribute("data-boring-state", "collapsed")

    act(() => fireShortcut("\\", { metaKey: true }))
    expect(screen.getByLabelText("Chat")).toHaveAttribute("data-boring-state", "expanded")
  })

  it("collapses the chat to zero width and shows a floating expand button", () => {
    renderWithRegistry(
      <ChatLayout center="chat" storageKey="chat-layout-rail" />,
      ["chat", "session-list"],
    )

    expect(screen.queryByRole("button", { name: "Expand chat" })).not.toBeInTheDocument()

    act(() => fireShortcut("\\", { metaKey: true }))

    // The chat panel collapses to zero width (no 40px rail) ...
    const collapsed = screen.getByLabelText("Collapsed chat")
    expect(collapsed).toHaveAttribute("data-boring-state", "collapsed")
    expect(collapsed).toHaveAttribute("aria-hidden", "true")
    // ... and re-opening is a floating left-edge button.
    expect(screen.getByRole("button", { name: "Expand chat" })).toBeInTheDocument()

    act(() => fireShortcut("\\", { metaKey: true }))
    expect(screen.queryByRole("button", { name: "Expand chat" })).not.toBeInTheDocument()
    expect(screen.getByLabelText("Chat")).toHaveAttribute("data-boring-state", "expanded")
  })

  it("stacks the floating expand-chat button above the sessions button on the left edge", () => {
    renderWithRegistry(
      <ChatLayout center="chat" nav={null} onOpenNav={vi.fn()} storageKey="chat-layout-stack" />,
      ["chat", "session-list"],
    )

    act(() => fireShortcut("\\", { metaKey: true }))

    const sessionsButton = screen.getByRole("button", { name: "Sessions" })
    const chatButton = screen.getByRole("button", { name: "Expand chat" })
    // Both anchor to the left edge and are vertically offset so they never overlap.
    expect(sessionsButton.className).toContain("left-2")
    expect(chatButton.className).toContain("left-2")
    expect(sessionsButton.style.transform).toContain("translateY(calc(-50% - 0px))")
    expect(chatButton.style.transform).toContain("translateY(calc(-50% - 44px))")
  })

  it("auto-expands the chat panel when a blocker appears while collapsed", async () => {
    function Host() {
      const { addBlocker } = useWorkspaceAttention()
      return (
        <>
          <ChatLayout center="chat" storageKey="chat-layout-blocker" />
          <button
            type="button"
            onClick={() => addBlocker({ id: "b1", reason: "Approve", label: "Approve" })}
          >
            Add blocker
          </button>
        </>
      )
    }

    const user = userEvent.setup()
    renderWithRegistry(<Host />, ["chat", "session-list"])

    act(() => fireShortcut("\\", { metaKey: true }))
    expect(screen.getByLabelText("Collapsed chat")).toHaveAttribute("data-boring-state", "collapsed")

    await user.click(screen.getByRole("button", { name: "Add blocker" }))
    await waitFor(() =>
      expect(screen.getByLabelText("Chat")).toHaveAttribute("data-boring-state", "expanded"),
    )
  })

  it("dispatches plugin UI commands through the workbench contract", () => {
    const openFile = vi.fn()
    const surface: SurfaceShellApi = {
      openFile,
      openSurface: vi.fn(),
      openPanel: vi.fn(),
      closeWorkbenchLeftPane: vi.fn(),
      expandToFile: vi.fn(),
      getSnapshot: () => ({ openTabs: [], activeTab: null }),
    }

    renderWithRegistry(
      <ChatLayout
        center="chat"
        centerParams={{
          getSurface: () => surface,
          isWorkbenchOpen: () => true,
          openWorkbench: vi.fn(),
        }}
      />,
      ["chat", "session-list"],
    )

    act(() => {
      events.emit(workspaceEvents.uiCommand, {
        ...userMeta(),
        command: { kind: "openFile", params: { path: "src/App.tsx" } },
      })
    })

    expect(openFile).toHaveBeenCalledWith("src/App.tsx")
  })

  it("updates panel slots when a panel registers after mount", async () => {
    const { panelRegistry } = renderWithPanelRegistry(
      <ChatLayout center="late-panel" />,
      ["session-list"],
    )

    expect(screen.getAllByTestId("dummy-panel")).toHaveLength(1)

    act(() => {
      panelRegistry.register("late-panel", { title: "Late Panel", lazy: false, component: DummyPanel })
    })

    await waitFor(() => {
      expect(screen.getAllByTestId("dummy-panel")).toHaveLength(2)
    })
  })

  it("passes className", () => {
    const { container } = renderWithRegistry(
      <ChatLayout className="custom-chat" />,
      ["session-list", "chat"],
    )
    expect(container.querySelector(".custom-chat")).toBeInTheDocument()
  })
})

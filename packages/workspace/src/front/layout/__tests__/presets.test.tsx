import { describe, it, expect, vi, beforeEach } from "vitest"
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { buildIdeLayout } from "../IdeLayout"
import { buildChatLayout } from "../ChatLayout"
import { RegistryProvider } from "../../registry"
import { PanelRegistry } from "../../registry/PanelRegistry"
import { CommandRegistry } from "../../registry/CommandRegistry"
import { bindStore } from "../../store/selectors"
import { createWorkspaceStore } from "../../store"

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

function setup(panels: string[]) {
  const store = createWorkspaceStore({ persistenceEnabled: false })
  bindStore(store)

  const panelRegistry = new PanelRegistry()
  for (const id of panels) {
    panelRegistry.register(id, { title: id, component: DummyPanel })
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
    <RegistryProvider panelRegistry={panelRegistry} commandRegistry={commandRegistry}>
      {ui}
    </RegistryProvider>,
  )
}

function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  })
  window.dispatchEvent(new Event("resize"))
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

  it("adds sidebar group when sidebar is set", () => {
    const config = buildChatLayout({ sidebar: "filetree" })
    const sidebar = config.groups.find((g) => g.id === "sidebar")
    expect(sidebar).toBeDefined()
    expect(sidebar!.position).toBe("left")
    expect(sidebar!.panel).toBe("filetree")
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

  it("renders DockviewShell", () => {
    const { container } = renderWithRegistry(
      <ChatLayout />,
      ["session-list", "chat"],
    )
    expect(container.querySelector(".dv-shell")).toBeInTheDocument()
  })

  it("passes className", () => {
    const { container } = renderWithRegistry(
      <ChatLayout className="custom-chat" />,
      ["session-list", "chat"],
    )
    expect(container.querySelector(".custom-chat")).toBeInTheDocument()
  })
})

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render } from "@testing-library/react"
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
  buildIdeLayout as barrelBuildIde,
  buildChatLayout as barrelBuildChat,
} from "../index"

function DummyPanel() {
  return <div>panel</div>
}

function setup(panels: string[]) {
  const store = createWorkspaceStore()
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

describe("barrel exports", () => {
  it("re-exports all layout symbols", () => {
    expect(IdeLayout).toBeDefined()
    expect(ChatLayout).toBeDefined()
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
    expect(sidebar.collapsedWidth).toBe(0)
    expect(sidebar.constraints).toEqual({ minWidth: 200, maxWidth: 400 })

    const center = config.groups[1]
    expect(center.id).toBe("center")
    expect(center.position).toBe("center")
    expect(center.panel).toBe("empty")
    expect(center.dynamic).toBe(true)
    expect(center.placeholder).toBe("empty")
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
    expect(right.constraints).toEqual({ minWidth: 300 })
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

  it("adds sidebar group when sidebar is set", () => {
    const config = buildChatLayout({ sidebar: "filetree" })
    const sidebar = config.groups.find((g) => g.id === "sidebar")
    expect(sidebar).toBeDefined()
    expect(sidebar!.position).toBe("left")
    expect(sidebar!.panel).toBe("filetree")
    expect(sidebar!.collapsible).toBe(true)
    expect(sidebar!.collapsedWidth).toBe(0)
    expect(sidebar!.constraints).toEqual({ minWidth: 200, maxWidth: 350 })
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

import { act, render, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  bootstrap,
  CatalogRegistry,
  CommandRegistry,
  PanelRegistry,
  RegistryProvider,
  SurfaceResolverRegistry,
  WORKSPACE_OPEN_PATH_SURFACE_KIND,
} from "@hachej/boring-workspace"
import { captureFrontPlugin } from "@hachej/boring-workspace/plugin"
import {
  SurfaceShell,
  type SurfaceShellApi,
} from "../../../../../packages/workspace/src/front/chrome/artifact-surface/SurfaceShell"
import deckPlugin, { createDeckPlugin } from "../index"

const DummyChatPanel = () => null

let mockAddPanel = vi.fn()
let mockGetPanel: (id: string) => unknown = vi.fn(() => undefined)

vi.mock("../../../../../packages/workspace/src/front/chrome/workbench-left/WorkbenchLeftPane", () => ({
  WorkbenchLeftPane: () => <div data-testid="mock-left-pane" />,
}))

vi.mock("../../../../../packages/workspace/src/front/chrome/artifact-surface/ArtifactSurfacePane", async () => {
  const React = await import("react")

  function MockArtifactSurfacePane(props: { onReady?: (api: unknown) => void }) {
    React.useEffect(() => {
      const panels: Array<{ id: string }> = []
      props.onReady?.({
        panels,
        activePanel: null,
        getPanel: (id: string) => mockGetPanel(id) ?? panels.find((panel) => panel.id === id),
        addPanel: (config: { id: string }) => {
          mockAddPanel(config)
          panels.push(config)
        },
        onDidAddPanel: vi.fn(() => ({ dispose: vi.fn() })),
        onDidRemovePanel: vi.fn(() => ({ dispose: vi.fn() })),
        onDidActivePanelChange: vi.fn(() => ({ dispose: vi.fn() })),
      })
    }, [props.onReady])

    return <div data-testid="mock-artifact-surface" />
  }

  MockArtifactSurfacePane.defaultAllowedPanels = [] as string[]

  return { ArtifactSurfacePane: MockArtifactSurfacePane }
})

function makeRegistries() {
  return {
    panels: new PanelRegistry(),
    commands: new CommandRegistry(),
    catalogs: new CatalogRegistry({ warnOnDuplicate: false }),
    surfaceResolvers: new SurfaceResolverRegistry(),
  }
}

describe("deck scaffold", () => {
  beforeEach(() => {
    mockAddPanel = vi.fn()
    mockGetPanel = vi.fn(() => undefined)
    localStorage.clear()
  })

  it("exports a default front plugin factory", () => {
    expect(deckPlugin.pluginId).toBe("deck")
  })

  it("captures the default provider, panel, and resolver scaffold", () => {
    const captured = captureFrontPlugin(createDeckPlugin())
    expect(captured.id).toBe("deck")
    expect(captured.registrations.providers).toHaveLength(1)
    expect(captured.registrations.providers[0]?.id).toBe("deck-files")
    expect(captured.registrations.panels).toHaveLength(1)
    expect(captured.registrations.panels[0]).toEqual(
      expect.objectContaining({ id: "deck", label: "Deck", placement: "center", source: "app", supportsFullPage: true }),
    )
    expect(captured.registrations.surfaceResolvers).toHaveLength(1)
    expect(captured.registrations.surfaceResolvers[0]).toEqual(
      expect.objectContaining({ id: "deck.open-path", kind: "workspace.open.path", source: "app" }),
    )
  })

  it("normalizes configured path prefixes like workspace.open.path targets", () => {
    const captured = captureFrontPlugin(createDeckPlugin({ pathPrefix: " ./briefings// " }))
    const resolver = captured.registrations.surfaceResolvers[0]
    if (!resolver) throw new Error("expected deck resolver")

    expect(resolver.resolve({ kind: "workspace.open.path", target: "briefings/intro.md" })).toEqual(
      expect.objectContaining({
        component: "deck",
        title: "intro.md",
        params: { path: "briefings/intro.md" },
      }),
    )
  })

  it("ignores non-markdown and out-of-prefix requests", () => {
    const captured = captureFrontPlugin(createDeckPlugin({ pathPrefix: "slides" }))
    const resolver = captured.registrations.surfaceResolvers[0]
    if (!resolver) throw new Error("expected deck resolver")

    expect(resolver.resolve({ kind: "workspace.open.path", target: "deck/intro.md" })).toBeNull()
    expect(resolver.resolve({ kind: "workspace.open.path", target: "slides/intro.txt" })).toBeNull()
    expect(resolver.resolve({ kind: "other.kind", target: "slides/intro.md" })).toBeNull()
  })

  it("opens the deck panel through SurfaceShell workspace.open.path flow", async () => {
    const registries = makeRegistries()
    let surface: SurfaceShellApi | undefined

    bootstrap({
      chatPanel: DummyChatPanel,
      defaults: [],
      plugins: [createDeckPlugin({ pathPrefix: "./briefings//" })],
      registries,
    })

    expect(registries.panels.get("deck")).toEqual(
      expect.objectContaining({ id: "deck", title: "Deck", pluginId: "deck" }),
    )

    render(
      <RegistryProvider
        panelRegistry={registries.panels}
        commandRegistry={registries.commands}
        catalogRegistry={registries.catalogs}
        surfaceResolverRegistry={registries.surfaceResolvers}
      >
        <SurfaceShell storageKey="deck-test" onReady={(api) => { surface = api }} />
      </RegistryProvider>,
    )

    await waitFor(() => expect(surface).toBeDefined())

    act(() => {
      surface?.openSurface({
        kind: WORKSPACE_OPEN_PATH_SURFACE_KIND,
        target: "./briefings//weekly.md",
      })
    })

    expect(mockAddPanel).toHaveBeenCalledWith(expect.objectContaining({
      id: "file:user:briefings/weekly.md",
      component: "deck",
      title: "weekly.md",
      params: expect.objectContaining({ filesystem: "user", path: "briefings/weekly.md" }),
    }))
  })
})

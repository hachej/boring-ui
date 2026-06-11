import React, { useSyncExternalStore } from "react"
import { act, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { RegistryProvider, useCatalogRegistry, useCommandRegistry, useRegistry, useSurfaceResolverRegistry } from "../../registry/RegistryProvider"
import { PanelRegistry } from "../../registry/PanelRegistry"
import { CommandRegistry } from "../../../shared/plugins/CommandRegistry"
import { SurfaceResolverRegistry } from "../../../shared/plugins/SurfaceResolverRegistry"
import { definePlugin, type BoringFrontFactoryWithId, type BoringFrontSetup } from "../../../shared/plugins/frontFactory"
import { appendFrontImportRevision, useAgentPluginHotReload } from "../registerAgentPlugin"
import { WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT } from "../reloadEvent"

class MockEventSource {
  static instances: MockEventSource[] = []
  readonly url: string
  readonly withCredentials: boolean | undefined
  closed = false
  private listeners = new Map<string, Set<(event: MessageEvent) => void>>()

  constructor(url: string, init?: EventSourceInit) {
    this.url = url
    this.withCredentials = init?.withCredentials
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener as (event: MessageEvent) => void)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener as (event: MessageEvent) => void)
  }

  close(): void {
    this.closed = true
  }

  dispatch(type: string, data: unknown): void {
    this.dispatchRaw(type, JSON.stringify(data))
  }

  dispatchRaw(type: string, data: string): void {
    const event = { data } as MessageEvent
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

const tempDirs: string[] = []
const originalEventSource = globalThis.EventSource

beforeEach(() => {
  MockEventSource.instances = []
  ;(globalThis as { EventSource?: typeof EventSource }).EventSource = MockEventSource as unknown as typeof EventSource
})

afterEach(async () => {
  ;(globalThis as { EventSource?: typeof EventSource }).EventSource = originalEventSource
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeTempDir(prefix: string): Promise<string> {
  const root = join(process.cwd(), ".tmp-test-plugins")
  await mkdir(root, { recursive: true })
  const dir = await mkdtemp(join(root, prefix))
  tempDirs.push(dir)
  return dir
}

async function writeFrontModule(path: string, text: string): Promise<void> {
  await writeFile(
    path,
    `
// HOT_TEXT:${text}
import React from "react"
export default function hotPlugin(api) {
  api.registerPanel({
    id: "hot-pane",
    label: "Hot Pane",
    component: function HotPane() {
      return React.createElement("div", { "data-testid": "hot-pane" }, ${JSON.stringify(text)})
    },
  })
}
`,
    "utf8",
  )
  const now = new Date(Date.now() + 1_000)
  await utimes(path, now, now)
}

function hotPlugin(id: string, setup: BoringFrontSetup): BoringFrontFactoryWithId {
  return definePlugin({ id, setup })
}

async function importFrontFromDisk(frontUrl: string): Promise<{ default: BoringFrontFactoryWithId }> {
  const filePath = frontUrl.replace(/^.*\/@fs\//, "/")
  const source = await readFile(filePath, "utf8")
  const match = source.match(/HOT_TEXT:([^\n]+)/)
  const text = match?.[1]?.trim() ?? "missing"
  return {
    default: hotPlugin("hot-plugin", (api) => {
      api.registerPanel({
        id: "hot-pane",
        label: "Hot Pane",
        component: function HotPane() {
          return React.createElement("div", { "data-testid": "hot-pane" }, text)
        },
      })
    }),
  }
}

function AgentPluginListener({ apiBaseUrl = "" }: { apiBaseUrl?: string }) {
  useAgentPluginHotReload({ apiBaseUrl, workspaceId: "test-workspace", importFront: importFrontFromDisk })
  return null
}

function PaneRenderer({ id }: { id: string }) {
  const registry = useRegistry()
  useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot)
  const panel = registry.get(id)
  if (!panel) return <div data-testid="pane-missing">missing</div>
  const Component = panel.component as React.ComponentType
  return <Component />
}

function PanelIds() {
  const registry = useRegistry()
  const panels = useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot)
  return <div data-testid="panel-ids">{panels.map((panel) => panel.id).join(",")}</div>
}

function AllPanelIds() {
  const registry = useRegistry()
  useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot)
  return <div data-testid="all-panel-ids">{registry.listAll().map((panel) => panel.id).join(",")}</div>
}

function CommandList() {
  const registry = useCommandRegistry()
  const commands = useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot)
  return <div data-testid="command-list">{commands.map((command) => `${command.id}:${command.title}`).join(",")}</div>
}

function CatalogList() {
  const registry = useCatalogRegistry()
  const catalogs = useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot)
  return <div data-testid="catalog-list">{catalogs.map((catalog) => `${catalog.id}:${catalog.label}`).join(",")}</div>
}

function ResolverIds() {
  const registry = useSurfaceResolverRegistry()
  useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot)
  return <div data-testid="resolver-ids">{registry.list().map((resolver) => resolver.id).join(",")}</div>
}

function Harness({ apiBaseUrl = "" }: { apiBaseUrl?: string }) {
  const panelRegistry = React.useMemo(() => new PanelRegistry(), [])
  const commandRegistry = React.useMemo(() => new CommandRegistry(), [])
  const surfaceResolverRegistry = React.useMemo(() => new SurfaceResolverRegistry(), [])
  return (
    <RegistryProvider
      panelRegistry={panelRegistry}
      commandRegistry={commandRegistry}
      surfaceResolverRegistry={surfaceResolverRegistry}
    >
      <AgentPluginListener apiBaseUrl={apiBaseUrl} />
      <PaneRenderer id="hot-pane" />
    </RegistryProvider>
  )
}

describe("appendFrontImportRevision", () => {
  test("cache-busts dynamic imports with plugin revision", () => {
    expect(appendFrontImportRevision("/@fs/plugin/front/index.tsx", 2)).toBe("/@fs/plugin/front/index.tsx?v=2")
    expect(appendFrontImportRevision("/@fs/plugin/front/index.tsx?raw", 3)).toBe("/@fs/plugin/front/index.tsx?raw&v=3")
    expect(appendFrontImportRevision("/@fs/plugin/front/index.tsx", 4, "boot-1")).toBe("/@fs/plugin/front/index.tsx?v=4&t=boot-1")
  })
})

describe("useAgentPluginHotReload", () => {
  test("imports plugin front modules from SSE load events and remounts updated panes by revision", async () => {
    const dir = await makeTempDir("boring-front-hot-reload-")
    const frontPath = join(dir, "front.mjs")
    await writeFrontModule(frontPath, "version one")
    const frontUrl = `/@fs/${frontPath}`

    render(<Harness apiBaseUrl="/agent" />)

    expect(MockEventSource.instances).toHaveLength(1)
    expect(MockEventSource.instances[0].url).toBe("/agent/api/v1/agent-plugins/events?workspaceId=test-workspace")
    expect(MockEventSource.instances[0].withCredentials).toBe(true)
    expect(screen.getByTestId("pane-missing")).toHaveTextContent("missing")

    MockEventSource.instances[0].dispatch("boring.plugin.load", {
      type: "boring.plugin.load",
      id: "hot-plugin",
      version: "1.0.0",
      revision: 1,
      frontUrl,
      boring: { front: "./front.mjs" },
    })

    await waitFor(() => expect(screen.getByTestId("hot-pane")).toHaveTextContent("version one"))

    await new Promise((resolve) => setTimeout(resolve, 25))
    await writeFrontModule(frontPath, "version two")
    MockEventSource.instances[0].dispatch("boring.plugin.load", {
      type: "boring.plugin.load",
      id: "hot-plugin",
      version: "1.0.0",
      revision: 2,
      frontUrl,
      boring: { front: "./front.mjs" },
    })

    await waitFor(() => expect(screen.getByTestId("hot-pane")).toHaveTextContent("version two"))

    MockEventSource.instances[0].dispatch("boring.plugin.load", {
      type: "boring.plugin.load",
      id: "hot-plugin",
      version: "1.0.0",
      revision: 1,
      frontUrl,
      boring: { front: "./front.mjs" },
    })

    expect(screen.getByTestId("hot-pane")).toHaveTextContent("version two")
  })

  test("command-originated /reload reconnects and re-imports replayed same-revision plugins without lifecycle loops", async () => {
    let text = "version one"
    const importFront = vi.fn(async (): Promise<{ default: BoringFrontFactoryWithId }> => ({
      default: hotPlugin("hot-plugin", (api) => {
        api.registerPanel({
          id: "hot-pane",
          label: "Hot Pane",
          component: function HotPane() {
            return React.createElement("div", { "data-testid": "hot-pane" }, text)
          },
        })
      }),
    }))

    function ReloadHarness() {
      const panelRegistry = React.useMemo(() => new PanelRegistry(), [])
      const commandRegistry = React.useMemo(() => new CommandRegistry(), [])
      const surfaceResolverRegistry = React.useMemo(() => new SurfaceResolverRegistry(), [])
      function Listener() {
        useAgentPluginHotReload({ workspaceId: "test-workspace", importFront })
        return null
      }
      return (
        <RegistryProvider panelRegistry={panelRegistry} commandRegistry={commandRegistry} surfaceResolverRegistry={surfaceResolverRegistry}>
          <Listener />
          <PaneRenderer id="hot-pane" />
        </RegistryProvider>
      )
    }

    render(<ReloadHarness />)
    MockEventSource.instances[0].dispatch("boring.plugin.load", {
      type: "boring.plugin.load",
      id: "hot-plugin",
      version: "1.0.0",
      revision: 1,
      workspaceId: "test-workspace",
      frontUrl: "/@fs/front.mjs",
      boring: { front: "./front.mjs" },
    })
    await waitFor(() => expect(screen.getByTestId("hot-pane")).toHaveTextContent("version one"))
    expect(importFront).toHaveBeenCalledTimes(1)

    text = "version two"
    window.dispatchEvent(new CustomEvent(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, { detail: { reloaded: true } }))
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(2))
    expect(MockEventSource.instances[0].closed).toBe(true)

    MockEventSource.instances[1].dispatch("boring.plugin.load", {
      type: "boring.plugin.load",
      id: "hot-plugin",
      version: "1.0.0",
      revision: 1,
      workspaceId: "test-workspace",
      replay: true,
      frontUrl: "/@fs/front.mjs",
      boring: { front: "./front.mjs" },
    })
    await waitFor(() => expect(screen.getByTestId("hot-pane")).toHaveTextContent("version two"))
    expect(importFront).toHaveBeenCalledTimes(2)

    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(MockEventSource.instances).toHaveLength(2)
  })

  test("prefers frontTarget.entryUrl over legacy frontUrl payloads", async () => {
    const importFront = vi.fn(async () => ({
      default: hotPlugin("hot-plugin", (api) => {
        api.registerPanel({
          id: "hot-pane",
          label: "Hot Pane",
          component: function HotPane() {
            return React.createElement("div", { "data-testid": "hot-pane" }, "front target")
          },
        })
      }),
    }))

    function FrontTargetHarness() {
      const panelRegistry = React.useMemo(() => new PanelRegistry(), [])
      const commandRegistry = React.useMemo(() => new CommandRegistry(), [])
      const surfaceResolverRegistry = React.useMemo(() => new SurfaceResolverRegistry(), [])
      function Listener() {
        useAgentPluginHotReload({ workspaceId: "test-workspace", importFront })
        return null
      }
      return (
        <RegistryProvider panelRegistry={panelRegistry} commandRegistry={commandRegistry} surfaceResolverRegistry={surfaceResolverRegistry}>
          <Listener />
          <PaneRenderer id="hot-pane" />
        </RegistryProvider>
      )
    }

    render(<FrontTargetHarness />)
    MockEventSource.instances[0].dispatch("boring.plugin.load", {
      type: "boring.plugin.load",
      id: "hot-plugin",
      version: "1.0.0",
      revision: 1,
      frontUrl: "/@fs/legacy-front.mjs",
      frontTarget: { kind: "native", entryUrl: "/runtime/front-target.mjs", revision: 1, trust: "local-trusted-native" },
      boring: { front: "./front.mjs" },
    })

    await waitFor(() => expect(screen.getByTestId("hot-pane")).toHaveTextContent("front target"))
    expect(importFront).toHaveBeenCalledWith("/runtime/front-target.mjs", 1)
  })

  test("ignores plugin events for the wrong workspace and dispatches replay-complete for the active one", async () => {
    const replayEvents: Array<{ type?: string; workspaceId?: string }> = []
    const listener = (event: Event) => replayEvents.push((event as CustomEvent<{ type?: string; workspaceId?: string }>).detail)
    window.addEventListener(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, listener)

    function WorkspaceScopedHarness() {
      const panelRegistry = React.useMemo(() => new PanelRegistry(), [])
      const commandRegistry = React.useMemo(() => new CommandRegistry(), [])
      const surfaceResolverRegistry = React.useMemo(() => new SurfaceResolverRegistry(), [])
      function Listener() {
        useAgentPluginHotReload({ workspaceId: "active-workspace", importFront: importFrontFromDisk })
        return null
      }
      return (
        <RegistryProvider panelRegistry={panelRegistry} commandRegistry={commandRegistry} surfaceResolverRegistry={surfaceResolverRegistry}>
          <Listener />
          <PaneRenderer id="hot-pane" />
        </RegistryProvider>
      )
    }

    try {
      render(<WorkspaceScopedHarness />)
      MockEventSource.instances[0].dispatch("boring.plugin.load", {
        type: "boring.plugin.load",
        id: "hot-plugin",
        version: "1.0.0",
        revision: 1,
        workspaceId: "other-workspace",
        frontTarget: { kind: "native", entryUrl: "/runtime/ignored.mjs", revision: 1, trust: "local-trusted-native" },
        boring: { front: "./front.mjs" },
      })
      await new Promise((resolve) => setTimeout(resolve, 25))
      expect(screen.getByTestId("pane-missing")).toHaveTextContent("missing")

      MockEventSource.instances[0].dispatch("boring.plugin.replay-complete", {
        type: "boring.plugin.replay-complete",
        workspaceId: "active-workspace",
        replay: true,
      })
      await waitFor(() => expect(replayEvents).toContainEqual(expect.objectContaining({ type: "boring.plugin.replay-complete", workspaceId: "active-workspace" })))
    } finally {
      window.removeEventListener(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, listener)
    }
  })

  test("rejects hot-loaded plugin output that collides with a built-in panel id", async () => {
    const browserEvents: Array<Record<string, unknown>> = []
    const listener = (event: Event) => browserEvents.push((event as CustomEvent<Record<string, unknown>>).detail)
    window.addEventListener(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, listener)
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    const importFront = async (): Promise<{ default: BoringFrontFactoryWithId }> => ({
      default: hotPlugin("csv-plugin", (api) => {
        api.registerPanel({
          id: "csv-viewer",
          label: "Hot CSV Viewer",
          component: function HotCsvViewer() {
            return React.createElement("div", { "data-testid": "hot-csv-viewer" }, "hot csv viewer")
          },
        })
      }),
    })

    function CollisionHarness() {
      const panelRegistry = React.useMemo(() => {
        const registry = new PanelRegistry()
        registry.register("csv-viewer", {
          title: "Built-in CSV Viewer",
          component: function BuiltinCsvViewer() {
            return React.createElement("div", { "data-testid": "builtin-csv-viewer" }, "builtin csv viewer")
          },
        })
        return registry
      }, [])
      const commandRegistry = React.useMemo(() => new CommandRegistry(), [])
      const surfaceResolverRegistry = React.useMemo(() => new SurfaceResolverRegistry(), [])
      function Listener() {
        useAgentPluginHotReload({ workspaceId: "test-workspace", importFront })
        return null
      }
      return (
        <RegistryProvider panelRegistry={panelRegistry} commandRegistry={commandRegistry} surfaceResolverRegistry={surfaceResolverRegistry}>
          <Listener />
          <PaneRenderer id="csv-viewer" />
          <PanelIds />
        </RegistryProvider>
      )
    }

    try {
      render(<CollisionHarness />)
      expect(screen.getByTestId("builtin-csv-viewer")).toHaveTextContent("builtin csv viewer")
      expect(screen.getByTestId("panel-ids")).toHaveTextContent("csv-viewer")

      MockEventSource.instances[0].dispatch("boring.plugin.load", {
        type: "boring.plugin.load",
        id: "csv-plugin",
        version: "1.0.0",
        revision: 1,
        frontUrl: "/@fs/csv-plugin.tsx",
        boring: { front: "front/index.tsx" },
      })

      await waitFor(() => {
        expect(consoleError.mock.calls.some((call) => call.some((part) => String(part).includes("PLUGIN_OUTPUT_ID_COLLISION")))).toBe(true)
      })
      expect(consoleError.mock.calls.some((call) => call.some((part) => String(part).includes('plugin "csv-plugin"')))).toBe(true)
      expect(consoleError.mock.calls.some((call) => call.some((part) => String(part).includes('panel "csv-viewer"')))).toBe(true)
      expect(consoleError.mock.calls.some((call) => call.some((part) => String(part).includes('"system/builtin"')))).toBe(true)
      expect(browserEvents).toContainEqual(expect.objectContaining({
        type: "boring.plugin.front-error",
        id: "csv-plugin",
        revision: 1,
        code: "PLUGIN_LOAD_FAILED",
        stage: "register",
      }))
      expect(screen.getByTestId("builtin-csv-viewer")).toHaveTextContent("builtin csv viewer")
      expect(screen.queryByTestId("hot-csv-viewer")).not.toBeInTheDocument()
      expect(screen.getByTestId("panel-ids")).toHaveTextContent("csv-viewer")
    } finally {
      consoleError.mockRestore()
      window.removeEventListener(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, listener)
    }
  })

  test("supports hook-based panel components from hot-loaded front factories", async () => {
    const importFront = async (): Promise<{ default: BoringFrontFactoryWithId }> => ({
      default: hotPlugin("hot-plugin", (api) => {
        api.registerPanel({
          id: "hot-pane",
          label: "Hot Pane",
          component: function HookPane() {
            const [count, setCount] = React.useState(0)
            const [ready, setReady] = React.useState(false)
            React.useEffect(() => {
              setReady(true)
            }, [])
            return React.createElement(
              "button",
              { "data-testid": "hook-pane", onClick: () => setCount((value) => value + 1) },
              `${ready ? "ready" : "loading"}:${count}`,
            )
          },
        })
      }),
    })

    function Listener() {
      useAgentPluginHotReload({ workspaceId: "test-workspace", importFront })
      return null
    }

    render(
      <RegistryProvider
        panelRegistry={new PanelRegistry()}
        commandRegistry={new CommandRegistry()}
        surfaceResolverRegistry={new SurfaceResolverRegistry()}
      >
        <Listener />
        <PaneRenderer id="hot-pane" />
      </RegistryProvider>,
    )

    MockEventSource.instances[0].dispatch("boring.plugin.load", {
      type: "boring.plugin.load",
      id: "hot-plugin",
      version: "1.0.0",
      revision: 1,
      frontUrl: "/@fs/hook-front.tsx",
      boring: { front: "front/index.tsx" },
    })

    await waitFor(() => expect(screen.getByTestId("hook-pane")).toHaveTextContent("ready:0"))
    screen.getByTestId("hook-pane").click()
    await waitFor(() => expect(screen.getByTestId("hook-pane")).toHaveTextContent("ready:1"))
  })

  test("resolves relative front module URLs through apiBaseUrl", async () => {
    const importedUrls: string[] = []
    function Listener() {
      useAgentPluginHotReload({
        apiBaseUrl: "/agent",
        workspaceId: "test-workspace",
        importFront: async (url) => {
          importedUrls.push(url)
          return { default: hotPlugin("hot-plugin", () => undefined) }
        },
      })
      return null
    }
    render(
      <RegistryProvider
        panelRegistry={new PanelRegistry()}
        commandRegistry={new CommandRegistry()}
        surfaceResolverRegistry={new SurfaceResolverRegistry()}
      >
        <Listener />
      </RegistryProvider>,
    )

    MockEventSource.instances[0].dispatch("boring.plugin.load", {
      type: "boring.plugin.load",
      id: "hot-plugin",
      version: "1.0.0",
      revision: 1,
      frontUrl: "/@fs/front.mjs",
      boring: { front: "./front.mjs" },
    })

    await waitFor(() => expect(importedUrls).toEqual(["/agent/@fs/front.mjs"]))
  })

  test("prunes contributions removed by a successful replacement without blanking kept panes", async () => {
    const importFront = async (_url: string, revision: number): Promise<{ default: BoringFrontFactoryWithId }> => ({
      default: hotPlugin("hot-plugin", (api) => {
        api.registerPanel({
          id: "hot-pane",
          label: "Hot Pane",
          component: function HotPane() {
            return React.createElement("div", { "data-testid": "hot-pane" }, `version ${revision}`)
          },
        })
        if (revision === 1) {
          api.registerPanel({
            id: "removed-pane",
            label: "Removed Pane",
            component: function RemovedPane() {
              return React.createElement("div", null, "removed")
            },
          })
          api.registerPanel({
            id: "hidden-removed-pane",
            label: "Hidden Removed Pane",
            requiresCapabilities: ["missing-capability"],
            component: function HiddenRemovedPane() {
              return React.createElement("div", null, "hidden removed")
            },
          })
        }
      }),
    })

    function PruneHarness() {
      const panelRegistry = React.useMemo(() => new PanelRegistry(), [])
      const commandRegistry = React.useMemo(() => new CommandRegistry(), [])
      const surfaceResolverRegistry = React.useMemo(() => new SurfaceResolverRegistry(), [])
      function Listener() {
        useAgentPluginHotReload({ workspaceId: "test-workspace", importFront })
        return null
      }
      return (
        <RegistryProvider panelRegistry={panelRegistry} commandRegistry={commandRegistry} surfaceResolverRegistry={surfaceResolverRegistry}>
          <Listener />
          <PaneRenderer id="hot-pane" />
          <PanelIds />
          <AllPanelIds />
        </RegistryProvider>
      )
    }

    render(<PruneHarness />)
    MockEventSource.instances[0].dispatch("boring.plugin.load", {
      type: "boring.plugin.load",
      id: "hot-plugin",
      version: "1.0.0",
      revision: 1,
      frontUrl: "/@fs/front.mjs",
      boring: { front: "./front.mjs" },
    })
    await waitFor(() => expect(screen.getByTestId("hot-pane")).toHaveTextContent("version 1"))
    expect(screen.getByTestId("panel-ids")).toHaveTextContent("removed-pane")
    expect(screen.getByTestId("panel-ids")).not.toHaveTextContent("hidden-removed-pane")
    expect(screen.getByTestId("all-panel-ids")).toHaveTextContent("hidden-removed-pane")

    MockEventSource.instances[0].dispatch("boring.plugin.load", {
      type: "boring.plugin.load",
      id: "hot-plugin",
      version: "1.0.0",
      revision: 2,
      frontUrl: "/@fs/front.mjs",
      boring: { front: "./front.mjs" },
    })
    await waitFor(() => expect(screen.getByTestId("hot-pane")).toHaveTextContent("version 2"))
    expect(screen.getByTestId("panel-ids")).not.toHaveTextContent("removed-pane")
    expect(screen.getByTestId("all-panel-ids")).not.toHaveTextContent("hidden-removed-pane")
  })

  test("renders runtime left tabs by resolving their panelId component", async () => {
    const importFront = async (): Promise<{ default: BoringFrontFactoryWithId }> => ({
      default: hotPlugin("hot-plugin", (api) => {
        api.registerPanel({
          id: "hot-left-pane",
          label: "Hot Left Pane",
          component: function HotLeftPane() {
            return <div data-testid="hot-left-pane">left tab content</div>
          },
        })
        api.registerLeftTab({
          id: "hot-left-tab",
          title: "Hot Left",
          panelId: "hot-left-pane",
        })
      }),
    })

    function LeftTabHarness() {
      const panelRegistry = React.useMemo(() => new PanelRegistry(), [])
      const commandRegistry = React.useMemo(() => new CommandRegistry(), [])
      const surfaceResolverRegistry = React.useMemo(() => new SurfaceResolverRegistry(), [])
      function Listener() {
        useAgentPluginHotReload({ workspaceId: "test-workspace", importFront })
        return null
      }
      return (
        <RegistryProvider panelRegistry={panelRegistry} commandRegistry={commandRegistry} surfaceResolverRegistry={surfaceResolverRegistry}>
          <Listener />
          <PaneRenderer id="hot-left-tab" />
        </RegistryProvider>
      )
    }

    render(<LeftTabHarness />)
    MockEventSource.instances[0].dispatch("boring.plugin.load", {
      type: "boring.plugin.load",
      id: "hot-plugin",
      version: "1.0.0",
      revision: 1,
      frontUrl: "/@fs/front.mjs",
      boring: { front: "./front.mjs" },
    })

    await waitFor(() => expect(screen.getByTestId("hot-left-pane")).toHaveTextContent("left tab content"))
  })

  test("warns when a left tab references an unknown panelId", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const importFront = async (): Promise<{ default: BoringFrontFactoryWithId }> => ({
        default: hotPlugin("hot-plugin", (api) => {
          api.registerPanel({
            id: "hot-plugin.panel",
            label: "Real Panel",
            component: function RealPanel() { return null },
          })
          api.registerLeftTab({
            id: "hot-plugin.tab",
            title: "Typo Tab",
            panelId: "hot-plugin-typo.panel",
          })
        }),
      })

      function WarnHarness() {
        const panelRegistry = React.useMemo(() => new PanelRegistry(), [])
        const commandRegistry = React.useMemo(() => new CommandRegistry(), [])
        const surfaceResolverRegistry = React.useMemo(() => new SurfaceResolverRegistry(), [])
        function Listener() {
          useAgentPluginHotReload({ workspaceId: "test-workspace", importFront })
          return null
        }
        return (
          <RegistryProvider panelRegistry={panelRegistry} commandRegistry={commandRegistry} surfaceResolverRegistry={surfaceResolverRegistry}>
            <Listener />
          </RegistryProvider>
        )
      }

      render(<WarnHarness />)
      MockEventSource.instances[0].dispatch("boring.plugin.load", {
        type: "boring.plugin.load",
        id: "hot-plugin",
        version: "1.0.0",
        revision: 1,
        frontUrl: "/@fs/front.mjs",
        boring: { front: "./front.mjs" },
      })

      await waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('references unknown panelId "hot-plugin-typo.panel"')))
    } finally {
      warn.mockRestore()
    }
  })

  test("updates command palette entries when plugin front registrations change", async () => {
    const importFront = async (_url: string, revision: number): Promise<{ default: BoringFrontFactoryWithId }> => ({
      default: hotPlugin("hot-plugin", (api) => {
        api.registerPanelCommand({
          id: "hot-plugin.open",
          title: revision === 1 ? "Open Hot Plugin" : "Open Hot Plugin v2",
          panelId: "hot-pane",
        })
        if (revision === 1) {
          api.registerPanelCommand({
            id: "hot-plugin.removed",
            title: "Removed Plugin Command",
            panelId: "removed-pane",
          })
        }
      }),
    })

    function CommandHarness() {
      const panelRegistry = React.useMemo(() => new PanelRegistry(), [])
      const commandRegistry = React.useMemo(() => new CommandRegistry(), [])
      const surfaceResolverRegistry = React.useMemo(() => new SurfaceResolverRegistry(), [])
      function Listener() {
        useAgentPluginHotReload({ workspaceId: "test-workspace", importFront })
        return null
      }
      return (
        <RegistryProvider panelRegistry={panelRegistry} commandRegistry={commandRegistry} surfaceResolverRegistry={surfaceResolverRegistry}>
          <Listener />
          <CommandList />
        </RegistryProvider>
      )
    }

    render(<CommandHarness />)
    MockEventSource.instances[0].dispatch("boring.plugin.load", {
      type: "boring.plugin.load",
      id: "hot-plugin",
      version: "1.0.0",
      revision: 1,
      frontUrl: "/@fs/front.mjs",
      boring: { front: "./front.mjs" },
    })
    await waitFor(() => expect(screen.getByTestId("command-list")).toHaveTextContent("hot-plugin.open:Open Hot Plugin"))
    expect(screen.getByTestId("command-list")).toHaveTextContent("hot-plugin.removed:Removed Plugin Command")

    MockEventSource.instances[0].dispatch("boring.plugin.load", {
      type: "boring.plugin.load",
      id: "hot-plugin",
      version: "1.0.0",
      revision: 2,
      frontUrl: "/@fs/front.mjs",
      boring: { front: "./front.mjs" },
    })
    await waitFor(() => expect(screen.getByTestId("command-list")).toHaveTextContent("hot-plugin.open:Open Hot Plugin v2"))
    expect(screen.getByTestId("command-list")).not.toHaveTextContent("hot-plugin.removed")
  })

  test("updates catalog entries when plugin front registrations change", async () => {
    const adapter = { search: async () => ({ items: [], total: 0, hasMore: false }) }
    const importFront = async (_url: string, revision: number): Promise<{ default: BoringFrontFactoryWithId }> => ({
      default: hotPlugin("hot-plugin", (api) => {
        api.registerCatalog({
          id: "hot-catalog",
          label: revision === 1 ? "Hot Catalog" : "Hot Catalog v2",
          adapter,
          onSelect: () => undefined,
        })
        if (revision === 1) {
          api.registerCatalog({
            id: "removed-catalog",
            label: "Removed Catalog",
            adapter,
            onSelect: () => undefined,
          })
        }
      }),
    })

    function CatalogHarness() {
      const panelRegistry = React.useMemo(() => new PanelRegistry(), [])
      const commandRegistry = React.useMemo(() => new CommandRegistry(), [])
      const surfaceResolverRegistry = React.useMemo(() => new SurfaceResolverRegistry(), [])
      function Listener() {
        useAgentPluginHotReload({ workspaceId: "test-workspace", importFront })
        return null
      }
      return (
        <RegistryProvider panelRegistry={panelRegistry} commandRegistry={commandRegistry} surfaceResolverRegistry={surfaceResolverRegistry}>
          <Listener />
          <CatalogList />
        </RegistryProvider>
      )
    }

    render(<CatalogHarness />)
    MockEventSource.instances[0].dispatch("boring.plugin.load", {
      type: "boring.plugin.load",
      id: "hot-plugin",
      version: "1.0.0",
      revision: 1,
      frontUrl: "/@fs/front.mjs",
      boring: { front: "./front.mjs" },
    })
    await waitFor(() => expect(screen.getByTestId("catalog-list")).toHaveTextContent("hot-catalog:Hot Catalog"))
    expect(screen.getByTestId("catalog-list")).toHaveTextContent("removed-catalog:Removed Catalog")

    MockEventSource.instances[0].dispatch("boring.plugin.load", {
      type: "boring.plugin.load",
      id: "hot-plugin",
      version: "1.0.0",
      revision: 2,
      frontUrl: "/@fs/front.mjs",
      boring: { front: "./front.mjs" },
    })
    await waitFor(() => expect(screen.getByTestId("catalog-list")).toHaveTextContent("hot-catalog:Hot Catalog v2"))
    expect(screen.getByTestId("catalog-list")).not.toHaveTextContent("removed-catalog")

    MockEventSource.instances[0].dispatch("boring.plugin.unload", {
      type: "boring.plugin.unload",
      id: "hot-plugin",
      revision: 3,
    })
    await waitFor(() => expect(screen.getByTestId("catalog-list")).toHaveTextContent(""))
  })

  test("unloads plugins missing from a replay snapshot", async () => {
    const importFront = async (): Promise<{ default: BoringFrontFactoryWithId }> => ({
      default: hotPlugin("hot-plugin", (api) => {
        api.registerPanel({
          id: "hot-pane",
          label: "Hot Pane",
          component: function HotPane() {
            return React.createElement("div", { "data-testid": "hot-pane" }, "loaded")
          },
        })
      }),
    })

    function Listener() {
      useAgentPluginHotReload({ workspaceId: "test-workspace", importFront })
      return null
    }

    function ReplayHarness() {
      const panelRegistry = React.useMemo(() => new PanelRegistry(), [])
      const commandRegistry = React.useMemo(() => new CommandRegistry(), [])
      const surfaceResolverRegistry = React.useMemo(() => new SurfaceResolverRegistry(), [])
      return (
        <RegistryProvider
          panelRegistry={panelRegistry}
          commandRegistry={commandRegistry}
          surfaceResolverRegistry={surfaceResolverRegistry}
        >
          <Listener />
          <PaneRenderer id="hot-pane" />
          <PanelIds />
        </RegistryProvider>
      )
    }

    render(<ReplayHarness />)
    MockEventSource.instances[0].dispatch("boring.plugin.load", {
      type: "boring.plugin.load",
      id: "hot-plugin",
      version: "1.0.0",
      revision: 1,
      frontUrl: "/@fs/front.mjs",
      boring: { front: "./front.mjs" },
    })
    await waitFor(() => expect(screen.getByTestId("hot-pane")).toHaveTextContent("loaded"))

    MockEventSource.instances[0].dispatch("boring.plugin.replay-complete", {
      type: "boring.plugin.replay-complete",
      replay: true,
    })

    await waitFor(() => expect(screen.getByTestId("pane-missing")).toBeInTheDocument())
    expect(screen.getByTestId("panel-ids")).toHaveTextContent("")
  })

  test("warns but refreshes supported UI when a hot-load revision includes provider/binding contributions", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const importFront = async (_url: string, revision: number): Promise<{ default: BoringFrontFactoryWithId }> => ({
      default: hotPlugin("provider-plugin", (api) => {
        if (revision > 1) {
          api.registerProvider({
            id: "hot-provider",
            component: function HotProvider({ children }: { children: React.ReactNode }) {
              return React.createElement(React.Fragment, null, children)
            },
          })
          api.registerBinding({ id: "hot-binding", component: () => null })
        }
        api.registerPanel({
          id: "hot-pane",
          label: "Hot Pane",
          component: function HotPane() {
            return React.createElement("div", { "data-testid": "hot-pane" }, revision === 1 ? "version one" : "version two")
          },
        })
      }),
    })

    try {
      function ProviderHarness() {
        const panelRegistry = React.useMemo(() => {
          const registry = new PanelRegistry()
          registry.register("hot-pane", {
            title: "Static Pane",
            placement: "center",
            pluginId: "provider-plugin",
            component: function StaticPane() {
              return React.createElement("div", { "data-testid": "static-pane" }, "static stays mounted")
            },
          })
          return registry
        }, [])
        const commandRegistry = React.useMemo(() => new CommandRegistry(), [])
        const surfaceResolverRegistry = React.useMemo(() => {
          const registry = new SurfaceResolverRegistry()
          registry.register("provider-plugin.surface", {
            source: "builtin",
            pluginId: "provider-plugin",
            resolve: () => undefined,
          })
          return registry
        }, [])
        function Listener() {
          useAgentPluginHotReload({ workspaceId: "test-workspace", importFront })
          return null
        }
        return (
          <RegistryProvider panelRegistry={panelRegistry} commandRegistry={commandRegistry} surfaceResolverRegistry={surfaceResolverRegistry}>
            <Listener />
            <PaneRenderer id="hot-pane" />
            <ResolverIds />
          </RegistryProvider>
        )
      }

      render(<ProviderHarness />)
      MockEventSource.instances[0].dispatch("boring.plugin.load", {
        type: "boring.plugin.load",
        id: "provider-plugin",
        version: "1.0.0",
        revision: 1,
        frontUrl: "/@fs/front.mjs",
        boring: { front: "./front.mjs" },
      })
      await waitFor(() => expect(screen.getByTestId("hot-pane")).toHaveTextContent("version one"))

      MockEventSource.instances[0].dispatch("boring.plugin.load", {
        type: "boring.plugin.load",
        id: "provider-plugin",
        version: "1.0.0",
        revision: 2,
        frontUrl: "/@fs/front.mjs",
        boring: { front: "./front.mjs" },
      })

      await waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining("Dynamic provider/binding mounting is not implemented")))
      await waitFor(() => expect(screen.getByTestId("hot-pane")).toHaveTextContent("version two"))
    } finally {
      warn.mockRestore()
    }
  })

  test("disables bearer-auth hot reload because native EventSource cannot send auth headers", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    function Listener() {
      useAgentPluginHotReload({
        workspaceId: "test-workspace",
        authHeaders: { Authorization: "Bearer dev-token" },
      })
      return null
    }

    try {
      render(
        <RegistryProvider
          panelRegistry={new PanelRegistry()}
          commandRegistry={new CommandRegistry()}
          surfaceResolverRegistry={new SurfaceResolverRegistry()}
        >
          <Listener />
        </RegistryProvider>,
      )
      expect(MockEventSource.instances).toHaveLength(0)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("front plugin hot reload disabled"))
    } finally {
      warn.mockRestore()
    }
  })

  test("ignores stale slow imports when a newer revision has already landed", async () => {
    let resolveRev1: ((mod: { default: BoringFrontFactoryWithId }) => void) | undefined
    let resolveRev2: ((mod: { default: BoringFrontFactoryWithId }) => void) | undefined
    const importFront = async (_url: string, revision: number) => {
      return await new Promise<{ default: BoringFrontFactoryWithId }>((resolve) => {
        if (revision === 1) resolveRev1 = resolve
        else if (revision === 2) resolveRev2 = resolve
        else throw new Error(`unexpected revision ${revision}`)
      })
    }
    const moduleFor = (text: string): { default: BoringFrontFactoryWithId } => ({
      default: hotPlugin("hot-plugin", (api) => {
        api.registerPanel({
          id: "hot-pane",
          label: "Hot Pane",
          component: function HotPane() {
            return React.createElement("div", { "data-testid": "hot-pane" }, text)
          },
        })
      }),
    })

    function RacingHarness() {
      const panelRegistry = React.useMemo(() => new PanelRegistry(), [])
      const commandRegistry = React.useMemo(() => new CommandRegistry(), [])
      const surfaceResolverRegistry = React.useMemo(() => new SurfaceResolverRegistry(), [])
      function Listener() {
        useAgentPluginHotReload({ workspaceId: "test-workspace", importFront })
        return null
      }
      return (
        <RegistryProvider panelRegistry={panelRegistry} commandRegistry={commandRegistry} surfaceResolverRegistry={surfaceResolverRegistry}>
          <Listener />
          <PaneRenderer id="hot-pane" />
        </RegistryProvider>
      )
    }

    render(<RacingHarness />)
    MockEventSource.instances[0].dispatch("boring.plugin.load", {
      type: "boring.plugin.load",
      id: "hot-plugin",
      version: "1.0.0",
      revision: 1,
      frontUrl: "/@fs/slow-one.mjs",
      boring: { front: "./front.mjs" },
    })
    MockEventSource.instances[0].dispatch("boring.plugin.load", {
      type: "boring.plugin.load",
      id: "hot-plugin",
      version: "1.0.0",
      revision: 2,
      frontUrl: "/@fs/fast-two.mjs",
      boring: { front: "./front.mjs" },
    })

    resolveRev2?.(moduleFor("version two"))
    await waitFor(() => expect(screen.getByTestId("hot-pane")).toHaveTextContent("version two"))
    resolveRev1?.(moduleFor("version one"))
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(screen.getByTestId("hot-pane")).toHaveTextContent("version two")
  })

  test("does not let a disposed in-flight load poison reconnect for the same revision", async () => {
    let oldImportCalls = 0
    let resolveOldImport: ((mod: { default: BoringFrontFactoryWithId }) => void) | undefined
    const moduleFor = (text: string): { default: BoringFrontFactoryWithId } => ({
      default: hotPlugin("hot-plugin", (api) => {
        api.registerPanel({
          id: "hot-pane",
          label: "Hot Pane",
          component: function HotPane() {
            return React.createElement("div", { "data-testid": "hot-pane" }, text)
          },
        })
      }),
    })
    const oldImportFront = async () => {
      oldImportCalls += 1
      return await new Promise<{ default: BoringFrontFactoryWithId }>((resolve) => {
        resolveOldImport = resolve
      })
    }
    const newImportFront = async () => moduleFor("fresh listener")

    function ReconnectHarness({ importFront }: { importFront: (frontUrl: string, revision: number) => Promise<{ default?: BoringFrontFactoryWithId }> }) {
      const panelRegistry = React.useMemo(() => new PanelRegistry(), [])
      const commandRegistry = React.useMemo(() => new CommandRegistry(), [])
      const surfaceResolverRegistry = React.useMemo(() => new SurfaceResolverRegistry(), [])
      function Listener() {
        useAgentPluginHotReload({ workspaceId: "test-workspace", importFront })
        return null
      }
      return (
        <RegistryProvider panelRegistry={panelRegistry} commandRegistry={commandRegistry} surfaceResolverRegistry={surfaceResolverRegistry}>
          <Listener />
          <PaneRenderer id="hot-pane" />
        </RegistryProvider>
      )
    }

    const { rerender } = render(<ReconnectHarness importFront={oldImportFront} />)
    MockEventSource.instances[0].dispatch("boring.plugin.load", {
      type: "boring.plugin.load",
      id: "hot-plugin",
      version: "1.0.0",
      revision: 1,
      frontUrl: "/@fs/slow.mjs",
      boring: { front: "./front.mjs" },
    })
    await waitFor(() => expect(oldImportCalls).toBe(1))

    rerender(<ReconnectHarness importFront={newImportFront} />)
    expect(MockEventSource.instances[0].closed).toBe(true)
    MockEventSource.instances[1].dispatch("boring.plugin.load", {
      type: "boring.plugin.load",
      id: "hot-plugin",
      version: "1.0.0",
      revision: 1,
      frontUrl: "/@fs/fresh.mjs",
      boring: { front: "./front.mjs" },
    })

    await waitFor(() => expect(screen.getByTestId("hot-pane")).toHaveTextContent("fresh listener"))
    resolveOldImport?.(moduleFor("disposed stale listener"))
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(screen.getByTestId("hot-pane")).toHaveTextContent("fresh listener")
  })

  test("retries the same revision after a failed front import", async () => {
    const browserEvents: Array<Record<string, unknown>> = []
    const listener = (event: Event) => browserEvents.push((event as CustomEvent<Record<string, unknown>>).detail)
    window.addEventListener(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, listener)
    let failOnce = true
    const importFront = async (): Promise<{ default?: BoringFrontFactoryWithId }> => {
      if (failOnce) {
        failOnce = false
        return {}
      }
      return {
        default: hotPlugin("hot-plugin", (api) => {
          api.registerPanel({
            id: "hot-pane",
            label: "Hot Pane",
            component: function HotPane() {
              return React.createElement("div", { "data-testid": "hot-pane" }, "retry recovered")
            },
          })
        }),
      }
    }

    function RetryHarness() {
      const panelRegistry = React.useMemo(() => new PanelRegistry(), [])
      const commandRegistry = React.useMemo(() => new CommandRegistry(), [])
      const surfaceResolverRegistry = React.useMemo(() => new SurfaceResolverRegistry(), [])
      function Listener() {
        useAgentPluginHotReload({ workspaceId: "test-workspace", importFront })
        return null
      }
      return (
        <RegistryProvider panelRegistry={panelRegistry} commandRegistry={commandRegistry} surfaceResolverRegistry={surfaceResolverRegistry}>
          <Listener />
          <PaneRenderer id="hot-pane" />
        </RegistryProvider>
      )
    }

    try {
      render(<RetryHarness />)
      const event = {
      type: "boring.plugin.load" as const,
      id: "hot-plugin",
      version: "1.0.0",
      revision: 1,
      frontUrl: "/@fs/flaky.mjs",
      boring: { front: "./front.mjs" },
    }
      MockEventSource.instances[0].dispatch("boring.plugin.load", event)
      await new Promise((resolve) => setTimeout(resolve, 25))
      expect(screen.getByTestId("pane-missing")).toHaveTextContent("missing")
      expect(browserEvents).toContainEqual(expect.objectContaining({
        type: "boring.plugin.front-error",
        id: "hot-plugin",
        revision: 1,
        code: "PLUGIN_LOAD_FAILED",
        stage: "import",
      }))

      MockEventSource.instances[0].dispatch("boring.plugin.load", event)
      await waitFor(() => expect(screen.getByTestId("hot-pane")).toHaveTextContent("retry recovered"))
    } finally {
      window.removeEventListener(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, listener)
    }
  })

  test("keeps the current pane live when generated plugin code has no valid default factory", async () => {
    const browserEvents: Array<Record<string, unknown>> = []
    const listener = (event: Event) => browserEvents.push((event as CustomEvent<Record<string, unknown>>).detail)
    window.addEventListener(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, listener)
    const dir = await makeTempDir("boring-front-fail-keeps-old-")
    const frontPath = join(dir, "front.mjs")
    await writeFrontModule(frontPath, "stable")
    const frontUrl = `/@fs/${frontPath}`

    function FailingHarness() {
      const panelRegistry = React.useMemo(() => new PanelRegistry(), [])
      const commandRegistry = React.useMemo(() => new CommandRegistry(), [])
      const surfaceResolverRegistry = React.useMemo(() => new SurfaceResolverRegistry(), [])
      const importFront = React.useCallback(async (url: string, revision: number) => {
        if (revision === 2) return {}
        return await importFrontFromDisk(url)
      }, [])
      function Listener() {
        useAgentPluginHotReload({ workspaceId: "test-workspace", importFront })
        return null
      }
      return (
        <RegistryProvider panelRegistry={panelRegistry} commandRegistry={commandRegistry} surfaceResolverRegistry={surfaceResolverRegistry}>
          <Listener />
          <PaneRenderer id="hot-pane" />
        </RegistryProvider>
      )
    }

    try {
      render(<FailingHarness />)
      MockEventSource.instances[0].dispatch("boring.plugin.load", {
      type: "boring.plugin.load",
      id: "hot-plugin",
      version: "1.0.0",
      revision: 1,
      frontUrl,
      boring: { front: "./front.mjs" },
    })
    await waitFor(() => expect(screen.getByTestId("hot-pane")).toHaveTextContent("stable"))

    await writeFrontModule(frontPath, "broken replacement")
    MockEventSource.instances[0].dispatch("boring.plugin.load", {
      type: "boring.plugin.load",
      id: "hot-plugin",
      version: "1.0.0",
      revision: 2,
      frontUrl,
      boring: { front: "./front.mjs" },
    })

      await new Promise((resolve) => setTimeout(resolve, 25))
      expect(screen.getByTestId("hot-pane")).toHaveTextContent("stable")
      expect(browserEvents).toContainEqual(expect.objectContaining({
        type: "boring.plugin.front-error",
        id: "hot-plugin",
        revision: 2,
        code: "PLUGIN_LOAD_FAILED",
        stage: "import",
      }))

      await writeFrontModule(frontPath, "recovered")
      MockEventSource.instances[0].dispatch("boring.plugin.load", {
        type: "boring.plugin.load",
        id: "hot-plugin",
        version: "1.0.0",
        revision: 3,
        frontUrl,
        boring: { front: "./front.mjs" },
      })
      await waitFor(() => expect(screen.getByTestId("hot-pane")).toHaveTextContent("recovered"))
    } finally {
      window.removeEventListener(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, listener)
    }
  })

  test("does not register blank UI from package metadata when frontUrl is absent", async () => {
    render(<Harness />)

    MockEventSource.instances[0].dispatch("boring.plugin.load", {
      type: "boring.plugin.load",
      id: "metadata-only-plugin",
      version: "1.0.0",
      revision: 1,
      boring: { label: "Metadata Only" },
    })

    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(screen.getByTestId("pane-missing")).toHaveTextContent("missing")
  })

  test("removes previous UI contributions when a plugin load no longer has a frontUrl", async () => {
    const dir = await makeTempDir("boring-front-removed-entry-")
    const frontPath = join(dir, "front.mjs")
    await writeFrontModule(frontPath, "loaded")
    const frontUrl = `/@fs/${frontPath}`

    render(<Harness />)
    MockEventSource.instances[0].dispatch("boring.plugin.load", {
      type: "boring.plugin.load",
      id: "hot-plugin",
      version: "1.0.0",
      revision: 1,
      frontUrl,
      boring: { front: "./front.mjs" },
    })
    await waitFor(() => expect(screen.getByTestId("hot-pane")).toHaveTextContent("loaded"))

    MockEventSource.instances[0].dispatch("boring.plugin.load", {
      type: "boring.plugin.load",
      id: "hot-plugin",
      version: "1.0.0",
      revision: 2,
      boring: { label: "No front entry" },
    })

    await waitFor(() => expect(screen.getByTestId("pane-missing")).toHaveTextContent("missing"))
  })

  test("ignores malformed SSE payloads and keeps previous UI live", async () => {
    const dir = await makeTempDir("boring-front-malformed-sse-")
    const frontPath = join(dir, "front.mjs")
    await writeFrontModule(frontPath, "loaded")
    const frontUrl = `/@fs/${frontPath}`

    render(<Harness />)
    MockEventSource.instances[0].dispatch("boring.plugin.load", {
      type: "boring.plugin.load",
      id: "hot-plugin",
      version: "1.0.0",
      revision: 1,
      frontUrl,
      boring: { front: "./front.mjs" },
    })
    await waitFor(() => expect(screen.getByTestId("hot-pane")).toHaveTextContent("loaded"))

    MockEventSource.instances[0].dispatchRaw("boring.plugin.load", "{not-json")
    MockEventSource.instances[0].dispatchRaw("boring.plugin.unload", "{not-json")
    MockEventSource.instances[0].dispatchRaw("boring.plugin.error", "{not-json")

    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(screen.getByTestId("hot-pane")).toHaveTextContent("loaded")
  })

  test("unloads plugin panes on SSE unload events", async () => {
    const dir = await makeTempDir("boring-front-unload-")
    const frontPath = join(dir, "front.mjs")
    await writeFrontModule(frontPath, "loaded")
    const frontUrl = `/@fs/${frontPath}`

    render(<Harness />)
    MockEventSource.instances[0].dispatch("boring.plugin.load", {
      type: "boring.plugin.load",
      id: "hot-plugin",
      version: "1.0.0",
      revision: 1,
      frontUrl,
      boring: { front: "./front.mjs" },
    })
    await waitFor(() => expect(screen.getByTestId("hot-pane")).toHaveTextContent("loaded"))

    MockEventSource.instances[0].dispatch("boring.plugin.unload", {
      type: "boring.plugin.unload",
      id: "hot-plugin",
      revision: 2,
    })

    await waitFor(() => expect(screen.getByTestId("pane-missing")).toHaveTextContent("missing"))
  })

  test("keeps panels registered through a /reload reconnect and re-imports the replayed snapshot", async () => {
    const presence: boolean[] = []
    let importText = "v1"
    let importCalls = 0
    const importFront = async (): Promise<{ default?: BoringFrontFactoryWithId }> => {
      importCalls += 1
      const text = importText
      return {
        default: hotPlugin("hot-plugin", (api) => {
          api.registerPanel({
            id: "hot-pane",
            label: "Hot Pane",
            component: function HotPane() {
              return React.createElement("div", { "data-testid": "hot-pane" }, text)
            },
          })
        }),
      }
    }

    function PresenceProbe() {
      const registry = useRegistry()
      useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot)
      presence.push(Boolean(registry.get("hot-pane")))
      return null
    }

    function ReloadHarness() {
      const panelRegistry = React.useMemo(() => new PanelRegistry(), [])
      const commandRegistry = React.useMemo(() => new CommandRegistry(), [])
      const surfaceResolverRegistry = React.useMemo(() => new SurfaceResolverRegistry(), [])
      function Listener() {
        useAgentPluginHotReload({ workspaceId: "test-workspace", importFront })
        return null
      }
      return (
        <RegistryProvider panelRegistry={panelRegistry} commandRegistry={commandRegistry} surfaceResolverRegistry={surfaceResolverRegistry}>
          <Listener />
          <PaneRenderer id="hot-pane" />
          <PresenceProbe />
        </RegistryProvider>
      )
    }

    render(<ReloadHarness />)
    MockEventSource.instances[0].dispatch("boring.plugin.load", {
      type: "boring.plugin.load",
      id: "hot-plugin",
      version: "1.0.0",
      revision: 1,
      frontUrl: "/@fs/v1.mjs",
      boring: { front: "./front.mjs" },
    })
    await waitFor(() => expect(screen.getByTestId("hot-pane")).toHaveTextContent("v1"))

    // After the initial load the panel must never disappear, even momentarily.
    const fromHere = presence.length
    importText = "v2"

    // The `/reload` slash command forwards the server response, which carries no
    // "boring.plugin.*" type — that is what triggers the reload reconnect.
    act(() => {
      window.dispatchEvent(new CustomEvent(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, { detail: { reloaded: ["hot-plugin"] } }))
    })

    // A new stream opens without tearing the previous registration down.
    await waitFor(() => expect(MockEventSource.instances.length).toBe(2))
    MockEventSource.instances[1].dispatch("boring.plugin.load", {
      type: "boring.plugin.load",
      id: "hot-plugin",
      version: "1.0.0",
      revision: 1,
      replay: true,
      frontUrl: "/@fs/v2.mjs",
      boring: { front: "./front.mjs" },
    })

    // The replayed snapshot re-imports at the unchanged revision (fresh module).
    await waitFor(() => expect(screen.getByTestId("hot-pane")).toHaveTextContent("v2"))
    expect(importCalls).toBe(2)
    // No render between the load and now ever observed the panel missing.
    expect(presence.slice(fromHere).every(Boolean)).toBe(true)
  })

  test("/reload reconnect still prunes plugins absent from the replayed snapshot", async () => {
    const importFront = async (frontUrl: string): Promise<{ default?: BoringFrontFactoryWithId }> => {
      const id = frontUrl.includes("alpha") ? "alpha" : "beta"
      return {
        default: hotPlugin(id, (api) => {
          api.registerPanel({
            id: `${id}-pane`,
            label: `${id} Pane`,
            component: function Pane() {
              return React.createElement("div", { "data-testid": `${id}-pane` }, id)
            },
          })
        }),
      }
    }

    function TwoPluginHarness() {
      const panelRegistry = React.useMemo(() => new PanelRegistry(), [])
      const commandRegistry = React.useMemo(() => new CommandRegistry(), [])
      const surfaceResolverRegistry = React.useMemo(() => new SurfaceResolverRegistry(), [])
      function Listener() {
        useAgentPluginHotReload({ workspaceId: "test-workspace", importFront })
        return null
      }
      return (
        <RegistryProvider panelRegistry={panelRegistry} commandRegistry={commandRegistry} surfaceResolverRegistry={surfaceResolverRegistry}>
          <Listener />
          <PaneRenderer id="alpha-pane" />
          <AllPanelIds />
        </RegistryProvider>
      )
    }

    render(<TwoPluginHarness />)
    for (const id of ["alpha", "beta"]) {
      MockEventSource.instances[0].dispatch("boring.plugin.load", {
        type: "boring.plugin.load",
        id,
        version: "1.0.0",
        revision: 1,
        frontUrl: `/@fs/${id}.mjs`,
        boring: { front: "./front.mjs" },
      })
    }
    await waitFor(() => expect(screen.getByTestId("all-panel-ids")).toHaveTextContent("alpha-pane"))
    await waitFor(() => expect(screen.getByTestId("all-panel-ids")).toHaveTextContent("beta-pane"))

    act(() => {
      window.dispatchEvent(new CustomEvent(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, { detail: { reloaded: ["alpha", "beta"] } }))
    })
    await waitFor(() => expect(MockEventSource.instances.length).toBe(2))

    // Only alpha replays; beta is gone from the new snapshot.
    MockEventSource.instances[1].dispatch("boring.plugin.load", {
      type: "boring.plugin.load",
      id: "alpha",
      version: "1.0.0",
      revision: 1,
      replay: true,
      frontUrl: "/@fs/alpha.mjs",
      boring: { front: "./front.mjs" },
    })
    MockEventSource.instances[1].dispatch("boring.plugin.replay-complete", {
      type: "boring.plugin.replay-complete",
      workspaceId: "test-workspace",
    })

    await waitFor(() => expect(screen.getByTestId("all-panel-ids")).not.toHaveTextContent("beta-pane"))
    expect(screen.getByTestId("all-panel-ids")).toHaveTextContent("alpha-pane")
  })
})

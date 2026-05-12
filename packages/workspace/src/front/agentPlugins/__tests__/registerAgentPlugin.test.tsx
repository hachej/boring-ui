import React, { useSyncExternalStore } from "react"
import { render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { RegistryProvider, useRegistry } from "../../registry/RegistryProvider"
import { PanelRegistry } from "../../registry/PanelRegistry"
import { CommandRegistry } from "../../registry/CommandRegistry"
import { SurfaceResolverRegistry } from "../../registry/SurfaceResolverRegistry"
import type { BoringFrontFactory } from "../../../shared/plugins/frontFactory"
import { useAgentPluginHotReload } from "../registerAgentPlugin"

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
    const event = { data: JSON.stringify(data) } as MessageEvent
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

async function importFrontFromDisk(frontUrl: string): Promise<{ default: BoringFrontFactory }> {
  const filePath = frontUrl.replace(/^\/@fs\//, "/")
  const source = await readFile(filePath, "utf8")
  const match = source.match(/HOT_TEXT:([^\n]+)/)
  const text = match?.[1]?.trim() ?? "missing"
  return {
    default(api) {
      api.registerPanel({
        id: "hot-pane",
        label: "Hot Pane",
        component: function HotPane() {
          return React.createElement("div", { "data-testid": "hot-pane" }, text)
        },
      })
    },
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
      boring: { front: "./front.mjs", panels: [{ id: "hot-pane", title: "Hot Pane" }] },
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
      boring: { front: "./front.mjs", panels: [{ id: "hot-pane", title: "Hot Pane" }] },
    })

    await waitFor(() => expect(screen.getByTestId("hot-pane")).toHaveTextContent("version two"))

    MockEventSource.instances[0].dispatch("boring.plugin.load", {
      type: "boring.plugin.load",
      id: "hot-plugin",
      version: "1.0.0",
      revision: 1,
      frontUrl,
      boring: { front: "./front.mjs", panels: [{ id: "hot-pane", title: "Hot Pane" }] },
    })

    expect(screen.getByTestId("hot-pane")).toHaveTextContent("version two")
  })

  test("prunes contributions removed by a successful replacement without blanking kept panes", async () => {
    const importFront = async (_url: string, revision: number): Promise<{ default: BoringFrontFactory }> => ({
      default(api) {
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
        }
      },
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
      boring: { front: "./front.mjs", panels: [{ id: "hot-pane", title: "Hot Pane" }, { id: "removed-pane", title: "Removed Pane" }] },
    })
    await waitFor(() => expect(screen.getByTestId("hot-pane")).toHaveTextContent("version 1"))
    expect(screen.getByTestId("panel-ids")).toHaveTextContent("removed-pane")

    MockEventSource.instances[0].dispatch("boring.plugin.load", {
      type: "boring.plugin.load",
      id: "hot-plugin",
      version: "1.0.0",
      revision: 2,
      frontUrl: "/@fs/front.mjs",
      boring: { front: "./front.mjs", panels: [{ id: "hot-pane", title: "Hot Pane" }] },
    })
    await waitFor(() => expect(screen.getByTestId("hot-pane")).toHaveTextContent("version 2"))
    expect(screen.getByTestId("panel-ids")).not.toHaveTextContent("removed-pane")
  })

  test("ignores stale slow imports when a newer revision has already landed", async () => {
    let resolveRev1: ((mod: { default: BoringFrontFactory }) => void) | undefined
    let resolveRev2: ((mod: { default: BoringFrontFactory }) => void) | undefined
    const importFront = async (_url: string, revision: number) => {
      return await new Promise<{ default: BoringFrontFactory }>((resolve) => {
        if (revision === 1) resolveRev1 = resolve
        else if (revision === 2) resolveRev2 = resolve
        else throw new Error(`unexpected revision ${revision}`)
      })
    }
    const moduleFor = (text: string): { default: BoringFrontFactory } => ({
      default(api) {
        api.registerPanel({
          id: "hot-pane",
          label: "Hot Pane",
          component: function HotPane() {
            return React.createElement("div", { "data-testid": "hot-pane" }, text)
          },
        })
      },
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
      boring: { front: "./front.mjs", panels: [{ id: "hot-pane", title: "Hot Pane" }] },
    })
    MockEventSource.instances[0].dispatch("boring.plugin.load", {
      type: "boring.plugin.load",
      id: "hot-plugin",
      version: "1.0.0",
      revision: 2,
      frontUrl: "/@fs/fast-two.mjs",
      boring: { front: "./front.mjs", panels: [{ id: "hot-pane", title: "Hot Pane" }] },
    })

    resolveRev2?.(moduleFor("version two"))
    await waitFor(() => expect(screen.getByTestId("hot-pane")).toHaveTextContent("version two"))
    resolveRev1?.(moduleFor("version one"))
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(screen.getByTestId("hot-pane")).toHaveTextContent("version two")
  })

  test("does not let a disposed in-flight load poison reconnect for the same revision", async () => {
    let oldImportCalls = 0
    let resolveOldImport: ((mod: { default: BoringFrontFactory }) => void) | undefined
    const moduleFor = (text: string): { default: BoringFrontFactory } => ({
      default(api) {
        api.registerPanel({
          id: "hot-pane",
          label: "Hot Pane",
          component: function HotPane() {
            return React.createElement("div", { "data-testid": "hot-pane" }, text)
          },
        })
      },
    })
    const oldImportFront = async () => {
      oldImportCalls += 1
      return await new Promise<{ default: BoringFrontFactory }>((resolve) => {
        resolveOldImport = resolve
      })
    }
    const newImportFront = async () => moduleFor("fresh listener")

    function ReconnectHarness({ importFront }: { importFront: (frontUrl: string, revision: number) => Promise<{ default?: BoringFrontFactory }> }) {
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
      boring: { front: "./front.mjs", panels: [{ id: "hot-pane", title: "Hot Pane" }] },
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
      boring: { front: "./front.mjs", panels: [{ id: "hot-pane", title: "Hot Pane" }] },
    })

    await waitFor(() => expect(screen.getByTestId("hot-pane")).toHaveTextContent("fresh listener"))
    resolveOldImport?.(moduleFor("disposed stale listener"))
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(screen.getByTestId("hot-pane")).toHaveTextContent("fresh listener")
  })

  test("keeps the current pane live when generated plugin code has no valid default factory", async () => {
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

    render(<FailingHarness />)
    MockEventSource.instances[0].dispatch("boring.plugin.load", {
      type: "boring.plugin.load",
      id: "hot-plugin",
      version: "1.0.0",
      revision: 1,
      frontUrl,
      boring: { front: "./front.mjs", panels: [{ id: "hot-pane", title: "Hot Pane" }] },
    })
    await waitFor(() => expect(screen.getByTestId("hot-pane")).toHaveTextContent("stable"))

    await writeFrontModule(frontPath, "broken replacement")
    MockEventSource.instances[0].dispatch("boring.plugin.load", {
      type: "boring.plugin.load",
      id: "hot-plugin",
      version: "1.0.0",
      revision: 2,
      frontUrl,
      boring: { front: "./front.mjs", panels: [{ id: "hot-pane", title: "Hot Pane" }] },
    })

    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(screen.getByTestId("hot-pane")).toHaveTextContent("stable")

    await writeFrontModule(frontPath, "recovered")
    MockEventSource.instances[0].dispatch("boring.plugin.load", {
      type: "boring.plugin.load",
      id: "hot-plugin",
      version: "1.0.0",
      revision: 3,
      frontUrl,
      boring: { front: "./front.mjs", panels: [{ id: "hot-pane", title: "Hot Pane" }] },
    })
    await waitFor(() => expect(screen.getByTestId("hot-pane")).toHaveTextContent("recovered"))
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
      boring: { front: "./front.mjs", panels: [{ id: "hot-pane", title: "Hot Pane" }] },
    })
    await waitFor(() => expect(screen.getByTestId("hot-pane")).toHaveTextContent("loaded"))

    MockEventSource.instances[0].dispatch("boring.plugin.unload", {
      type: "boring.plugin.unload",
      id: "hot-plugin",
      revision: 2,
    })

    await waitFor(() => expect(screen.getByTestId("pane-missing")).toHaveTextContent("missing"))
  })
})

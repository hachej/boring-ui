import { describe, it, expect, vi } from "vitest"
import { act, render, screen, waitFor } from "@testing-library/react"
import { renderHook } from "@testing-library/react"
import { Suspense, type ReactNode } from "react"
import { PanelRegistry } from "../PanelRegistry"
import { CommandRegistry } from "../../../shared/plugins/CommandRegistry"
import { SurfaceResolverRegistry } from "../../../shared/plugins/SurfaceResolverRegistry"
import {
  RegistryProvider,
  useRegistry,
  useCommandRegistry,
  useSurfaceResolverRegistry,
} from "../RegistryProvider"
import { getFileIcon } from "../getFileIcon"
import {
  FileIcon,
  FileTextIcon,
  FileCodeIcon,
  FileJsonIcon,
  ImageIcon,
} from "lucide-react"

function DummyPanel() {
  return <div>dummy</div>
}

function AnotherPanel() {
  return <div>another</div>
}

function LazyPanelOne() {
  return <div>lazy-one</div>
}

function LazyPanelTwo() {
  return <div>lazy-two</div>
}

// --- PanelRegistry ---
describe("PanelRegistry", () => {
  it("register stores panel and get returns it", () => {
    const reg = new PanelRegistry()
    reg.register("filetree", { title: "File Tree", component: DummyPanel })
    const panel = reg.get("filetree")
    expect(panel).toBeDefined()
    expect(panel!.id).toBe("filetree")
    expect(panel!.title).toBe("File Tree")
  })

  it("register duplicate ID overwrites previous", () => {
    const reg = new PanelRegistry()
    reg.register("filetree", { title: "Old", component: DummyPanel })
    reg.register("filetree", { title: "New", component: AnotherPanel })
    expect(reg.get("filetree")!.title).toBe("New")
    expect(reg.list()).toHaveLength(1)
  })

  it("list returns all registered panels", () => {
    const reg = new PanelRegistry()
    reg.register("a", { title: "A", component: DummyPanel })
    reg.register("b", { title: "B", component: DummyPanel })
    expect(reg.list()).toHaveLength(2)
  })

  it("has returns true for registered, false for unregistered", () => {
    const reg = new PanelRegistry()
    reg.register("a", { title: "A", component: DummyPanel })
    expect(reg.has("a")).toBe(true)
    expect(reg.has("z")).toBe(false)
  })

  it("getComponents returns component map for all panels", () => {
    const reg = new PanelRegistry()
    reg.register("a", { title: "A", component: DummyPanel })
    reg.register("b", { title: "B", component: AnotherPanel })
    const comps = reg.getComponents()
    expect(Object.keys(comps)).toEqual(["a", "b"])
  })

  it("getComponents wraps lazy importers in an error boundary", () => {
    const reg = new PanelRegistry()
    const importer = () => Promise.resolve({ default: DummyPanel })
    reg.register("lazy", { title: "Lazy", component: importer, lazy: true })
    const comps = reg.getComponents()
    expect(comps.lazy).toBeDefined()
    expect(comps.lazy.name).toMatch(/^WrappedPanel/)
  })

  it("getComponents wraps sync components in an error boundary", () => {
    const reg = new PanelRegistry()
    reg.register("sync", { title: "Sync", component: DummyPanel })
    const comps = reg.getComponents()
    expect(comps.sync).toBeDefined()
    expect(comps.sync).not.toBe(DummyPanel)
    expect(comps.sync.name).toMatch(/^WrappedPanel/)
  })

  it("rendered wrapped panels switch to replacement registrations", async () => {
    const reg = new PanelRegistry()
    reg.register("hot", { title: "Hot", component: DummyPanel })
    const HotPanel = reg.getComponents().hot
    render(<HotPanel />)
    expect(screen.getByText("dummy")).toBeInTheDocument()

    act(() => {
      reg.register("hot", { title: "Hot", component: AnotherPanel })
    })
    expect(await screen.findByText("another")).toBeInTheDocument()
    expect(screen.queryByText("dummy")).not.toBeInTheDocument()
  })

  it("rendered wrapped panels stop rendering after replacement requires missing capabilities", async () => {
    const reg = new PanelRegistry()
    reg.register("cap", { title: "Cap", component: DummyPanel })
    const CapPanel = reg.getComponents().cap
    render(<CapPanel />)
    expect(screen.getByText("dummy")).toBeInTheDocument()

    act(() => {
      reg.register("cap", {
        title: "Cap",
        component: AnotherPanel,
        requiresCapabilities: ["missing-capability"],
      })
    })
    await waitFor(() => expect(screen.queryByText("dummy")).not.toBeInTheDocument())
    expect(screen.queryByText("another")).not.toBeInTheDocument()
  })

  it("keeps lazy component identity stable across initial Suspense retries", async () => {
    const reg = new PanelRegistry()
    let resolveImport: (value: { default: typeof LazyPanelOne }) => void = () => {}
    const importer = vi.fn(
      () => new Promise<{ default: typeof LazyPanelOne }>((resolve) => {
        resolveImport = resolve
      }),
    )
    reg.register("stable-lazy", {
      title: "Stable Lazy",
      component: importer,
      lazy: true,
    })
    const StableLazyPanel = reg.getComponents()["stable-lazy"]
    const view = render(
      <Suspense fallback={<div>loading stable lazy</div>}>
        <StableLazyPanel tick={0} />
      </Suspense>,
    )
    expect(screen.getByText("Loading…")).toBeInTheDocument()

    view.rerender(
      <Suspense fallback={<div>loading stable lazy</div>}>
        <StableLazyPanel tick={1} />
      </Suspense>,
    )
    expect(importer).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveImport({ default: LazyPanelOne })
    })
    expect(await screen.findByText("lazy-one")).toBeInTheDocument()
  })

  it("rendered lazy wrapped panels switch to replacement lazy importers", async () => {
    const reg = new PanelRegistry()
    reg.register("hot-lazy", {
      title: "Hot Lazy",
      component: () => Promise.resolve({ default: LazyPanelOne }),
      lazy: true,
    })
    const HotLazyPanel = reg.getComponents()["hot-lazy"]
    render(
      <Suspense fallback={<div>loading lazy</div>}>
        <HotLazyPanel />
      </Suspense>,
    )
    expect(await screen.findByText("lazy-one")).toBeInTheDocument()

    act(() => {
      reg.register("hot-lazy", {
        title: "Hot Lazy",
        component: () => Promise.resolve({ default: LazyPanelTwo }),
        lazy: true,
      })
    })
    expect(await screen.findByText("lazy-two")).toBeInTheDocument()
    expect(screen.queryByText("lazy-one")).not.toBeInTheDocument()
  })

  it("adds stable panel markers for plugin pane screenshots", async () => {
    const reg = new PanelRegistry()
    reg.register("chart-demo.panel", {
      title: "Chart Demo",
      pluginId: "chart-demo",
      pluginRevision: 7,
      component: () => <div>chart demo pane</div>,
    })
    const Panel = reg.getComponents()["chart-demo.panel"]
    render(<Panel api={{ id: "self-test:chart-demo:chart-demo.panel" }} />)
    const wrapper = screen.getByText("chart demo pane").closest("[data-boring-panel-id]")
    expect(wrapper).toHaveAttribute("data-boring-panel-id", "chart-demo.panel")
    expect(wrapper).toHaveAttribute("data-boring-plugin-id", "chart-demo")
    expect(wrapper).toHaveAttribute("data-boring-panel-instance-id", "self-test:chart-demo:chart-demo.panel")
    expect(wrapper).toHaveAttribute("data-boring-plugin-revision", "7")
  })
})

// --- Surface resolver routing ---
describe("SurfaceResolverRegistry", () => {
  it("returns the resolver with the highest score", () => {
    const reg = new SurfaceResolverRegistry()
    reg.register("fallback", { resolve: () => ({ component: "fallback", score: 1 }) })
    reg.register("specific", { resolve: () => ({ component: "specific", score: 10 }) })
    expect(reg.resolve({ kind: "workspace.open.path", target: "readme.md" })!.component).toBe("specific")
  })

  it("app resolver wins equal-score ties over builtin", () => {
    const reg = new SurfaceResolverRegistry()
    reg.register("builtin", {
      source: "builtin",
      resolve: () => ({ component: "builtin", score: 5 }),
    })
    reg.register("app", {
      source: "app",
      resolve: () => ({ component: "app", score: 5 }),
    })
    expect(reg.resolve({ kind: "workspace.open.path", target: "main.ts" })!.component).toBe("app")
  })

  it("later resolver wins exact ties within the same source", () => {
    const reg = new SurfaceResolverRegistry()
    reg.register("first", { resolve: () => ({ component: "first", score: 5 }) })
    reg.register("second", { resolve: () => ({ component: "second", score: 5 }) })
    expect(reg.resolve({ kind: "workspace.open.path", target: "main.ts" })!.component).toBe("second")
  })

  it("returns undefined when no resolver handles the request", () => {
    const reg = new SurfaceResolverRegistry()
    reg.register("other", { resolve: () => undefined })
    expect(reg.resolve({ kind: "workspace.open.path", target: "file.txt" })).toBeUndefined()
  })

  it("continues resolving when one resolver throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const reg = new SurfaceResolverRegistry()
    reg.register("broken", {
      resolve: () => {
        throw new Error("resolver failed")
      },
    })
    reg.register("fallback", { resolve: () => ({ component: "fallback", score: 1 }) })

    expect(reg.resolve({ kind: "workspace.open.path", target: "file.txt" })!.component).toBe(
      "fallback",
    )
    expect(warn).toHaveBeenCalledWith(
      `[SurfaceResolverRegistry] resolver "broken" failed:`,
      "resolver failed",
    )
  })
})

// --- Capability gating ---
describe("PanelRegistry capability gating", () => {
  it("panel with satisfied capability is available", () => {
    const reg = new PanelRegistry({ "agent.chat": true })
    reg.register("agent", {
      title: "Agent",
      component: DummyPanel,
      requiresCapabilities: ["agent.chat"],
    })
    expect(reg.list()).toHaveLength(1)
  })

  it("panel with unsatisfied capability is filtered out", () => {
    const reg = new PanelRegistry({})
    reg.register("agent", {
      title: "Agent",
      component: DummyPanel,
      requiresCapabilities: ["agent.chat"],
    })
    expect(reg.list()).toHaveLength(0)
  })

  it("panel with no requiresCapabilities is always available", () => {
    const reg = new PanelRegistry({})
    reg.register("plain", { title: "Plain", component: DummyPanel })
    expect(reg.list()).toHaveLength(1)
  })

  it("list respects capability filter", () => {
    const reg = new PanelRegistry({ "agent.chat": true })
    reg.register("agent", {
      title: "Agent",
      component: DummyPanel,
      requiresCapabilities: ["agent.chat"],
    })
    reg.register("secret", {
      title: "Secret",
      component: DummyPanel,
      requiresCapabilities: ["admin"],
    })
    reg.register("open", { title: "Open", component: DummyPanel })
    expect(reg.list()).toHaveLength(2)
    expect(reg.list().map((p) => p.id)).toEqual(["agent", "open"])
  })

  it("getComponents respects capability filter", () => {
    const reg = new PanelRegistry({})
    reg.register("gated", {
      title: "Gated",
      component: DummyPanel,
      requiresCapabilities: ["x"],
    })
    reg.register("open", { title: "Open", component: DummyPanel })
    const comps = reg.getComponents()
    expect(Object.keys(comps)).toEqual(["open"])
  })

})

// --- CommandRegistry ---
describe("CommandRegistry", () => {
  it("registerCommand stores command, getCommand returns it", () => {
    const reg = new CommandRegistry()
    reg.registerCommand({ id: "save", title: "Save File", run: () => {} })
    expect(reg.getCommand("save")).toBeDefined()
    expect(reg.getCommand("save")!.title).toBe("Save File")
  })

  it("getCommands returns all registered commands", () => {
    const reg = new CommandRegistry()
    reg.registerCommand({ id: "a", title: "A", run: () => {} })
    reg.registerCommand({ id: "b", title: "B", run: () => {} })
    expect(reg.getCommands()).toHaveLength(2)
  })

  it("command with when: () => false filtered from active commands", () => {
    const reg = new CommandRegistry()
    reg.registerCommand({ id: "always", title: "Always", run: () => {} })
    reg.registerCommand({
      id: "never",
      title: "Never",
      run: () => {},
      when: () => false,
    })
    const active = reg.getActiveCommands()
    expect(active).toHaveLength(1)
    expect(active[0].id).toBe("always")
  })

  it("command run callback is invoked", () => {
    const reg = new CommandRegistry()
    const fn = vi.fn()
    reg.registerCommand({ id: "test", title: "Test", run: fn })
    reg.getCommand("test")!.run()
    expect(fn).toHaveBeenCalled()
  })

  it("throwing when predicate does not crash getActiveCommands", () => {
    const reg = new CommandRegistry()
    reg.registerCommand({ id: "good", title: "Good", run: () => {} })
    reg.registerCommand({
      id: "broken",
      title: "Broken",
      run: () => {},
      when: () => {
        throw new Error("boom")
      },
    })
    const active = reg.getActiveCommands()
    expect(active).toHaveLength(1)
    expect(active[0].id).toBe("good")
  })
})

// --- RegistryProvider + hooks ---
describe("RegistryProvider", () => {
  it("useRegistry returns PanelRegistry inside provider", () => {
    const panelReg = new PanelRegistry()
    panelReg.register("test", { title: "Test", component: DummyPanel })
    const cmdReg = new CommandRegistry()

    const wrapper = ({ children }: { children: ReactNode }) => (
      <RegistryProvider panelRegistry={panelReg} commandRegistry={cmdReg}>
        {children}
      </RegistryProvider>
    )
    const { result } = renderHook(() => useRegistry(), { wrapper })
    expect(result.current.has("test")).toBe(true)
  })

  it("useCommandRegistry returns CommandRegistry inside provider", () => {
    const panelReg = new PanelRegistry()
    const cmdReg = new CommandRegistry()
    cmdReg.registerCommand({ id: "cmd", title: "Cmd", run: () => {} })

    const wrapper = ({ children }: { children: ReactNode }) => (
      <RegistryProvider panelRegistry={panelReg} commandRegistry={cmdReg}>
        {children}
      </RegistryProvider>
    )
    const { result } = renderHook(() => useCommandRegistry(), { wrapper })
    expect(result.current.getCommand("cmd")).toBeDefined()
  })

  it("useSurfaceResolverRegistry returns SurfaceResolverRegistry inside provider", () => {
    const panelReg = new PanelRegistry()
    const cmdReg = new CommandRegistry()
    const resolverReg = new SurfaceResolverRegistry()
    resolverReg.register("test", { resolve: () => ({ component: "test" }) })

    const wrapper = ({ children }: { children: ReactNode }) => (
      <RegistryProvider
        panelRegistry={panelReg}
        commandRegistry={cmdReg}
        surfaceResolverRegistry={resolverReg}
      >
        {children}
      </RegistryProvider>
    )
    const { result } = renderHook(() => useSurfaceResolverRegistry(), { wrapper })
    expect(result.current.has("test")).toBe(true)
  })

  it("useRegistry throws outside RegistryProvider", () => {
    expect(() => {
      renderHook(() => useRegistry())
    }).toThrow("useRegistry must be used within a RegistryProvider")
  })

  it("useCommandRegistry throws outside RegistryProvider", () => {
    expect(() => {
      renderHook(() => useCommandRegistry())
    }).toThrow("useCommandRegistry must be used within a RegistryProvider")
  })

  it("useSurfaceResolverRegistry throws outside RegistryProvider", () => {
    expect(() => {
      renderHook(() => useSurfaceResolverRegistry())
    }).toThrow("useSurfaceResolverRegistry must be used within a RegistryProvider")
  })
})

// --- getFileIcon ---
describe("getFileIcon", () => {
  it("returns FileCodeIcon for TypeScript", () => {
    expect(getFileIcon("file.ts")).toBe(FileCodeIcon)
  })

  it("returns FileCodeIcon for Python", () => {
    expect(getFileIcon("file.py")).toBe(FileCodeIcon)
  })

  it("returns FileTextIcon for Markdown", () => {
    expect(getFileIcon("README.md")).toBe(FileTextIcon)
  })

  it("returns FileJsonIcon for JSON", () => {
    expect(getFileIcon("package.json")).toBe(FileJsonIcon)
  })

  it("returns ImageIcon for PNG", () => {
    expect(getFileIcon("photo.png")).toBe(ImageIcon)
  })

  it("returns default FileIcon for unknown extension", () => {
    expect(getFileIcon("unknown.xyz")).toBe(FileIcon)
  })

  it("handles files with multiple dots", () => {
    expect(getFileIcon("file.test.ts")).toBe(FileCodeIcon)
  })
})

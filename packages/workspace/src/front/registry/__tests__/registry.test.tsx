import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { PanelRegistry, specificity } from "../PanelRegistry"
import { CommandRegistry } from "../CommandRegistry"
import { RegistryProvider, useRegistry, useCommandRegistry } from "../RegistryProvider"
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
    expect(comps.lazy.name).toBe("WrappedPanel")
  })

  it("getComponents wraps sync components in an error boundary", () => {
    const reg = new PanelRegistry()
    reg.register("sync", { title: "Sync", component: DummyPanel })
    const comps = reg.getComponents()
    expect(comps.sync).toBeDefined()
    expect(comps.sync).not.toBe(DummyPanel)
    expect(comps.sync.name).toBe("WrappedPanel")
  })
})

// --- File-type routing ---
describe("PanelRegistry.resolve", () => {
  it("resolve('readme.md') matches *.md pattern", () => {
    const reg = new PanelRegistry()
    reg.register("markdown-editor", {
      title: "MD",
      component: DummyPanel,
      filePatterns: ["*.md", "*.mdx"],
    })
    reg.register("code-editor", {
      title: "Code",
      component: DummyPanel,
      filePatterns: ["*"],
    })
    expect(reg.resolve("readme.md")!.id).toBe("markdown-editor")
  })

  it("resolve('main.ts') falls back to wildcard", () => {
    const reg = new PanelRegistry()
    reg.register("code-editor", {
      title: "Code",
      component: DummyPanel,
      filePatterns: ["*"],
    })
    expect(reg.resolve("main.ts")!.id).toBe("code-editor")
  })

  it("app panel overrides built-in with same pattern regardless of order", () => {
    const reg = new PanelRegistry()
    reg.register("builtin-ts", {
      title: "Builtin TS",
      component: DummyPanel,
      filePatterns: ["*.ts"],
      source: "builtin",
    })
    reg.register("app-ts", {
      title: "App TS",
      component: DummyPanel,
      filePatterns: ["*.ts"],
      source: "app",
    })
    expect(reg.resolve("main.ts")!.id).toBe("app-ts")
  })

  it("*.test.ts beats *.ts (longest suffix wins)", () => {
    const reg = new PanelRegistry()
    reg.register("test-runner", {
      title: "Tests",
      component: DummyPanel,
      filePatterns: ["*.test.ts"],
    })
    reg.register("code-editor", {
      title: "Code",
      component: DummyPanel,
      filePatterns: ["*.ts"],
    })
    expect(reg.resolve("utils.test.ts")!.id).toBe("test-runner")
    expect(reg.resolve("utils.ts")!.id).toBe("code-editor")
  })

  it("tied specificity: later registration wins", () => {
    const reg = new PanelRegistry()
    reg.register("first", {
      title: "First",
      component: DummyPanel,
      filePatterns: ["*.ts"],
    })
    reg.register("second", {
      title: "Second",
      component: DummyPanel,
      filePatterns: ["*.ts"],
    })
    expect(reg.resolve("a.ts")!.id).toBe("second")
  })

  it("resolve returns undefined when no match", () => {
    const reg = new PanelRegistry()
    expect(reg.resolve("file.txt")).toBeUndefined()
  })

  it("path-aware: deck/**/*.md beats **/*.md for deep path", () => {
    const reg = new PanelRegistry()
    reg.register("markdown", {
      title: "Markdown",
      component: DummyPanel,
      filePatterns: ["**/*.md"],
    })
    reg.register("deck", {
      title: "Deck",
      component: DummyPanel,
      filePatterns: ["deck/**/*.md"],
    })
    expect(reg.resolve("deck/labor/labor.md")!.id).toBe("deck")
    expect(reg.resolve("notes.md")!.id).toBe("markdown")
  })

  it("path-aware: **/*.md matches nested paths", () => {
    const reg = new PanelRegistry()
    reg.register("markdown", {
      title: "Markdown",
      component: DummyPanel,
      filePatterns: ["**/*.md"],
    })
    expect(reg.resolve("src/docs/readme.md")!.id).toBe("markdown")
  })

  it("app source beats builtin on equal specificity", () => {
    const reg = new PanelRegistry()
    reg.register("builtin", {
      title: "Builtin",
      component: DummyPanel,
      filePatterns: ["**/*.ts"],
      source: "builtin",
    })
    reg.register("app", {
      title: "App",
      component: DummyPanel,
      filePatterns: ["**/*.ts"],
      source: "app",
    })
    expect(reg.resolve("src/foo.ts")!.id).toBe("app")
  })

  it("panel with no filePatterns never matches", () => {
    const reg = new PanelRegistry()
    reg.register("agent", { title: "Agent", component: DummyPanel })
    expect(reg.resolve("anything.txt")).toBeUndefined()
  })
})

describe("specificity", () => {
  it("deck/**/*.md scores higher than **/*.md", () => {
    expect(specificity("deck/**/*.md")).toBeGreaterThan(specificity("**/*.md"))
  })

  it("deck/labor/*.md scores higher than deck/**/*.md", () => {
    expect(specificity("deck/labor/*.md")).toBeGreaterThan(specificity("deck/**/*.md"))
  })

  it("exact path scores highest", () => {
    expect(specificity("deck/labor/labor.md")).toBeGreaterThan(specificity("deck/**/*.md"))
  })

  it("* scores 10 (1 segment, 0 non-wildcard chars)", () => {
    expect(specificity("*")).toBe(10)
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

  it("resolve skips panels with unsatisfied capabilities", () => {
    const reg = new PanelRegistry({})
    reg.register("gated-md", {
      title: "Gated MD",
      component: DummyPanel,
      filePatterns: ["*.md"],
      requiresCapabilities: ["premium"],
    })
    reg.register("fallback", {
      title: "Fallback",
      component: DummyPanel,
      filePatterns: ["*"],
    })
    expect(reg.resolve("readme.md")!.id).toBe("fallback")
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

import { describe, expect, it } from "vitest"
import type { Workspace, Entry, Lstat, Stat } from "@hachej/boring-agent/shared"
import { HostedPluginManager } from "../manager"

class MemoryWorkspace implements Workspace {
  readonly root = "/workspace"
  readonly runtimeContext = { runtimeCwd: "/workspace" }
  readonly fsCapability = "best-effort" as const
  reads: string[] = []
  constructor(private files: Record<string, string>) {}
  async readFile(path: string) { this.reads.push(path); return this.files[path]! }
  async writeFile(path: string, data: string) { this.files[path] = data }
  async unlink(path: string) { delete this.files[path] }
  async readdir(path: string): Promise<Entry[]> {
    const prefix = path === "." ? "" : `${path}/`
    const names = new Set<string>()
    for (const key of Object.keys(this.files)) {
      if (!key.startsWith(prefix)) continue
      const rest = key.slice(prefix.length).split("/")[0]
      if (rest) names.add(rest)
    }
    return [...names].map((name) => ({ name, kind: Object.keys(this.files).some((key) => key.startsWith(`${prefix}${name}/`)) ? "dir" : "file" }))
  }
  async stat(path: string): Promise<Stat> {
    if (this.files[path] != null) return { kind: "file", size: new TextEncoder().encode(this.files[path]).byteLength, mtimeMs: 1 }
    if (Object.keys(this.files).some((key) => key.startsWith(`${path}/`))) return { kind: "dir", size: 0, mtimeMs: 1 }
    throw new Error("not found")
  }
  async lstat(path: string): Promise<Lstat> { return this.stat(path) }
  async mkdir() {}
  async rename(from: string, to: string) { this.files[to] = this.files[from]!; delete this.files[from] }
}

describe("HostedPluginManager", () => {
  it("scans hosted iframe manifests through Workspace and serves nonce srcdoc", async () => {
    const workspace = new MemoryWorkspace({
      ".pi/extensions/example/package.json": JSON.stringify({ name: "@scope/example", boring: { iframePanels: [{ id: "main", title: "Main", entry: "panel.html" }] } }),
      ".pi/extensions/example/panel.html": "<script>window.beforeCsp = true</script><head><title>Plugin</title></head><h1>Hello</h1>",
    })
    const manager = new HostedPluginManager({ workspace })
    await manager.load()
    const list = await manager.listExternal()
    expect(list[0]?.id).toBe("scope-example")
    expect(list[0]?.frontTarget?.kind).toBe("iframe")
    const document = await manager.getIframeDocument("scope-example", "main", "nonce-1")
    expect(document?.srcdoc).toMatch(/^<!doctype html><html><head><meta http-equiv="Content-Security-Policy"/)
    expect(document?.srcdoc).toContain("nonce-1")
    expect(document?.srcdoc).toContain("setInterval(announce,100)")
  })

  it("isolates bad plugins and records ignored native contribution diagnostics", async () => {
    const workspace = new MemoryWorkspace({
      ".pi/extensions/good/package.json": JSON.stringify({ name: "good", boring: { front: "../front.tsx", server: "../server.ts", iframePanels: [{ id: "main", title: "Main", entry: "panel.html" }] }, pi: { extensions: ["../agent.ts"] } }),
      ".pi/extensions/good/panel.html": "<p>ok</p>",
      ".pi/extensions/bad/package.json": JSON.stringify({ name: "bad", boring: { iframePanels: [{ id: "main", title: "Main", entry: "../bad.html" }] } }),
    })
    const manager = new HostedPluginManager({ workspace })
    await manager.load()
    expect((await manager.list()).map((plugin) => plugin.id)).toEqual(["good"])
    expect(manager.getError("good")).toContain("boring.front ignored")
    expect(manager.getError("good")).toContain("boring.server ignored")
    expect(manager.getError("good")).toContain("pi contributions ignored")
    expect(manager.getError("bad")).toContain("INVALID_PATH")
  })

  it("rejects malformed core manifest fields even while ignoring native fields", async () => {
    const workspace = new MemoryWorkspace({
      ".pi/extensions/malformed/package.json": JSON.stringify({ version: 1, boring: { id: 123, iframePanels: [{ id: "main", title: "Main", entry: "panel.html" }] } }),
      ".pi/extensions/malformed/panel.html": "<p>ok</p>",
    })
    const manager = new HostedPluginManager({ workspace })
    await manager.load()
    expect(await manager.list()).toEqual([])
    expect(manager.getError("malformed")).toContain("INVALID_VERSION")
    expect(manager.getError("malformed")).toContain("INVALID_ID")
  })

  it("records diagnostics for native-only plugins ignored by hosted mode", async () => {
    const workspace = new MemoryWorkspace({
      ".pi/extensions/native/package.json": JSON.stringify({ name: "native", boring: { front: "front.tsx", server: "server.ts" }, pi: { extensions: ["agent.ts"] } }),
    })
    const manager = new HostedPluginManager({ workspace })
    await manager.load()
    expect(await manager.list()).toEqual([])
    expect(manager.getError("native")).toContain("boring.front ignored")
    expect(manager.getError("native")).toContain("boring.server ignored")
    expect(manager.getError("native")).toContain("pi contributions ignored")
  })

  it("keeps the first duplicate panel as a diagnostic instead of dropping the plugin", async () => {
    const workspace = new MemoryWorkspace({
      ".pi/extensions/dupe/package.json": JSON.stringify({ name: "dupe", boring: { iframePanels: [
        { id: "main", title: "Main", entry: "panel.html" },
        { id: "main", title: "Duplicate", entry: "other.html" },
      ] } }),
      ".pi/extensions/dupe/panel.html": "<p>first</p>",
      ".pi/extensions/dupe/other.html": "<p>second</p>",
    })
    const manager = new HostedPluginManager({ workspace })
    await manager.load()
    const [plugin] = await manager.list()
    expect(plugin?.id).toBe("dupe")
    expect(plugin?.frontTarget?.kind).toBe("iframe")
    if (plugin?.frontTarget?.kind === "iframe") expect(plugin.frontTarget.panels).toHaveLength(1)
    expect(manager.getError("dupe")).toContain("duplicate hosted iframe panel id")
  })

  it("emits load/unload events with monotonic revisions on reload", async () => {
    const workspace = new MemoryWorkspace({
      ".pi/extensions/live/package.json": JSON.stringify({ name: "live", boring: { iframePanels: [{ id: "main", title: "Main", entry: "panel.html" }] } }),
      ".pi/extensions/live/panel.html": "<p>one</p>",
    })
    const manager = new HostedPluginManager({ workspace })
    await manager.load()
    const firstRevision = (await manager.list())[0]?.revision
    expect(firstRevision).toBe(1)
    const events: Array<{ type: string; revision: number }> = []
    const unsubscribe = manager.subscribe((event) => events.push({ type: event.type, revision: event.revision }))
    await workspace.writeFile(".pi/extensions/live/panel.html", "<p>two!!</p>")
    await manager.load()
    expect((await manager.list())[0]?.revision).toBe(2)
    await workspace.unlink(".pi/extensions/live/package.json")
    await manager.load()
    unsubscribe()
    expect(events).toEqual([
      { type: "boring.plugin.load", revision: 2 },
      { type: "boring.plugin.unload", revision: 3 },
    ])
  })

  it("rejects symlinked iframe documents", async () => {
    class SymlinkWorkspace extends MemoryWorkspace {
      async lstat(path: string): Promise<Lstat> {
        if (path.endsWith("panel.html")) return { kind: "symlink", size: 0, mtimeMs: 1 }
        return super.stat(path)
      }
    }
    const workspace = new SymlinkWorkspace({
      ".pi/extensions/link/package.json": JSON.stringify({ name: "link", boring: { iframePanels: [{ id: "main", title: "Main", entry: "panel.html" }] } }),
      ".pi/extensions/link/panel.html": "<p>secret</p>",
    })
    const manager = new HostedPluginManager({ workspace })
    await manager.load()
    expect(manager.getError("link")).toBe("HOSTED_PLUGIN_DOCUMENT_SYMLINK: panel.html")
  })

  it("sanitizes workspace adapter errors before exposing diagnostics", async () => {
    class LeakyWorkspace extends MemoryWorkspace {
      async stat(path: string): Promise<Stat> {
        if (path.endsWith("missing.html")) throw new Error("ENOENT /home/ubuntu/private/missing.html")
        return super.stat(path)
      }
    }
    const workspace = new LeakyWorkspace({
      ".pi/extensions/leaky/package.json": JSON.stringify({ name: "leaky", boring: { iframePanels: [{ id: "main", title: "Main", entry: "missing.html" }] } }),
    })
    const manager = new HostedPluginManager({ workspace })
    await manager.load()
    expect(manager.getError("leaky")).toBe("HOSTED_PLUGIN_DOCUMENT_NOT_FOUND: missing.html")
    expect(manager.getError("leaky")).not.toContain("/home/ubuntu")
  })

  it("rejects oversized iframe documents before reading them", async () => {
    const workspace = new MemoryWorkspace({
      ".pi/extensions/huge/package.json": JSON.stringify({ name: "huge", boring: { iframePanels: [{ id: "main", title: "Main", entry: "panel.html" }] } }),
      ".pi/extensions/huge/panel.html": "x".repeat(1024 * 1024 + 1),
    })
    const manager = new HostedPluginManager({ workspace })
    await manager.load()
    expect(await manager.list()).toEqual([])
    expect(manager.getError("huge")).toContain("HOSTED_PLUGIN_DOCUMENT_TOO_LARGE")
    expect(workspace.reads).toEqual([".pi/extensions/huge/package.json"])
  })
})

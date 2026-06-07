import { describe, expect, test } from "vitest"
import { join, resolve } from "node:path"
import {
  createCliPluginAssetManager,
  getGlobalPiExtensionsRoot,
  readCliPluginPiSnapshot,
  resolveCliBoringPluginDirs,
} from "../server/pluginDiscovery.js"
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"

async function makeTempDir(prefix: string): Promise<string> {
  return await mkdtemp(join(tmpdir(), prefix))
}

async function writeRuntimePlugin(dir: string, name: string, systemPrompt: string): Promise<void> {
  await mkdir(join(dir, "front"), { recursive: true })
  await writeFile(join(dir, "front", "index.tsx"), "export default function Plugin() { return null }\n", "utf8")
  await writeFile(join(dir, "package.json"), JSON.stringify({
    name,
    boring: { front: "front/index.tsx" },
    pi: { systemPrompt },
  }), "utf8")
}

async function writePiSettings(settingsPath: string, packages: string[]): Promise<void> {
  await mkdir(join(settingsPath, ".."), { recursive: true })
  await writeFile(settingsPath, JSON.stringify({ packages }), "utf8")
}

describe("plugin discovery helpers", () => {
  test("resolves the default global Pi extensions root", () => {
    expect(getGlobalPiExtensionsRoot({ globalRoot: "/tmp/custom-global" })).toBe(resolve("/tmp/custom-global"))
  })

  test("returns deduped global + workspace plugin source roots", () => {
    const workspaceRoot = "/tmp/workspace"
    expect(resolveCliBoringPluginDirs(workspaceRoot, { globalRoot: "/tmp/global-extensions", globalAgentRoot: "/tmp/global-agent" })).toEqual([
      { rootDir: resolve("/tmp/global-extensions"), kind: "external" },
      { rootDir: resolve("/tmp/global-agent", "npm"), kind: "external" },
      { rootDir: resolve("/tmp/global-agent", "git"), kind: "external" },
      { rootDir: resolve("/tmp/workspace", ".pi", "extensions"), kind: "external", workspaceId: resolve("/tmp/workspace") },
      { rootDir: resolve("/tmp/workspace", ".pi", "npm"), kind: "external", workspaceId: resolve("/tmp/workspace") },
      { rootDir: resolve("/tmp/workspace", ".pi", "git"), kind: "external", workspaceId: resolve("/tmp/workspace") },
    ])
  })

  test("reads plugin Pi snapshot from global and workspace roots", async () => {
    const root = await makeTempDir("boring-cli-plugin-roots-")
    const workspaceRoot = join(root, "workspace")
    const globalRoot = join(root, "global-extensions")
    const localPlugin = join(workspaceRoot, ".pi", "extensions", "local-plugin")
    const globalPlugin = join(globalRoot, "global-plugin")

    await mkdir(join(localPlugin, "front"), { recursive: true })
    await mkdir(join(localPlugin, "agent", "skills"), { recursive: true })
    await writeFile(join(localPlugin, "front", "index.tsx"), "export default function() { return null }\n", "utf8")
    await writeFile(join(localPlugin, "agent", "index.ts"), "export default function() {}\n", "utf8")
    await writeFile(join(localPlugin, "package.json"), JSON.stringify({
      name: "local-plugin",
      boring: { front: "front/index.tsx" },
      pi: { extensions: ["agent/index.ts"], skills: ["agent/skills"], systemPrompt: "Local prompt" },
    }), "utf8")

    await mkdir(join(globalPlugin, "front"), { recursive: true })
    await writeFile(join(globalPlugin, "front", "index.tsx"), "export default function() { return null }\n", "utf8")
    await writeFile(join(globalPlugin, "package.json"), JSON.stringify({
      name: "global-plugin",
      boring: { front: "front/index.tsx" },
      pi: { systemPrompt: "Global prompt" },
    }), "utf8")

    try {
      const snapshot = readCliPluginPiSnapshot(workspaceRoot, { globalRoot })
      expect(snapshot.additionalSkillPaths).toContain(resolve(localPlugin, "agent", "skills"))
      expect(snapshot.extensionPaths).toContain(resolve(localPlugin, "agent", "index.ts"))
      expect(snapshot.systemPromptAppend).toContain("Local prompt")
      expect(snapshot.systemPromptAppend).toContain("Global prompt")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("workspace-local Pi package source shadows a global package source with the same plugin id", async () => {
    const root = await makeTempDir("boring-cli-plugin-source-shadow-")
    const workspaceRoot = join(root, "workspace")
    const globalAgentRoot = join(root, "global-agent")
    const globalRoot = join(globalAgentRoot, "extensions")
    const globalPlugin = join(root, "global-source")
    const localPlugin = join(workspaceRoot, "plugins", "shadow-plugin")

    await writeRuntimePlugin(globalPlugin, "shadow-plugin", "Global shadow prompt")
    await writeRuntimePlugin(localPlugin, "shadow-plugin", "Local shadow prompt")
    await writePiSettings(join(globalAgentRoot, "settings.json"), [globalPlugin])
    await writePiSettings(join(workspaceRoot, ".pi", "settings.json"), ["../plugins/shadow-plugin"])

    try {
      const snapshot = readCliPluginPiSnapshot(workspaceRoot, { globalRoot, globalAgentRoot })
      expect(snapshot.systemPromptAppend).toContain("Local shadow prompt")
      expect(snapshot.systemPromptAppend).not.toContain("Global shadow prompt")

      const manager = createCliPluginAssetManager(workspaceRoot, { globalRoot, globalAgentRoot })
      await manager.load()
      expect(manager.list()).toEqual([expect.objectContaining({ id: "shadow-plugin" })])
      expect(manager.inspectLoaded()).toEqual([expect.objectContaining({ id: "shadow-plugin", rootDir: resolve(localPlugin) })])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("workspace-local collection plugin shadows a global collection plugin with the same id", async () => {
    const root = await makeTempDir("boring-cli-plugin-collection-shadow-")
    const workspaceRoot = join(root, "workspace")
    const globalRoot = join(root, "global-extensions")
    const globalPlugin = join(globalRoot, "shadow-plugin")
    const localPlugin = join(workspaceRoot, ".pi", "extensions", "shadow-plugin")

    await writeRuntimePlugin(globalPlugin, "shadow-plugin", "Global collection prompt")
    await writeRuntimePlugin(localPlugin, "shadow-plugin", "Local collection prompt")

    try {
      const snapshot = readCliPluginPiSnapshot(workspaceRoot, { globalRoot })
      expect(snapshot.systemPromptAppend).toContain("Local collection prompt")
      expect(snapshot.systemPromptAppend).not.toContain("Global collection prompt")

      const manager = createCliPluginAssetManager(workspaceRoot, { globalRoot })
      await manager.load()
      expect(manager.list()).toEqual([expect.objectContaining({ id: "shadow-plugin" })])
      expect(manager.inspectLoaded()).toEqual([expect.objectContaining({ id: "shadow-plugin", rootDir: resolve(localPlugin) })])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("workspace-local Pi package sources resolve relative to .pi/settings.json", async () => {
    const root = await makeTempDir("boring-cli-plugin-settings-relative-")
    const workspaceRoot = join(root, "host-workspace")
    const plugin = join(workspaceRoot, "plugins", "settings-plugin")

    await writeRuntimePlugin(plugin, "settings-plugin", "Settings prompt")
    await writePiSettings(join(workspaceRoot, ".pi", "settings.json"), ["../plugins/settings-plugin"])

    try {
      expect(resolveCliBoringPluginDirs(workspaceRoot, { globalRoot: join(root, "global-extensions") })).toContainEqual({
        rootDir: resolve(plugin),
        kind: "external",
        workspaceId: resolve(workspaceRoot),
      })
      const snapshot = readCliPluginPiSnapshot(workspaceRoot, { globalRoot: join(root, "global-extensions") })
      expect(snapshot.systemPromptAppend).toContain("Settings prompt")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("workspace-local Pi package sources support file: local entries", async () => {
    const root = await makeTempDir("boring-cli-plugin-settings-file-")
    const workspaceRoot = join(root, "host-workspace")
    const plugin = join(workspaceRoot, "plugins", "file-plugin")

    await writeRuntimePlugin(plugin, "file-plugin", "File prompt")
    await writePiSettings(join(workspaceRoot, ".pi", "settings.json"), ["file:../plugins/file-plugin"])

    try {
      const snapshot = readCliPluginPiSnapshot(workspaceRoot, { globalRoot: join(root, "global-extensions") })
      expect(snapshot.systemPromptAppend).toContain("File prompt")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("workspace-local Pi package sources ignore uninspectable package entries", async () => {
    const root = await makeTempDir("boring-cli-plugin-settings-uninspectable-")
    const workspaceRoot = join(root, "host-workspace")
    await writePiSettings(join(workspaceRoot, ".pi", "settings.json"), ["../missing", "npm:future-package"])

    try {
      const snapshot = readCliPluginPiSnapshot(workspaceRoot, { globalRoot: join(root, "global-extensions") })
      expect(snapshot.systemPromptAppend).toBeUndefined()
      const manager = createCliPluginAssetManager(workspaceRoot, { globalRoot: join(root, "global-extensions") })
      await manager.load()
      expect(manager.list()).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("plugin asset manager lists global plugins plus the current workspace's local plugins", async () => {
    const root = await makeTempDir("boring-cli-plugin-manager-")
    const globalRoot = join(root, "global-extensions")
    const workspaceA = join(root, "workspace-a")
    const workspaceB = join(root, "workspace-b")
    const globalPlugin = join(globalRoot, "global-plugin")
    const localA = join(workspaceA, ".pi", "extensions", "local-a")
    const localB = join(workspaceB, ".pi", "extensions", "local-b")

    await mkdir(join(globalPlugin, "front"), { recursive: true })
    await writeFile(join(globalPlugin, "front", "index.tsx"), "export default function() { return null }\n", "utf8")
    await writeFile(join(globalPlugin, "package.json"), JSON.stringify({
      name: "global-plugin",
      boring: { front: "front/index.tsx" },
    }), "utf8")

    await mkdir(join(localA, "front"), { recursive: true })
    await writeFile(join(localA, "front", "index.tsx"), "export default function() { return null }\n", "utf8")
    await writeFile(join(localA, "package.json"), JSON.stringify({
      name: "local-a",
      boring: { front: "front/index.tsx" },
    }), "utf8")

    await mkdir(join(localB, "front"), { recursive: true })
    await writeFile(join(localB, "front", "index.tsx"), "export default function() { return null }\n", "utf8")
    await writeFile(join(localB, "package.json"), JSON.stringify({
      name: "local-b",
      boring: { front: "front/index.tsx" },
    }), "utf8")

    try {
      const managerA = createCliPluginAssetManager(workspaceA, { globalRoot })
      await managerA.load()
      expect(managerA.list().map((plugin) => plugin.id).sort()).toEqual(["global-plugin", "local-a"])

      const managerB = createCliPluginAssetManager(workspaceB, { globalRoot })
      await managerB.load()
      expect(managerB.list().map((plugin) => plugin.id).sort()).toEqual(["global-plugin", "local-b"])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

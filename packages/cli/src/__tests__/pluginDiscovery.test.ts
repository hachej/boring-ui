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
      { rootDir: resolve("/tmp/workspace", ".pi", "extensions"), kind: "external" },
      { rootDir: resolve("/tmp/workspace", ".pi", "npm"), kind: "external" },
      { rootDir: resolve("/tmp/workspace", ".pi", "git"), kind: "external" },
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

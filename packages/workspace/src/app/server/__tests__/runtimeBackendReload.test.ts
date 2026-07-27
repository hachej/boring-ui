import { ErrorCode } from "@hachej/boring-agent/shared"
import type { FastifyInstance } from "fastify"
import { existsSync } from "node:fs"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { scanBoringPlugins } from "../../../server/agentPlugins/scan"
import { createWorkspaceAgentServer, readPiSettingsBoringPluginSources } from "../createWorkspaceAgentServer"

const roots: string[] = []

async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function writeExternalPlugin(workspaceRoot: string, id: string, serverSource: string): Promise<string> {
  const pluginDir = join(workspaceRoot, ".pi", "extensions", id)
  await mkdir(pluginDir, { recursive: true })
  await writeFile(join(pluginDir, "package.json"), JSON.stringify({
    name: id,
    version: "1.0.0",
    boring: { server: "server.ts" },
  }), "utf8")
  await writeFile(join(pluginDir, "server.ts"), serverSource, "utf8")
  return pluginDir
}

async function writePiOnlyPackage(workspaceRoot: string): Promise<string> {
  const pluginDir = join(workspaceRoot, "plugins", "pi-smoke")
  await mkdir(join(pluginDir, "skills", "pi-smoke"), { recursive: true })
  await writeFile(join(pluginDir, "package.json"), JSON.stringify({
    name: "pi-smoke",
    version: "0.0.0",
    pi: {
      extensions: ["index.ts"],
      skills: ["skills"],
    },
  }), "utf8")
  await writeFile(join(pluginDir, "index.ts"), `
    export default function piSmoke(pi) {
      pi.registerTool({
        name: "pi_smoke_echo",
        description: "Pi package smoke test tool",
        parameters: { type: "object", properties: {} },
        execute: async () => ({ content: [{ type: "text", text: "PI_SMOKE_OK" }] }),
      })
    }
  `, "utf8")
  await writeFile(join(pluginDir, "skills", "pi-smoke", "SKILL.md"), [
    "---",
    "name: pi-smoke",
    "description: Pi package smoke skill.",
    "---",
    "",
    "Say PI_SMOKE_OK.",
  ].join("\n"), "utf8")
  return pluginDir
}

async function writeBoringOnlyPackage(workspaceRoot: string): Promise<string> {
  const pluginDir = join(workspaceRoot, "plugins", "boring-smoke")
  await mkdir(join(pluginDir, "front"), { recursive: true })
  await mkdir(join(pluginDir, "server"), { recursive: true })
  await writeFile(join(pluginDir, "package.json"), JSON.stringify({
    name: "boring-smoke",
    version: "0.0.0",
    type: "module",
    boring: {
      label: "Boring Smoke",
      front: "front/index.tsx",
      server: "server/index.ts",
    },
  }), "utf8")
  await writeFile(join(pluginDir, "front", "index.tsx"), 'export default definePlugin({ id: "boring-smoke" })\n', "utf8")
  await writeFile(join(pluginDir, "server", "index.ts"), `
    export default {
      routes(router) { router.get("/ping", () => ({ ok: true, plugin: "boring-smoke" })) },
    }
  `, "utf8")
  return pluginDir
}

async function writeProjectPiSettings(workspaceRoot: string, packages: string[]): Promise<void> {
  await mkdir(join(workspaceRoot, ".pi"), { recursive: true })
  await writeFile(join(workspaceRoot, ".pi", "settings.json"), JSON.stringify({ packages }, null, 2), "utf8")
}

describe("Pi settings plugin-source discovery", () => {
  test("workspace-local settings sources carry workspaceId so they shadow global externals", async () => {
    const root = await tempRoot("boring-runtime-settings-shadow-")
    const workspaceRoot = join(root, "workspace")
    const globalPlugin = join(root, "global", "shadow-plugin")
    const localPlugin = join(workspaceRoot, "plugins", "shadow-plugin")
    await mkdir(join(globalPlugin, "front"), { recursive: true })
    await mkdir(join(localPlugin, "front"), { recursive: true })
    for (const pluginRoot of [globalPlugin, localPlugin]) {
      await writeFile(join(pluginRoot, "front", "index.tsx"), 'export default definePlugin({ id: "shadow-plugin" })\n', "utf8")
      await writeFile(join(pluginRoot, "package.json"), JSON.stringify({
        name: "shadow-plugin",
        boring: { front: "front/index.tsx" },
      }), "utf8")
    }
    await mkdir(join(workspaceRoot, ".pi"), { recursive: true })
    await writeFile(join(workspaceRoot, ".pi", "settings.json"), JSON.stringify({
      packages: ["../plugins/shadow-plugin"],
    }), "utf8")

    const localSources = readPiSettingsBoringPluginSources(join(workspaceRoot, ".pi", "settings.json"), workspaceRoot)
    expect(localSources).toEqual([{ rootDir: localPlugin, kind: "external", workspaceId: workspaceRoot }])

    const scan = scanBoringPlugins([
      { rootDir: globalPlugin, kind: "external" },
      ...localSources,
    ])
    expect(scan.preflight.ok).toBe(true)
    expect(scan.plugins.map((plugin) => plugin.rootDir)).toEqual([localPlugin])
  })
})

describe("runtime backend integration with canonical reload", () => {
  test("reload discovers workspace-local Pi package sources for Pi resources and Boring runtime plugins", async () => {
    const workspaceRoot = await tempRoot("runtime-backend-pi-sources-")
    const app = await createWorkspaceAgentServer({ workspaceRoot, mode: "direct", logger: false, provisionWorkspace: false })
    try {
      await writePiOnlyPackage(workspaceRoot)
      await writeBoringOnlyPackage(workspaceRoot)
      await writeProjectPiSettings(workspaceRoot, [
        "../plugins/pi-smoke",
        "../plugins/boring-smoke",
      ])

      const reload = await app.inject({ method: "POST", url: "/api/v1/agent/reload", payload: {} })
      expect(reload.statusCode).toBe(200)

      const plugins = await app.inject({ method: "GET", url: "/api/v1/agent-plugins" })
      expect(plugins.statusCode).toBe(200)
      const pluginIds = plugins.json().map((plugin: { id: string }) => plugin.id)
      expect(pluginIds).toContain("boring-smoke")
      expect(pluginIds).not.toContain("pi-smoke")

      const ping = await app.inject({ method: "GET", url: "/api/v1/plugins/boring-smoke/ping" })
      expect(ping.statusCode).toBe(200)
      expect(ping.json()).toEqual({ ok: true, plugin: "boring-smoke" })

      const skills = await app.inject({ method: "GET", url: "/api/v1/agent/skills" })
      expect(skills.statusCode).toBe(200)
      const skillNames = skills.json().skills.map((skill: { name: string }) => skill.name)
      expect(skillNames).toContain("pi-smoke")

      expect(existsSync(join(workspaceRoot, ".pi", "boring-plugin-sources.json"))).toBe(false)
    } finally {
      await app.close()
    }
  }, 20_000)

  test("serves external boring.server handlers through the gateway and hot-reloads via /api/v1/agent/reload", async () => {
    const workspaceRoot = await tempRoot("runtime-backend-app-")
    const pluginDir = await writeExternalPlugin(workspaceRoot, "runtime-plugin", `
      export default {
        routes(router) { router.get("/value", () => ({ value: "one" })) },
      }
    `)
    const app = await createWorkspaceAgentServer({ workspaceRoot, mode: "direct", logger: false, provisionWorkspace: false })
    try {
      const first = await app.inject({ method: "GET", url: "/api/v1/plugins/runtime-plugin/value" })
      expect(first.statusCode).toBe(200)
      expect(first.json()).toEqual({ value: "one" })

      await writeFile(join(pluginDir, "server.ts"), `
        export default {
          routes(router) { router.get("/value", () => ({ value: "two" })) },
        }
      `, "utf8")
      const reload = await app.inject({ method: "POST", url: "/api/v1/agent/reload", payload: {} })
      expect(reload.statusCode).toBe(200)
      expect(reload.json().restart_warnings).toBeUndefined()

      const second = await app.inject({ method: "GET", url: "/api/v1/plugins/runtime-plugin/value" })
      expect(second.statusCode).toBe(200)
      expect(second.json()).toEqual({ value: "two" })

      await writeFile(join(pluginDir, "server.ts"), `export default { routes(router) { router.get("/value", () => ({ value: `, "utf8")
      const failedReload = await app.inject({ method: "POST", url: "/api/v1/agent/reload", payload: {} })
      expect(failedReload.statusCode).toBe(200)
      expect(failedReload.json().diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({ pluginId: "runtime-plugin", code: ErrorCode.enum.RUNTIME_PLUGIN_LOAD_FAILED }),
      ]))

      const afterFailure = await app.inject({ method: "GET", url: "/api/v1/plugins/runtime-plugin/value" })
      expect(afterFailure.statusCode).toBe(200)
      expect(afterFailure.json()).toEqual({ value: "two" })

      const oldReload = await app.inject({ method: "POST", url: "/api/boring.reload", payload: {} })
      expect(oldReload.statusCode).toBe(404)
    } finally {
      await app.close()
    }
  }, 20_000)

  test("removed external plugin unloads gateway handlers", async () => {
    const workspaceRoot = await tempRoot("runtime-backend-remove-")
    const pluginDir = await writeExternalPlugin(workspaceRoot, "removable-plugin", `
      export default { routes(router) { router.get("/value", () => ({ ok: true })) } }
    `)
    let app: FastifyInstance | null = await createWorkspaceAgentServer({ workspaceRoot, mode: "direct", logger: false, provisionWorkspace: false })
    try {
      expect((await app.inject({ method: "GET", url: "/api/v1/plugins/removable-plugin/value" })).statusCode).toBe(200)
      await rm(pluginDir, { recursive: true, force: true })
      const reload = await app.inject({ method: "POST", url: "/api/v1/agent/reload", payload: {} })
      expect(reload.statusCode).toBe(200)
      const after = await app.inject({ method: "GET", url: "/api/v1/plugins/removable-plugin/value" })
      expect(after.statusCode).toBe(404)
      expect(after.json().error.code).toBe(ErrorCode.enum.RUNTIME_PLUGIN_NOT_FOUND)
    } finally {
      await app?.close()
      app = null
    }
  }, 20_000)

  test("closes runtime backend registry when the Fastify app closes", async () => {
    const workspaceRoot = await tempRoot("runtime-backend-close-")
    const state = globalThis as typeof globalThis & { __runtimeBackendCloseHookDisposeCount?: number }
    state.__runtimeBackendCloseHookDisposeCount = 0
    const app = await createWorkspaceAgentServer({ workspaceRoot, mode: "direct", logger: false, provisionWorkspace: false })
    await writeExternalPlugin(workspaceRoot, "close-plugin", `
      export default {
        routes(router) { router.get("/value", () => ({ ok: true })) },
        dispose() { globalThis.__runtimeBackendCloseHookDisposeCount++ },
      }
    `)
    try {
      const reload = await app.inject({ method: "POST", url: "/api/v1/agent/reload", payload: {} })
      expect(reload.statusCode).toBe(200)
      expect((await app.inject({ method: "GET", url: "/api/v1/plugins/close-plugin/value" })).statusCode).toBe(200)
    } finally {
      await app.close()
    }
    expect(state.__runtimeBackendCloseHookDisposeCount).toBe(1)
  }, 20_000)
})

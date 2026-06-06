import { ErrorCode } from "@hachej/boring-agent/shared"
import type { FastifyInstance } from "fastify"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { createWorkspaceAgentServer } from "../createWorkspaceAgentServer"

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

async function writeFrontPlugin(root: string, id: string): Promise<void> {
  await mkdir(join(root, "front"), { recursive: true })
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: id,
    version: "1.0.0",
    boring: { front: "front/index.tsx" },
  }), "utf8")
  await writeFile(join(root, "front", "index.tsx"), `export default { id: '${id}' }\n`, "utf8")
}

async function writePluginSourceRecords(workspaceRoot: string, sources: Array<Record<string, unknown>>): Promise<void> {
  await mkdir(join(workspaceRoot, ".pi"), { recursive: true })
  await writeFile(join(workspaceRoot, ".pi", "boring-plugin-sources.json"), JSON.stringify({ version: 1, sources }), "utf8")
}

describe("runtime backend integration with canonical reload", () => {
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

  test("loads plugin source records added after boot on canonical reload", async () => {
    const workspaceRoot = await tempRoot("plugin-source-record-reload-")
    const pluginRoot = join(workspaceRoot, "plugins", "source-demo")
    const app = await createWorkspaceAgentServer({ workspaceRoot, mode: "direct", logger: false, provisionWorkspace: false })
    try {
      expect((await app.inject({ method: "GET", url: "/api/v1/agent-plugins" })).json()).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "source-demo" })]),
      )

      await writeFrontPlugin(pluginRoot, "source-demo")
      await writePluginSourceRecords(workspaceRoot, [{
        id: "source-demo",
        kind: "local",
        scope: "local",
        source: "/workspace/plugins/source-demo",
        rootDir: "/workspace/plugins/source-demo",
        sourceRelativeToWorkspace: "plugins/source-demo",
        rootDirRelativeToWorkspace: "plugins/source-demo",
        installedAt: "2026-01-01T00:00:00.000Z",
      }])
      const reload = await app.inject({ method: "POST", url: "/api/v1/agent/reload", payload: {} })
      expect(reload.statusCode).toBe(200)
      expect(reload.json().diagnostics).toBeUndefined()

      const plugins = (await app.inject({ method: "GET", url: "/api/v1/agent-plugins" })).json()
      expect(plugins).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: "source-demo",
          frontUrl: expect.stringContaining("/plugins/source-demo/front/index.tsx"),
        }),
      ]))
    } finally {
      await app.close()
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

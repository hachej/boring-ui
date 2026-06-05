import { ErrorCode } from "@hachej/boring-agent/shared"
import Fastify from "fastify"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import type { LoadedBoringPluginInspection } from "../../agentPlugins/manager"
import { defineRuntimeServerPlugin as defineRuntimeServerPluginFromSubpath } from "@hachej/boring-workspace/runtime-server"
import { defineRuntimeServerPlugin, validateRuntimeServerPlugin } from "../defineRuntimeServerPlugin"
import { captureRuntimeRoutes } from "../routerCapture"
import { runtimeBackendGateway } from "../runtimeBackendGateway"
import { RuntimeBackendError, RuntimeBackendRegistry } from "../runtimeBackendRegistry"

const tempDirs: string[] = []

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function writeRuntimeModule(root: string, source: string): Promise<string> {
  const serverPath = join(root, "server.ts")
  await writeFile(serverPath, source, "utf8")
  return serverPath
}

function plugin(serverPath: string, overrides: Partial<LoadedBoringPluginInspection> = {}): LoadedBoringPluginInspection {
  return {
    id: "plain-plugin",
    version: "1.0.0",
    revision: 1,
    rootDir: join(serverPath, ".."),
    serverPath,
    source: { rootDir: join(serverPath, ".."), kind: "external" },
    ...overrides,
  }
}

describe("runtime backend server contract", () => {
  test("accepts plain default-export shaped objects and optional helper output", () => {
    const plain = validateRuntimeServerPlugin({ routes() {} })
    expect(typeof plain.routes).toBe("function")

    const helper = defineRuntimeServerPlugin({ routes() {} })
    expect(validateRuntimeServerPlugin(helper)).toBe(helper)

    const subpathHelper = defineRuntimeServerPluginFromSubpath({ routes() {} })
    expect(validateRuntimeServerPlugin(subpathHelper)).toBe(subpathHelper)
  })

  test("rejects invalid runtime modules", () => {
    expect(() => validateRuntimeServerPlugin({ id: "bad", routes() {} })).toThrow(/must not declare id/)
    expect(() => validateRuntimeServerPlugin(() => undefined)).toThrow(/plain object/)
    expect(() => validateRuntimeServerPlugin({ routes: true })).toThrow(/routes/)
  })

  test("captures only exact safe routes and rejects duplicates", async () => {
    await expect(captureRuntimeRoutes((router) => {
      router.get("/ok", () => ({ ok: true }))
      router.post("/ok", () => ({ ok: true }))
    })).resolves.toHaveLength(2)

    await expect(captureRuntimeRoutes((router) => {
      router.get("/items/:id", () => undefined)
    })).rejects.toThrow(/params/)
    await expect(captureRuntimeRoutes((router) => {
      router.get("/items/*", () => undefined)
    })).rejects.toThrow(/wildcards/)
    await expect(captureRuntimeRoutes((router) => {
      router.get("/../secret", () => undefined)
    })).rejects.toThrow(/\.\./)
    await expect(captureRuntimeRoutes((router) => {
      router.get("/dupe", () => undefined)
      router.get("/dupe", () => undefined)
    })).rejects.toThrow(/duplicate/)
  })
})

describe("RuntimeBackendRegistry", () => {
  test("loads plain modules, dispatches exact routes, and gates internal sources", async () => {
    const root = await tempDir("runtime-backend-plain-")
    const serverPath = await writeRuntimeModule(root, `
      export default {
        routes(router) {
          router.get("/messages", (ctx) => ({ pluginId: ctx.pluginId, path: ctx.path, query: ctx.query.get("q") }))
          router.post("/send", (ctx) => ({ body: ctx.body, header: ctx.headers.get("x-test") }))
        },
      }
    `)
    const registry = new RuntimeBackendRegistry()
    const result = await registry.reloadFromLoadedPlugins([
      plugin(serverPath),
      plugin(serverPath, { id: "internal-plugin", source: { rootDir: root, kind: "internal" } }),
    ])

    expect(result.diagnostics).toEqual([])
    expect(registry.listPluginIds()).toEqual(["plain-plugin"])
    await expect(registry.dispatch({
      pluginId: "plain-plugin",
      method: "GET",
      path: "/messages",
      query: new URLSearchParams("q=one"),
      headers: new Headers(),
      signal: new AbortController().signal,
      body: undefined,
      logger: console,
    })).resolves.toMatchObject({ status: 200, body: { pluginId: "plain-plugin", path: "/messages", query: "one" } })
    await expect(registry.dispatch({
      pluginId: "plain-plugin",
      method: "GET",
      path: "/missing",
      query: new URLSearchParams(),
      headers: new Headers(),
      signal: new AbortController().signal,
      body: undefined,
      logger: console,
    })).rejects.toMatchObject({ code: ErrorCode.enum.RUNTIME_PLUGIN_ROUTE_NOT_FOUND })
  })

  test("keeps the old snapshot live on reload failure and disposes on replace/remove/close", async () => {
    const root = await tempDir("runtime-backend-reload-")
    const serverPath = await writeRuntimeModule(root, `
      globalThis.__runtimeBackendDisposeCount = globalThis.__runtimeBackendDisposeCount ?? 0
      export default {
        routes(router) { router.get("/value", () => ({ value: "one" })) },
        dispose() { globalThis.__runtimeBackendDisposeCount++ },
      }
    `)
    const registry = new RuntimeBackendRegistry()
    await registry.reloadFromLoadedPlugins([plugin(serverPath)])

    await writeRuntimeModule(root, `export default { routes(router) { router.get("/value", () => ({ value: "two" })) }, dispose() { globalThis.__runtimeBackendDisposeCount++ } }`)
    await expect(registry.reloadFromLoadedPlugins([plugin(serverPath, { revision: 2 })])).resolves.toMatchObject({ ok: true })
    await expect(dispatchValue(registry)).resolves.toEqual({ value: "two" })

    await writeRuntimeModule(root, `export default { routes(router) { router.get("/value", () => ({ value: `)
    const failed = await registry.reloadFromLoadedPlugins([plugin(serverPath, { revision: 3 })])
    expect(failed.diagnostics[0]).toMatchObject({ code: ErrorCode.enum.RUNTIME_PLUGIN_LOAD_FAILED, pluginId: "plain-plugin" })
    await expect(dispatchValue(registry)).resolves.toEqual({ value: "two" })

    await registry.reloadFromLoadedPlugins([])
    expect(registry.listPluginIds()).toEqual([])
    await expect(dispatchValue(registry)).rejects.toMatchObject({ code: ErrorCode.enum.RUNTIME_PLUGIN_NOT_FOUND })
    await registry.close()
  })

  test("serializes concurrent reloads", async () => {
    const root = await tempDir("runtime-backend-concurrent-")
    const serverPath = await writeRuntimeModule(root, `export default { routes(router) { router.get("/value", () => ({ value: "ok" })) } }`)
    const registry = new RuntimeBackendRegistry()
    const [one, two] = await Promise.all([
      registry.reloadFromLoadedPlugins([plugin(serverPath)]),
      registry.reloadFromLoadedPlugins([plugin(serverPath)]),
    ])
    expect(one.ok).toBe(true)
    expect(two.ok).toBe(true)
    await expect(dispatchValue(registry)).resolves.toEqual({ value: "ok" })
  })

  test("rejects wrong workspace dispatches for workspace-scoped snapshots", async () => {
    const root = await tempDir("runtime-backend-workspace-")
    const serverPath = await writeRuntimeModule(root, `export default { routes(router) { router.get("/value", () => ({ ok: true })) } }`)
    const registry = new RuntimeBackendRegistry()
    await registry.reloadFromLoadedPlugins([plugin(serverPath, { source: { rootDir: root, kind: "external", workspaceId: "one" } })])
    await expect(registry.dispatch({
      pluginId: "plain-plugin",
      method: "GET",
      path: "/value",
      query: new URLSearchParams(),
      headers: new Headers(),
      signal: new AbortController().signal,
      body: undefined,
      logger: console,
      workspaceId: "two",
    })).rejects.toMatchObject({ code: ErrorCode.enum.RUNTIME_PLUGIN_NOT_FOUND })
  })
})

describe("runtimeBackendGateway", () => {
  test("dispatches through the gateway and returns stable errors", async () => {
    const root = await tempDir("runtime-backend-gateway-")
    const serverPath = await writeRuntimeModule(root, `
      export default {
        routes(router) {
          router.post("/echo", (ctx) => ({ body: ctx.body, query: ctx.query.get("q"), header: ctx.headers.get("x-test") }))
          router.get("/empty", () => undefined)
          router.get("/throws", () => { throw new Error("boom") })
          router.get("/bad-response", () => () => undefined)
          router.get("/health", () => ({ ok: true }))
        },
      }
    `)
    const registry = new RuntimeBackendRegistry()
    await registry.reloadFromLoadedPlugins([plugin(serverPath)])
    const app = Fastify({ logger: false })
    await app.register(runtimeBackendGateway, { registry })
    try {
      const ok = await app.inject({
        method: "POST",
        url: "/api/v1/plugins/plain-plugin/echo?q=one",
        headers: { "x-test": "yes" },
        payload: { hello: "world" },
      })
      expect(ok.statusCode).toBe(200)
      expect(ok.json()).toEqual({ body: { hello: "world" }, query: "one", header: "yes" })

      const empty = await app.inject({ method: "GET", url: "/api/v1/plugins/plain-plugin/empty" })
      expect(empty.statusCode).toBe(204)

      const thrown = await app.inject({ method: "GET", url: "/api/v1/plugins/plain-plugin/throws" })
      expect(thrown.statusCode).toBe(500)
      expect(thrown.json().error.code).toBe(ErrorCode.enum.RUNTIME_PLUGIN_HANDLER_FAILED)

      const badResponse = await app.inject({ method: "GET", url: "/api/v1/plugins/plain-plugin/bad-response" })
      expect(badResponse.statusCode).toBe(500)
      expect(badResponse.json().error.code).toBe(ErrorCode.enum.RUNTIME_PLUGIN_RESPONSE_UNSUPPORTED)

      const missing = await app.inject({ method: "GET", url: "/api/v1/plugins/plain-plugin/missing" })
      expect(missing.statusCode).toBe(404)
      expect(missing.json().error.code).toBe(ErrorCode.enum.RUNTIME_PLUGIN_ROUTE_NOT_FOUND)

      const unsafe = await app.inject({ method: "GET", url: "/api/v1/plugins/plain-plugin/../secret" })
      expect(unsafe.statusCode).toBe(404)
    } finally {
      await app.close()
    }
  })
})

async function dispatchValue(registry: RuntimeBackendRegistry): Promise<unknown> {
  const response = await registry.dispatch({
    pluginId: "plain-plugin",
    method: "GET",
    path: "/value",
    query: new URLSearchParams(),
    headers: new Headers(),
    signal: new AbortController().signal,
    body: undefined,
    logger: console,
  })
  return response.body
}

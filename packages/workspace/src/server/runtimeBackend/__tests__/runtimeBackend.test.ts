import { ErrorCode } from "@hachej/boring-agent/shared"
import Fastify, { type FastifyInstance } from "fastify"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { request as httpRequest } from "node:http"
import type { AddressInfo } from "node:net"
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
      router.get("/./secret", () => undefined)
    })).rejects.toThrow(/must not contain \. segments/)
    await expect(captureRuntimeRoutes((router) => {
      router.get("/../secret", () => undefined)
    })).rejects.toThrow(/\.\./)
    await expect(captureRuntimeRoutes((router) => {
      router.get("/%2e/secret", () => undefined)
    })).rejects.toThrow(/must not contain \. segments/)
    await expect(captureRuntimeRoutes((router) => {
      router.get("/bad\\path", () => undefined)
    })).rejects.toThrow(/backslashes/)
    await expect(captureRuntimeRoutes((router) => {
      router.get("/%5csecret", () => undefined)
    })).rejects.toThrow(/backslashes/)
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

  test("rejects missing and wrong workspace dispatches for workspace-scoped snapshots", async () => {
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
    })).rejects.toMatchObject({ code: ErrorCode.enum.RUNTIME_PLUGIN_NOT_FOUND })
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

  test("rejects unsafe raw gateway tails before dispatch", async () => {
    const dispatchedPaths: string[] = []
    const registry = {
      dispatch: async (request: { path: string }) => {
        dispatchedPaths.push(request.path)
        return { status: 200, headers: {}, body: { path: request.path } }
      },
    } as unknown as RuntimeBackendRegistry
    const app = Fastify({ logger: false })
    await app.register(runtimeBackendGateway, { registry })
    try {
      for (const [path, message] of [
        ["/api/v1/plugins/p/./secret", "runtime backend route path must not contain . segments"],
        ["/api/v1/plugins/p/%2e/secret", "runtime backend route path must not contain . segments"],
        ["/api/v1/plugins/p/%5csecret", "runtime backend route path must not contain backslashes"],
      ] as const) {
        const response = await rawHttpRequest(app, path)
        expect(response.statusCode).toBe(404)
        expect(response.json()).toEqual({
          error: {
            code: ErrorCode.enum.RUNTIME_PLUGIN_ROUTE_NOT_FOUND,
            message,
          },
        })
      }
      expect(dispatchedPaths).toEqual([])
    } finally {
      await app.close()
    }
  })

  test("rejects workspace-scoped snapshots without a workspace header through the gateway", async () => {
    const root = await tempDir("runtime-backend-gateway-workspace-")
    const serverPath = await writeRuntimeModule(root, `export default { routes(router) { router.get("/value", () => ({ ok: true })) } }`)
    const registry = new RuntimeBackendRegistry()
    await registry.reloadFromLoadedPlugins([plugin(serverPath, { source: { rootDir: root, kind: "external", workspaceId: "one" } })])
    const app = Fastify({ logger: false })
    await app.register(runtimeBackendGateway, { registry })
    try {
      const missing = await app.inject({ method: "GET", url: "/api/v1/plugins/plain-plugin/value" })
      expect(missing.statusCode).toBe(404)
      expect(missing.json().error.code).toBe(ErrorCode.enum.RUNTIME_PLUGIN_NOT_FOUND)

      const ok = await app.inject({ method: "GET", url: "/api/v1/plugins/plain-plugin/value", headers: { "x-boring-workspace-id": "one" } })
      expect(ok.statusCode).toBe(200)
      expect(ok.json()).toEqual({ ok: true })
    } finally {
      await app.close()
    }
  })

  test("preserves exact raw route tails before dispatch", async () => {
    const root = await tempDir("runtime-backend-gateway-tail-")
    const serverPath = await writeRuntimeModule(root, `
      export default {
        routes(router) {
          router.get("/", () => ({ route: "root" }))
          router.get("/double", () => ({ route: "double" }))
          router.get("/secret", () => ({ route: "secret" }))
        },
      }
    `)
    const registry = new RuntimeBackendRegistry()
    await registry.reloadFromLoadedPlugins([plugin(serverPath, { id: "p" })])
    const app = Fastify({ logger: false })
    await app.register(runtimeBackendGateway, { registry })
    try {
      const rootWithSlash = await rawHttpRequest(app, "/api/v1/plugins/p/")
      expect(rootWithSlash.statusCode).toBe(200)
      expect(rootWithSlash.json()).toEqual({ route: "root" })

      const rootWithoutSlash = await rawHttpRequest(app, "/api/v1/plugins/p")
      expect(rootWithoutSlash.statusCode).toBe(200)
      expect(rootWithoutSlash.json()).toEqual({ route: "root" })

      const doubleSlash = await rawHttpRequest(app, "/api/v1/plugins/p//double")
      expect(doubleSlash.statusCode).toBe(404)
      expect(doubleSlash.json()).toEqual({
        error: {
          code: ErrorCode.enum.RUNTIME_PLUGIN_ROUTE_NOT_FOUND,
          message: "runtime backend route not found: GET //double",
        },
      })

      const dotSegment = await rawHttpRequest(app, "/api/v1/plugins/p/a/../secret")
      expect(dotSegment.statusCode).toBe(404)
      expect(dotSegment.json()).toEqual({
        error: {
          code: ErrorCode.enum.RUNTIME_PLUGIN_ROUTE_NOT_FOUND,
          message: "runtime backend route path must not contain .. segments",
        },
      })

      for (const path of [
        "/api/v1/plugins/p/a/%2e%2e/secret",
        "/api/v1/plugins/p/a/%2E%2E/secret",
        "/api/v1/plugins/p/%2e%2e/secret",
      ]) {
        const encoded = await rawHttpRequest(app, path)
        expect(encoded.statusCode).toBe(404)
        expect(encoded.json()).toEqual({
          error: {
            code: ErrorCode.enum.RUNTIME_PLUGIN_ROUTE_NOT_FOUND,
            message: "runtime backend route path must not contain .. segments",
          },
        })
      }
    } finally {
      await app.close()
    }
  })
})

async function rawHttpRequest(app: FastifyInstance, path: string): Promise<{ statusCode: number, body: string, json: () => unknown }> {
  if (!app.server.listening) await app.listen({ host: "127.0.0.1", port: 0 })
  const address = app.server.address() as AddressInfo
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port: address.port, method: "GET", path }, (res) => {
      let body = ""
      res.setEncoding("utf8")
      res.on("data", (chunk) => { body += chunk })
      res.on("end", () => resolve({
        statusCode: res.statusCode ?? 0,
        body,
        json: () => JSON.parse(body),
      }))
    })
    req.on("error", reject)
    req.end()
  })
}

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

// @vitest-environment node

import Fastify from "fastify"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AppRunnerClient } from "../appRunnerClient"
import { appRunnerRoutes } from "../appRunnerRoutes"
import { MemoryAppRunnerStore } from "./memoryAppRunnerStore"
import { APP_RUNNER_AUTH_SECRET_HEADER, APP_RUNNER_USER_HEADER, APP_RUNNER_WORKSPACE_HEADER } from "../../shared/constants"

describe("appRunnerRoutes", () => {
  const apps: Array<ReturnType<typeof Fastify>> = []

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()))
    apps.length = 0
  })

  async function buildApp(fetchImpl: typeof fetch) {
    const app = Fastify()
    apps.push(app)
    const client = new AppRunnerClient({ baseUrl: "http://127.0.0.1:9877", token: "tok", authSecret: "dev-secret", fetchImpl })
    await app.register(appRunnerRoutes, { workspaceRoot: "/tmp/ws-root", client, store: new MemoryAppRunnerStore() })
    await app.ready()
    return app
  }

  it("GET /apps/:appName/logs returns the runner's {lines, errors} shape and forwards identity headers", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ lines: ["boot", "ready"], errors: ["TypeError: x is not a function"] }), { status: 200 }),
    )
    const app = await buildApp(fetchImpl as unknown as typeof fetch)

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/plugins/app-runner/apps/myapp/logs",
      headers: { "x-boring-workspace-id": "ws-1", "x-boring-user-id": "user-1", "x-boring-user-email": "u@example.com" },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ lines: ["boot", "ready"], errors: ["TypeError: x is not a function"] })
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe("http://127.0.0.1:9877/w/ws-1/myapp/logs")
    const headers = init!.headers as Record<string, string>
    expect(headers[APP_RUNNER_WORKSPACE_HEADER]).toBe("ws-1")
    expect(JSON.parse(headers[APP_RUNNER_USER_HEADER]!)).toEqual({ id: "user-1", name: "u@example.com", email: "u@example.com" })
  })

  it("does not send platform credentials on app-serving proxy requests", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok", { status: 200, headers: { "content-type": "text/plain" } }))
    const app = await buildApp(fetchImpl as unknown as typeof fetch)

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/plugins/app-runner/open/myapp/index.html",
      headers: { "x-boring-workspace-id": "ws-1", "x-boring-user-id": "user-1" },
    })

    expect(response.statusCode).toBe(200)
    const headers = fetchImpl.mock.calls[0]![1]!.headers as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
    expect(headers[APP_RUNNER_AUTH_SECRET_HEADER]).toBeUndefined()
    expect(headers[APP_RUNNER_WORKSPACE_HEADER]).toBe("ws-1")
    expect(JSON.parse(headers[APP_RUNNER_USER_HEADER]!)).toMatchObject({ id: "user-1" })
  })

  it("GET /apps/:appName/logs surfaces runner errors with their status", async () => {
    const fetchImpl = vi.fn(async () => new Response("unknown app", { status: 404 }))
    const app = await buildApp(fetchImpl as unknown as typeof fetch)

    const response = await app.inject({ method: "GET", url: "/api/v1/plugins/app-runner/apps/nope/logs" })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: "app_runner_error", message: "unknown app" })
  })
})

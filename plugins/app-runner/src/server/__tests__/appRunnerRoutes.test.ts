// @vitest-environment node

import Fastify from "fastify"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AppRunnerClient } from "../appRunnerClient"
import { appRunnerRoutes } from "../appRunnerRoutes"
import { MemoryAppRunnerStore } from "./memoryAppRunnerStore"
import { APP_RUNNER_USER_HEADER, APP_RUNNER_WORKSPACE_HEADER } from "../../shared/constants"
import { profileAppName } from "../profileAddress"

describe("appRunnerRoutes", () => {
  const apps: Array<ReturnType<typeof Fastify>> = []
  afterEach(async () => { await Promise.all(apps.map((app) => app.close())); apps.length = 0 })

  async function buildApp(fetchImpl: typeof fetch, store = new MemoryAppRunnerStore()) {
    const app = Fastify()
    apps.push(app)
    const client = new AppRunnerClient({ baseUrl: "http://127.0.0.1:9877", token: "tok", authSecret: "dev-secret", fetchImpl })
    app.addHook("onRequest", async (request) => {
      const id = request.headers["x-test-user"]
      if (typeof id === "string") (request as typeof request & { user?: { id: string } }).user = { id }
    })
    await app.register(appRunnerRoutes, { workspaceRoot: "/tmp/ws-root", client, store })
    await app.ready()
    return app
  }

  it("returns logs and forwards authenticated identity", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ lines: ["ready"], errors: [] })))
    const app = await buildApp(fetchImpl as unknown as typeof fetch)
    const response = await app.inject({ method: "GET", url: "/api/v1/plugins/app-runner/apps/myapp/logs" })
    expect(response.statusCode).toBe(200)
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe("http://127.0.0.1:9877/w/ws-root/myapp/logs")
    const headers = init!.headers as Record<string, string>
    expect(headers[APP_RUNNER_WORKSPACE_HEADER]).toBe("ws-root")
    expect(JSON.parse(headers[APP_RUNNER_USER_HEADER]!)).toEqual({ id: "local", name: "Local user" })
  })

  it("returns only signed cross-origin app and version-preview URLs", async () => {
    const store = new MemoryAppRunnerStore()
    await store.upsertApp({ appName: "myapp", workspaceId: "ws-root", kind: "app", version: 2, sha: "abc", url: "old", updatedAt: "now" })
    const fetchImpl = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith("/current")) return new Response(JSON.stringify({ version: 2, kind: "app", sha: "abc", contentSha: "content", manifest: { tools: [] } }))
      if (url.endsWith("/versions")) return new Response(JSON.stringify({ versions: [
        { version: 2, kind: "app", sha: "abc", created_at: "now", current: true },
        { version: 1, kind: "app", sha: "def", created_at: "before", current: false },
      ] }))
      const version = new URL(url).searchParams.get("version")
      return new Response(JSON.stringify({ url: `http://127.0.0.1:9878/w/ws-root/myapp/${version ? `preview/${version}/` : ""}?t=signed-${version ?? "current"}` }))
    })
    const app = await buildApp(fetchImpl as unknown as typeof fetch, store)
    const listed = await app.inject({ method: "GET", url: "/api/v1/plugins/app-runner/apps" })
    expect(listed.json().apps[0].appUrl).toBe("http://127.0.0.1:9878/w/ws-root/myapp/?t=signed-current")
    const versions = await app.inject({ method: "GET", url: "/api/v1/plugins/app-runner/apps/myapp/versions" })
    expect(versions.json().versions.map((entry: { previewUrl: string }) => entry.previewUrl)).toEqual([
      "http://127.0.0.1:9878/w/ws-root/myapp/preview/2/?t=signed-2",
      "http://127.0.0.1:9878/w/ws-root/myapp/preview/1/?t=signed-1",
    ])
    expect(fetchImpl.mock.calls.every(([, init]) => (init?.headers as Record<string, string>).Authorization === "Bearer tok")).toBe(true)
  })

  it("does not register a host-origin app HTML proxy", async () => {
    const app = await buildApp(vi.fn() as unknown as typeof fetch)
    expect((await app.inject({ method: "GET", url: "/api/v1/plugins/app-runner/open/myapp/" })).statusCode).toBe(404)
    expect((await app.inject({ method: "GET", url: "/api/v1/plugins/app-runner/preview/myapp/1/" })).statusCode).toBe(404)
  })

  it("rejects management paths for another user's profile", async () => {
    const store = new MemoryAppRunnerStore()
    const victimProfile = profileAppName("victim")
    await store.upsertApp({ appName: victimProfile, workspaceId: "ws-root", ownerUserId: "victim", kind: "profile", version: 1, sha: "abc", url: "old", updatedAt: "now" })
    const fetchImpl = vi.fn(async () => new Response("should not dispatch"))
    const app = await buildApp(fetchImpl as unknown as typeof fetch, store)
    for (const request of [
      { method: "GET", url: `/api/v1/plugins/app-runner/apps/${victimProfile}/versions` },
      { method: "POST", url: `/api/v1/plugins/app-runner/apps/${victimProfile}/rollback` },
      { method: "POST", url: `/api/v1/plugins/app-runner/apps/${victimProfile}/activate`, payload: { version: 1 } },
      { method: "GET", url: `/api/v1/plugins/app-runner/apps/${victimProfile}/logs` },
      { method: "GET", url: `/api/v1/plugins/app-runner/apps/${victimProfile}/usage` },
    ] as const) {
      const response = await app.inject({ ...request, headers: { "x-test-user": "attacker" } })
      expect(response.statusCode).toBe(403)
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("surfaces runner errors with their status", async () => {
    const app = await buildApp(vi.fn(async () => new Response("unknown app", { status: 404 })) as unknown as typeof fetch)
    const response = await app.inject({ method: "GET", url: "/api/v1/plugins/app-runner/apps/nope/logs" })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: "app_runner_error", message: "unknown app" })
  })
})

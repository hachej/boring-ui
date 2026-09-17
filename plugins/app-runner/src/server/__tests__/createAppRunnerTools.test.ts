// @vitest-environment node

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ToolExecContext } from "@hachej/boring-workspace/shared"
import { AppRunnerClient } from "../appRunnerClient"
import { createAppRunnerTools, createPublishAppTool } from "../createAppRunnerTools"
import { MemoryAppRunnerStore } from "./memoryAppRunnerStore"
import { APP_RUNNER_AUTH_SECRET_HEADER } from "../../shared/constants"

function ctx(): ToolExecContext {
  return { abortSignal: new AbortController().signal, toolCallId: "call-1", workspaceId: "ws-1", userId: "user-1", userEmail: "user@example.com" }
}

function current(version = 1) {
  return { version, kind: "app", sha: "abc", contentSha: "content", manifest: { tools: [] } }
}

describe("createAppRunnerTools", () => {
  let workspaceRoot: string

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "app-runner-test-"))
    await mkdir(join(workspaceRoot, "apps", "myapp"), { recursive: true })
    await writeFile(join(workspaceRoot, "apps", "myapp", "index.js"), "export default { fetch() { return new Response('ok') } }")
  })

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it("publishes kind, message, and the hidden repository commit sha", async () => {
    const fetchImpl = vi.fn(async (url: string, _init?: RequestInit) => url.endsWith("/current")
      ? new Response(JSON.stringify(current(3)), { status: 200 })
      : new Response(JSON.stringify({ version: 3, url: "http://127.0.0.1:9877/w/ws-1/myapp/", sha: "abc", contentSha: "content", kind: "app", activated: true }), { status: 200 }))
    const client = new AppRunnerClient({ baseUrl: "http://127.0.0.1:9877", token: "tok", authSecret: "secret", fetchImpl: fetchImpl as typeof fetch })
    const store = new MemoryAppRunnerStore()

    const result = await createPublishAppTool({ workspaceRoot, client, store }).execute({ appName: "myapp", message: "Ship guestbook" }, ctx())

    expect(result.isError).toBeFalsy()
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe("http://127.0.0.1:9877/w/ws-1/myapp/publish")
    expect((init!.headers as Record<string, string>)[APP_RUNNER_AUTH_SECRET_HEADER]).toBe("secret")
    const body = JSON.parse(init!.body as string)
    expect(body).toMatchObject({ kind: "app", message: "Ship guestbook" })
    expect(body.sha).toMatch(/^[0-9a-f]{40}$/)
    expect(body.files["app/index.js"]).toContain("export default")
    expect(Object.keys(body.files).some((path) => path.includes(".git"))).toBe(false)
    expect((await store.listApps())[0]).toMatchObject({ appName: "myapp", workspaceId: "ws-1", version: 3, kind: "app" })
  })

  it("surfaces a 400 broken module response", async () => {
    const client = new AppRunnerClient({ fetchImpl: vi.fn(async () => new Response("broken module", { status: 400 })) })
    const result = await createPublishAppTool({ workspaceRoot, client, store: new MemoryAppRunnerStore() }).execute({ appName: "myapp" }, ctx())
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("400")
    expect(result.content[0]?.text).toContain("broken module")
  })

  it("reports a stored version with failed migration activation as an error", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      version: 4,
      url: "http://hub/w/ws-1/myapp/",
      sha: "abc",
      contentSha: "content",
      kind: "app",
      activated: false,
      activationError: "migration 0002 failed: no such table",
    }), { status: 200 }))
    const store = new MemoryAppRunnerStore()
    const result = await createPublishAppTool({
      workspaceRoot,
      client: new AppRunnerClient({ fetchImpl: fetchImpl as typeof fetch }),
      store,
    }).execute({ appName: "myapp" }, ctx())

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("migration 0002 failed")
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(await store.listApps()).toEqual([])
  })

  it("surfaces a runner 413 limit response", async () => {
    const client = new AppRunnerClient({ fetchImpl: vi.fn(async () => new Response("payload too large", { status: 413 })) })
    const result = await createPublishAppTool({ workspaceRoot, client, store: new MemoryAppRunnerStore() }).execute({ appName: "myapp" }, ctx())
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("413")
  })

  it("exposes profile lifecycle tools and no generic app dispatcher", () => {
    const tools = createAppRunnerTools({ workspaceRoot, client: new AppRunnerClient({ fetchImpl: vi.fn() }), store: new MemoryAppRunnerStore() })
    expect(tools.map((tool) => tool.name)).toContain("publish_profile")
    expect(tools.map((tool) => tool.name)).toContain("undo_profile")
    expect(tools.map((tool) => tool.name)).not.toContain("call_app_tool")
  })
})

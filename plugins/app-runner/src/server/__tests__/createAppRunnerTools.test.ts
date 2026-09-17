// @vitest-environment node

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ToolExecContext } from "@hachej/boring-workspace/shared"
import { AppRunnerClient } from "../appRunnerClient"
import { createAppRunnerTools, createPublishAppTool } from "../createAppRunnerTools"
import { MemoryAppRunnerStore } from "./memoryAppRunnerStore"
import { APP_RUNNER_MAX_FILE_BYTES, APP_RUNNER_MAX_FILES } from "../../shared/constants"

function ctx(overrides: Partial<ToolExecContext> = {}): ToolExecContext {
  return {
    abortSignal: new AbortController().signal,
    toolCallId: "call-1",
    workspaceId: "ws-1",
    ...overrides,
  }
}

describe("createAppRunnerTools", () => {
  let workspaceRoot: string

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "app-runner-test-"))
    await mkdir(join(workspaceRoot, "app"), { recursive: true })
    await writeFile(join(workspaceRoot, "app", "index.js"), "export default { fetch() { return new Response('ok') } }")
    await writeFile(join(workspaceRoot, "app", "index.html"), "<html></html>")
  })

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it("publish_app returns version/url on 200", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ version: 3, url: "http://127.0.0.1:9877/u/ws-1--myapp/app/", sha256: "abc" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    const client = new AppRunnerClient({ baseUrl: "http://127.0.0.1:9877", token: "tok", fetchImpl: fetchImpl as unknown as typeof fetch })
    const store = new MemoryAppRunnerStore()
    const tool = createPublishAppTool({ workspaceRoot, client, store })

    const result = await tool.execute({ appName: "MyApp" }, ctx())

    expect(result.isError).toBeFalsy()
    expect(result.content[0]?.text).toContain("version 3")
    expect(result.content[0]?.text).toContain("http://127.0.0.1:9877/u/ws-1--myapp/app/")

    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe("http://127.0.0.1:9877/u/ws-1--myapp/publish")
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer tok")
    const body = JSON.parse(init!.body as string) as { files: Record<string, string> }
    expect(body.files["app/index.js"]).toContain("export default")
    expect(body.files["app/index.html"]).toContain("<html>")

    const stored = await store.listApps()
    expect(stored).toEqual([{ appName: "MyApp", version: 3, url: "http://127.0.0.1:9877/u/ws-1--myapp/app/", updatedAt: expect.any(String) }])
  })

  it("publish_app surfaces the runner's error text on a 400 (broken module)", async () => {
    const fetchImpl = vi.fn(async () => new Response("SyntaxError: Unexpected token in app/index.js", { status: 400 }))
    const client = new AppRunnerClient({ baseUrl: "http://127.0.0.1:9877", token: "tok", fetchImpl })
    const store = new MemoryAppRunnerStore()
    const tool = createPublishAppTool({ workspaceRoot, client, store })

    const result = await tool.execute({ appName: "myapp" }, ctx())

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("400")
    expect(result.content[0]?.text).toContain("SyntaxError")
    expect(await store.listApps()).toEqual([])
  })

  it("publish_app rejects client-side before calling fetch when over the file-count limit", async () => {
    await rm(join(workspaceRoot, "app"), { recursive: true, force: true })
    await mkdir(join(workspaceRoot, "app"), { recursive: true })
    for (let i = 0; i < APP_RUNNER_MAX_FILES + 1; i++) {
      await writeFile(join(workspaceRoot, "app", `file-${i}.js`), "// x")
    }
    const fetchImpl = vi.fn()
    const client = new AppRunnerClient({ baseUrl: "http://127.0.0.1:9877", token: "tok", fetchImpl })
    const store = new MemoryAppRunnerStore()
    const tool = createPublishAppTool({ workspaceRoot, client, store })

    const result = await tool.execute({ appName: "myapp" }, ctx())

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain(`${APP_RUNNER_MAX_FILES}`)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("publish_app rejects client-side before calling fetch when a file is over the per-file byte limit", async () => {
    await writeFile(join(workspaceRoot, "app", "big.bin"), Buffer.alloc(APP_RUNNER_MAX_FILE_BYTES + 1, "a"))
    const fetchImpl = vi.fn()
    const client = new AppRunnerClient({ baseUrl: "http://127.0.0.1:9877", token: "tok", fetchImpl })
    const store = new MemoryAppRunnerStore()
    const tool = createPublishAppTool({ workspaceRoot, client, store })

    const result = await tool.execute({ appName: "myapp" }, ctx())

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("big.bin")
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("publish_app surfaces a runner-side 413 (over limits) when the runner rejects the request", async () => {
    const fetchImpl = vi.fn(async () => new Response("payload too large", { status: 413 }))
    const client = new AppRunnerClient({ baseUrl: "http://127.0.0.1:9877", token: "tok", fetchImpl })
    const store = new MemoryAppRunnerStore()
    const tool = createPublishAppTool({ workspaceRoot, client, store })

    const result = await tool.execute({ appName: "myapp" }, ctx())

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("413")
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("publish_app requires a non-empty appName", async () => {
    const client = new AppRunnerClient({ baseUrl: "http://127.0.0.1:9877", fetchImpl: vi.fn() })
    const tool = createPublishAppTool({ workspaceRoot, client, store: new MemoryAppRunnerStore() })

    const result = await tool.execute({ appName: "  " }, ctx())

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("appName")
  })

  it("createAppRunnerTools returns all four tools", () => {
    const client = new AppRunnerClient({ fetchImpl: vi.fn() })
    const tools = createAppRunnerTools({ workspaceRoot, client, store: new MemoryAppRunnerStore() })
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "activate_app_version",
      "list_app_versions",
      "publish_app",
      "rollback_app",
    ])
  })
})

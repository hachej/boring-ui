import { createHash } from "node:crypto"
import Fastify from "fastify"
import { describe, expect, it, vi } from "vitest"
import type { Stat, Workspace } from "@hachej/boring-agent/shared"
import { createTLStore } from "tldraw"
import { createCanvasTool, createTldrawAgentServerPlugin, nativeShapeSummary, validateActions } from "./index"

function blankNative(): string {
  const snapshot = createTLStore().getStoreSnapshot()
  return JSON.stringify({ tldrawFileFormatVersion: 1, schema: snapshot.schema, records: [] })
}

function workspaceFixture(initial = blankNative()) {
  let content = initial
  let current: Stat = { kind: "file", size: initial.length, mtimeMs: 1 }
  const workspace: Workspace = {
    root: "/workspace",
    runtimeContext: { runtimeCwd: "/workspace" },
    readFile: vi.fn(async () => content),
    writeFile: vi.fn(async (_path, data) => { content = data }),
    readFileWithStat: vi.fn(async () => ({ content, stat: current })),
    writeFileWithStat: vi.fn(async (_path, data) => {
      content = data
      current = { kind: "file", size: data.length, mtimeMs: current.mtimeMs + 1 }
      return current
    }),
    createBinaryFile: vi.fn(async (_path, data) => { content = new TextDecoder().decode(data); current = { kind: "file", size: data.length, mtimeMs: current.mtimeMs + 1 } }),
    unlink: vi.fn(async () => {}), readdir: vi.fn(async () => []), stat: vi.fn(async () => current),
    mkdir: vi.fn(async () => {}), rename: vi.fn(async () => {}),
  }
  return {
    workspace,
    get content() { return content },
    get stat() { return current },
    get revision() { return { size: current.size, mtimeMs: current.mtimeMs, sha256: createHash("sha256").update(content).digest("hex") } },
  }
}

async function connectClient(app: ReturnType<typeof Fastify>, clientId = "c") {
  const response = await app.inject({ method: "POST", url: "/api/v1/plugins/tldraw-agent/connect", payload: { path: "flow.tldraw", filesystem: "user", clientId } })
  expect(response.statusCode).toBe(200)
  const payload = response.json() as { ok: boolean; leaseGeneration?: number; leaseMs: number }
  return payload
}

function actionsUrl(clientId: string, leaseGeneration: number): string {
  return `/api/v1/plugins/tldraw-agent/actions?path=flow.tldraw&filesystem=user&clientId=${clientId}&leaseGeneration=${leaseGeneration}`
}

async function routeApp(workspace: Workspace, bridge = {
  postCommand: vi.fn(async () => ({ seq: 1, status: "ok" as const })),
}) {
  const app = Fastify()
  const plugin = createTldrawAgentServerPlugin({ workspace, bridge: bridge as never }) as unknown as {
    routes: Parameters<typeof app.register>[0]
    agentTools: ReturnType<typeof createCanvasTool>[]
  }
  await app.register(plugin.routes)
  await app.ready()
  return { app, tool: plugin.agentTools[0]!, bridge }
}

describe("edit_tldraw_canvas", () => {
  it("exposes a truthful discriminated action schema", () => {
    const tool = createCanvasTool(workspaceFixture().workspace)
    const schemas = (tool.parameters as { oneOf: Array<{ properties?: { actions?: { items: { oneOf: unknown[] } } } }> }).oneOf
    expect(schemas).toHaveLength(3)
    expect(schemas[2]?.properties?.actions?.items.oneOf).toHaveLength(8)
  })

  it("rejects operation fields that would otherwise be ignored", async () => {
    const tool = createCanvasTool(workspaceFixture().workspace)
    await expect(tool.execute({ operation: "read", path: "flow.tldraw", actions: [{ type: "clear" }] }, { toolCallId: "read" } as never)).resolves.toMatchObject({ isError: true })
    await expect(tool.execute({ operation: "create", path: "flow.tldraw", actions: [{ type: "clear" }] }, { toolCallId: "create" } as never)).resolves.toMatchObject({ isError: true })
    await expect(tool.execute({ operation: "edit", path: "flow.tldraw" }, { toolCallId: "edit" } as never)).resolves.toMatchObject({ isError: true })
  })

  it("returns bounded migrated-store metadata for model-visible reads", () => {
    expect(JSON.parse(nativeShapeSummary(blankNative()))).toEqual({ total: 0, returned: 0, truncated: false, shapes: [] })
  })

  it("rejects malformed and silent-no-op action variants", () => {
    expect(() => validateActions([{ type: "update", shape: {} }])).toThrow("requires valid id")
    expect(() => validateActions([{ type: "update", shape: { id: "a", target: "text" } }])).toThrow("mutable property")
    expect(() => validateActions([{ type: "update", shape: { id: "a", type: "text" } }])).toThrow()
    expect(() => validateActions([{ type: "create", shape: { id: "a", type: "text", x: 1, y: 2, h: 3 } }])).toThrow()
    expect(() => validateActions([{ type: "update", shape: { id: "a", target: "text", fill: "semi" } }])).toThrow()
    expect(() => validateActions([{ type: "distribute", ids: ["a", "b"], axis: "x" }])).toThrow("at least 3")
    expect(() => validateActions([{ type: "distribute", ids: ["a", "a", "b"], axis: "x" }])).toThrow("unique canonical ids")
    expect(() => validateActions([{ type: "distribute", ids: ["a", "shape:a", "b"], axis: "x" }])).toThrow("unique canonical ids")
    expect(() => validateActions([
      { type: "create", shape: { id: "a", type: "rectangle", x: 1, y: 2 } },
      { type: "create", shape: { id: "shape:a", type: "rectangle", x: 3, y: 4 } },
    ])).toThrow("unique canonical shape ids")
    expect(() => validateActions([{ type: "create", shape: { id: "a", type: "bogus", x: 1, y: 2 } }])).toThrow("valid type")
    expect(() => validateActions([{ type: "clear", extra: true }])).toThrow("additional")
  })

  it("rejects noncanonical aliases before routing or adapter access", async () => {
    const fixture = workspaceFixture()
    const tool = createCanvasTool(fixture.workspace)
    for (const path of ["./flow.tldraw", "dir\\flow.tldraw", "dir//flow.tldraw", "../flow.tldraw"]) {
      const output = await tool.execute({ operation: "read", path }, { toolCallId: path } as never)
      expect(output.isError).toBe(true)
    }
    expect(fixture.workspace.readFile).not.toHaveBeenCalled()
  })

  it("creates nested files through the adapter without overwriting", async () => {
    const fixture = workspaceFixture()
    const tool = createCanvasTool(fixture.workspace)
    const output = await tool.execute({ operation: "create", path: "diagrams/flow.tldraw" }, { toolCallId: "1" } as never)
    expect(output.isError).not.toBe(true)
    expect(fixture.workspace.mkdir).toHaveBeenCalledWith("diagrams", { recursive: true })
    expect(fixture.workspace.createBinaryFile).toHaveBeenCalledOnce()
  })

  it("rejects malformed native files before exposing them", async () => {
    const fixture = workspaceFixture("not-json")
    const { app } = await routeApp(fixture.workspace)
    const response = await app.inject({ method: "GET", url: "/api/v1/plugins/tldraw-agent/file?path=flow.tldraw&filesystem=user" })
    expect(response.statusCode).toBe(400)
    expect(response.json().error.message).toContain("invalid native tldraw file")
    await app.close()
  })

  it("binds filesystem, owner, batch, and revision on commit", async () => {
    const fixture = workspaceFixture()
    const { app } = await routeApp(fixture.workspace)
    const file = await app.inject({ method: "GET", url: "/api/v1/plugins/tldraw-agent/file?path=flow.tldraw&filesystem=user" })
    expect(file.statusCode).toBe(200)
    const revision = file.json().revision
    expect((await app.inject({ method: "POST", url: "/api/v1/plugins/tldraw-agent/connect", payload: { path: "flow.tldraw", filesystem: "company", clientId: "c" } })).statusCode).toBe(400)
    const lease = await connectClient(app)
    const rejected = await app.inject({ method: "POST", url: "/api/v1/plugins/tldraw-agent/commit", payload: { requestId: "manual-other", path: "flow.tldraw", filesystem: "user", clientId: "other", leaseGeneration: lease.leaseGeneration, json: blankNative(), expectedRevision: revision } })
    expect(rejected.statusCode).toBe(409)
    expect(rejected.json().written).toBe(false)
    expect(fixture.workspace.writeFileWithStat).not.toHaveBeenCalled()
    await app.close()
  })

  it("detects a stale content revision before optimistic write", async () => {
    const fixture = workspaceFixture()
    const { app } = await routeApp(fixture.workspace)
    const lease = await connectClient(app)
    const response = await app.inject({ method: "POST", url: "/api/v1/plugins/tldraw-agent/commit", payload: { requestId: "manual-conflict", path: "flow.tldraw", filesystem: "user", clientId: "c", leaseGeneration: lease.leaseGeneration, json: blankNative(), expectedRevision: { size: 999, mtimeMs: 1, sha256: "0".repeat(64) } } })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ written: false, error: { message: "file changed since it was loaded" } })
    expect(fixture.workspace.writeFileWithStat).not.toHaveBeenCalled()
    await app.close()
  })

  it("reports an unknown outcome when the provider mutates then rejects", async () => {
    const fixture = workspaceFixture()
    const write = vi.mocked(fixture.workspace.writeFileWithStat!).getMockImplementation()!
    vi.mocked(fixture.workspace.writeFileWithStat!).mockImplementation(async (path, data) => {
      await write(path, data)
      throw new Error("provider response lost after write")
    })
    const { app } = await routeApp(fixture.workspace)
    const lease = await connectClient(app)
    const response = await app.inject({ method: "POST", url: "/api/v1/plugins/tldraw-agent/commit", payload: { requestId: "manual-mutated-reject", path: "flow.tldraw", filesystem: "user", clientId: "c", leaseGeneration: lease.leaseGeneration, json: blankNative(), expectedRevision: fixture.revision } })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ written: "unknown", error: { message: "provider response lost after write" } })
    await app.close()
  })

  it("reports an unknown outcome when post-write verification rejects", async () => {
    const fixture = workspaceFixture()
    const read = vi.mocked(fixture.workspace.readFileWithStat!).getMockImplementation()!
    let reads = 0
    vi.mocked(fixture.workspace.readFileWithStat!).mockImplementation(async (path) => {
      reads += 1
      if (reads === 2) throw new Error("verification unavailable")
      return await read(path)
    })
    const { app } = await routeApp(fixture.workspace)
    const lease = await connectClient(app)
    const response = await app.inject({ method: "POST", url: "/api/v1/plugins/tldraw-agent/commit", payload: { requestId: "manual-verify-reject", path: "flow.tldraw", filesystem: "user", clientId: "c", leaseGeneration: lease.leaseGeneration, json: blankNative(), expectedRevision: fixture.revision } })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ written: "unknown", error: { message: "verification unavailable" } })
    await app.close()
  })

  it("detects an external overwrite during optimistic save verification", async () => {
    const fixture = workspaceFixture()
    const write = vi.mocked(fixture.workspace.writeFileWithStat!).getMockImplementation()!
    vi.mocked(fixture.workspace.writeFileWithStat!).mockImplementation(async (path, data) => {
      const stat = await write(path, data)
      await fixture.workspace.writeFile(path, `${data}\nexternal`)
      return stat
    })
    const { app } = await routeApp(fixture.workspace)
    const lease = await connectClient(app)
    const response = await app.inject({ method: "POST", url: "/api/v1/plugins/tldraw-agent/commit", payload: { requestId: "manual-overlap", path: "flow.tldraw", filesystem: "user", clientId: "c", leaseGeneration: lease.leaseGeneration, json: blankNative(), expectedRevision: fixture.revision } })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ written: true, error: { message: expect.stringContaining("reload required") } })
    await app.close()
  })

  it("does not expose a batch when the tool signal is already aborted", async () => {
    const fixture = workspaceFixture()
    const { app, tool } = await routeApp(fixture.workspace)
    const abort = new AbortController()
    abort.abort()
    await expect(tool.execute(
      { operation: "edit", path: "flow.tldraw", actions: [{ type: "clear" }] },
      { toolCallId: "call", abortSignal: abort.signal } as never,
    )).resolves.toMatchObject({ isError: true })
    const lease = await connectClient(app)
    const actions = await app.inject({ method: "GET", url: actionsUrl("c", lease.leaseGeneration!) })
    expect(actions.json().batches).toEqual([])
    await app.close()
  })

  it("opens an existing file before waiting for its edit batch to be claimed", async () => {
    const fixture = workspaceFixture()
    const { app, tool, bridge } = await routeApp(fixture.workspace)
    const abort = new AbortController()
    const toolPromise = tool.execute(
      { operation: "edit", path: "flow.tldraw", actions: [{ type: "clear" }] },
      { toolCallId: "open-before-edit", abortSignal: abort.signal } as never,
    )
    await vi.waitFor(() => expect(bridge.postCommand).toHaveBeenCalledWith({ kind: "openFile", params: { path: "flow.tldraw", filesystem: "user" } }))
    abort.abort()
    await expect(toolPromise).resolves.toMatchObject({ isError: true })
    await app.close()
  })

  it("fails edit immediately with an explicit open-tab precondition when no bridge exists", async () => {
    const fixture = workspaceFixture()
    const tool = createCanvasTool(fixture.workspace)
    await expect(tool.execute(
      { operation: "edit", path: "flow.tldraw", actions: [{ type: "clear" }] },
      { toolCallId: "no-bridge", abortSignal: new AbortController().signal } as never,
    )).resolves.toMatchObject({ isError: true, content: [{ text: expect.stringContaining("Open flow.tldraw") }] })
  })

  it("keeps a competing client non-owner until the current lease expires", async () => {
    const fixture = workspaceFixture()
    const { app } = await routeApp(fixture.workspace)
    const first = await app.inject({ method: "POST", url: "/api/v1/plugins/tldraw-agent/connect", payload: { path: "flow.tldraw", filesystem: "user", clientId: "owner" } })
    const second = await app.inject({ method: "POST", url: "/api/v1/plugins/tldraw-agent/connect", payload: { path: "flow.tldraw", filesystem: "user", clientId: "competitor" } })
    expect(first.json()).toMatchObject({ ok: true, leaseGeneration: expect.any(Number), leaseMs: 5_000 })
    expect(second.json()).toMatchObject({ ok: false, leaseMs: 5_000 })
    const rejected = await app.inject({ method: "POST", url: "/api/v1/plugins/tldraw-agent/commit", payload: { requestId: "competitor:1", path: "flow.tldraw", filesystem: "user", clientId: "competitor", leaseGeneration: first.json().leaseGeneration, json: blankNative(), expectedRevision: fixture.revision } })
    expect(rejected.statusCode).toBe(409)
    expect(rejected.json()).toMatchObject({ written: false, error: { message: "canvas owner lease is invalid" } })
    await app.close()
  })

  it("cancels an uncommitted batch and never exposes it afterward", async () => {
    const fixture = workspaceFixture()
    const { app, tool } = await routeApp(fixture.workspace)
    const abort = new AbortController()
    const toolPromise = tool.execute({ operation: "edit", path: "flow.tldraw", actions: [{ type: "clear" }] }, { toolCallId: "call", abortSignal: abort.signal } as never)
    abort.abort()
    await expect(toolPromise).resolves.toMatchObject({ isError: true })
    const lease = await connectClient(app)
    const actions = await app.inject({ method: "GET", url: actionsUrl("c", lease.leaseGeneration!) })
    expect(actions.json().batches).toEqual([])
    await app.close()
  })

  it("does not cancel a batch after its provider commit has started", async () => {
    const fixture = workspaceFixture()
    let releaseWrite!: () => void
    const write = vi.mocked(fixture.workspace.writeFileWithStat!).getMockImplementation()!
    vi.mocked(fixture.workspace.writeFileWithStat!).mockImplementation(async (path, data) => {
      await new Promise<void>((resolve) => { releaseWrite = resolve })
      return await write(path, data)
    })
    const { app, tool } = await routeApp(fixture.workspace)
    const lease = await connectClient(app)
    const abort = new AbortController()
    const toolPromise = tool.execute({ operation: "edit", path: "flow.tldraw", actions: [{ type: "clear" }] }, { toolCallId: "call", abortSignal: abort.signal } as never)
    const actions = await app.inject({ method: "GET", url: actionsUrl("c", lease.leaseGeneration!) })
    const commitPromise = app.inject({ method: "POST", url: "/api/v1/plugins/tldraw-agent/commit", payload: { requestId: `batch:${actions.json().batches[0].id}`, batchId: actions.json().batches[0].id, path: "flow.tldraw", filesystem: "user", clientId: "c", leaseGeneration: lease.leaseGeneration, json: blankNative(), expectedRevision: fixture.revision } })
    await vi.waitFor(() => expect(fixture.workspace.writeFileWithStat).toHaveBeenCalledOnce())
    abort.abort()
    releaseWrite()
    expect((await commitPromise).statusCode).toBe(200)
    await expect(toolPromise).resolves.toMatchObject({ content: [{ text: expect.stringContaining("Applied one action batch") }] })
    await app.close()
  })

  it("awaits the same in-flight batch commit for a duplicate stable request id", async () => {
    const fixture = workspaceFixture()
    let release!: () => void
    const write = vi.mocked(fixture.workspace.writeFileWithStat!).getMockImplementation()!
    vi.mocked(fixture.workspace.writeFileWithStat!).mockImplementation(async (path, data) => {
      await new Promise<void>((resolve) => { release = resolve })
      return await write(path, data)
    })
    const { app, tool } = await routeApp(fixture.workspace)
    const lease = await connectClient(app)
    const toolPromise = tool.execute({ operation: "edit", path: "flow.tldraw", actions: [{ type: "clear" }] }, { toolCallId: "call", abortSignal: new AbortController().signal } as never)
    const claimed = await app.inject({ method: "GET", url: actionsUrl("c", lease.leaseGeneration!) })
    const batchId = claimed.json().batches[0].id as string
    const payload = { requestId: `batch:${batchId}`, batchId, path: "flow.tldraw", filesystem: "user", clientId: "c", leaseGeneration: lease.leaseGeneration, json: blankNative(), expectedRevision: fixture.revision }
    const first = app.inject({ method: "POST", url: "/api/v1/plugins/tldraw-agent/commit", payload })
    await vi.waitFor(() => expect(fixture.workspace.writeFileWithStat).toHaveBeenCalledOnce())
    const retry = app.inject({ method: "POST", url: "/api/v1/plugins/tldraw-agent/commit", payload })
    release()
    const [one, two] = await Promise.all([first, retry])
    expect(two.json()).toEqual(one.json())
    expect(fixture.workspace.writeFileWithStat).toHaveBeenCalledOnce()
    await expect(toolPromise).resolves.toMatchObject({ content: [{ text: expect.stringContaining("Applied one action batch") }] })
    await app.close()
  })

  it("awaits the same in-flight manual commit for a duplicate stable request id", async () => {
    const fixture = workspaceFixture()
    let release!: () => void
    const write = vi.mocked(fixture.workspace.writeFileWithStat!).getMockImplementation()!
    vi.mocked(fixture.workspace.writeFileWithStat!).mockImplementation(async (path, data) => {
      await new Promise<void>((resolve) => { release = resolve })
      return await write(path, data)
    })
    const { app } = await routeApp(fixture.workspace)
    const lease = await connectClient(app)
    const payload = { requestId: "manual:1", path: "flow.tldraw", filesystem: "user", clientId: "c", leaseGeneration: lease.leaseGeneration, json: blankNative(), expectedRevision: fixture.revision }
    const first = app.inject({ method: "POST", url: "/api/v1/plugins/tldraw-agent/commit", payload })
    await vi.waitFor(() => expect(fixture.workspace.writeFileWithStat).toHaveBeenCalledOnce())
    const retry = app.inject({ method: "POST", url: "/api/v1/plugins/tldraw-agent/commit", payload })
    release()
    const [one, two] = await Promise.all([first, retry])
    expect(two.json()).toEqual(one.json())
    expect(fixture.workspace.writeFileWithStat).toHaveBeenCalledOnce()
    await app.close()
  })

  it("pins a lease generation through a delayed provider write before allowing takeover", async () => {
    let now = 1_000
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now)
    const fixture = workspaceFixture()
    let releaseWrite!: () => void
    const write = vi.mocked(fixture.workspace.writeFileWithStat!).getMockImplementation()!
    vi.mocked(fixture.workspace.writeFileWithStat!).mockImplementation(async (path, data) => {
      await new Promise<void>((resolve) => { releaseWrite = resolve })
      return await write(path, data)
    })
    const { app } = await routeApp(fixture.workspace)
    const owner = await connectClient(app, "owner")
    const commitPromise = app.inject({
      method: "POST", url: "/api/v1/plugins/tldraw-agent/commit",
      payload: { requestId: "delayed-owner", path: "flow.tldraw", filesystem: "user", clientId: "owner", leaseGeneration: owner.leaseGeneration, json: blankNative(), expectedRevision: fixture.revision },
    })
    await vi.waitFor(() => expect(fixture.workspace.writeFileWithStat).toHaveBeenCalledOnce())
    now += 6_000
    let takeoverSettled = false
    const takeoverPromise = app.inject({ method: "POST", url: "/api/v1/plugins/tldraw-agent/connect", payload: { path: "flow.tldraw", filesystem: "user", clientId: "competitor" } })
      .then((response) => { takeoverSettled = true; return response })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(takeoverSettled).toBe(false)
    releaseWrite()
    expect((await commitPromise).statusCode).toBe(200)
    const takeover = await takeoverPromise
    expect(takeover.json()).toMatchObject({ ok: true, leaseGeneration: expect.any(Number) })
    expect(takeover.json().leaseGeneration).not.toBe(owner.leaseGeneration)
    nowSpy.mockRestore()
    await app.close()
  })

  it("rejects an expired lease generation after ownership transfers", async () => {
    let now = 1_000
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now)
    const fixture = workspaceFixture()
    const { app } = await routeApp(fixture.workspace)
    const owner = await connectClient(app, "owner")
    now += 6_000
    const competitor = await connectClient(app, "competitor")
    expect(competitor.leaseGeneration).not.toBe(owner.leaseGeneration)
    const oldActions = await app.inject({ method: "GET", url: actionsUrl("owner", owner.leaseGeneration!) })
    expect(oldActions.json()).toEqual({ batches: [], leaseValid: false })
    const oldCommit = await app.inject({
      method: "POST", url: "/api/v1/plugins/tldraw-agent/commit",
      payload: { requestId: "expired-owner", path: "flow.tldraw", filesystem: "user", clientId: "owner", leaseGeneration: owner.leaseGeneration, json: blankNative(), expectedRevision: fixture.revision },
    })
    expect(oldCommit.statusCode).toBe(409)
    expect(oldCommit.json()).toMatchObject({ written: false, error: { message: "canvas owner lease is invalid" } })
    nowSpy.mockRestore()
    await app.close()
  })

  it("claims and commits a batch exactly once with an idempotent replay", async () => {
    const fixture = workspaceFixture()
    const { app, tool } = await routeApp(fixture.workspace)
    const lease = await connectClient(app)
    const toolPromise = tool.execute({ operation: "edit", path: "flow.tldraw", actions: [{ type: "clear" }] }, { toolCallId: "call", abortSignal: new AbortController().signal } as never)
    const claimUrl = actionsUrl("c", lease.leaseGeneration!)
    const actionResponse = await app.inject({ method: "GET", url: claimUrl })
    const batchId = actionResponse.json().batches[0].id as string
    const replayedClaim = await app.inject({ method: "GET", url: claimUrl })
    expect(replayedClaim.json().batches[0].id).toBe(batchId)
    const payload = { requestId: `batch:${batchId}`, batchId, path: "flow.tldraw", filesystem: "user", clientId: "c", leaseGeneration: lease.leaseGeneration, json: blankNative(), expectedRevision: fixture.revision }
    const first = await app.inject({ method: "POST", url: "/api/v1/plugins/tldraw-agent/commit", payload })
    const replay = await app.inject({ method: "POST", url: "/api/v1/plugins/tldraw-agent/commit", payload })
    expect(first.statusCode).toBe(200)
    expect(replay.statusCode).toBe(200)
    expect(replay.json()).toEqual(first.json())
    expect(fixture.workspace.writeFileWithStat).toHaveBeenCalledOnce()
    await expect(toolPromise).resolves.toMatchObject({ content: [{ text: expect.stringContaining("Applied one action batch") }] })
    await app.close()
  })
})

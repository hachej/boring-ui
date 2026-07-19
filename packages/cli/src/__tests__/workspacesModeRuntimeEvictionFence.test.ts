import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { expect, test, vi } from "vitest"
import type { LocalWorkspace } from "../server/localWorkspaces.js"
import { deferred, installCleanup, makeTempDir, writePlugin } from "./workspacesModeRuntimeEvictionFenceSupport.js"

installCleanup()

test("delayed warmup cannot resurrect a stale runtime target after eviction and re-add", async () => {
  vi.resetModules()
  const warmupEntered = deferred()
  const releaseWarmup = deferred()
  vi.doMock("../server/pluginFrontRuntime.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../server/pluginFrontRuntime.js")>()
    return {
      ...actual,
      createPluginFrontRuntimeHost: async (options?: Parameters<typeof actual.createPluginFrontRuntimeHost>[0]) => {
        const host = await actual.createPluginFrontRuntimeHost(options)
        return {
          ...host,
          warmupWorkspace: async (workspaceId: string) => {
            warmupEntered.resolve()
            await releaseWarmup.promise
            await host.warmupWorkspace(workspaceId)
          },
        }
      },
    }
  })

  const { createLocalWorkspaceRegistry } = await import("../server/localWorkspaces.js")
  const { createWorkspacesModeApp } = await import("../server/modeApps.js")
  const { registerStatic } = await import("../server/staticAssets.js")
  const homeRoot = await makeTempDir("boring-cli-evict-warmup-home-")
  const registryPath = join(await makeTempDir("boring-cli-evict-warmup-registry-"), "workspaces.yaml")
  const workspaceRoot = await makeTempDir("boring-cli-evict-warmup-workspace-")
  process.env.HOME = homeRoot
  await writePlugin(join(workspaceRoot, ".pi", "extensions", "warmup-plugin"), "warmup-plugin")
  const workspace = await createLocalWorkspaceRegistry(registryPath).add(workspaceRoot)
  const app = await createWorkspacesModeApp({ mode: "direct", registryPath, provisionWorkspace: false })
  const publicDir = await makeTempDir("boring-cli-evict-warmup-public-")
  await mkdir(join(publicDir, "assets"), { recursive: true })
  await writeFile(join(publicDir, "index.html"), "<!doctype html><div>SPA fallback must not serve runtime URLs</div>", "utf8")
  await registerStatic(app, publicDir)
  try {
    const list = await app.inject({ method: "GET", url: `/api/v1/agent-plugins?workspaceId=${workspace.id}` })
    const plugin = (list.json() as Array<{ id: string; frontTarget?: { entryUrl?: string } }>).find((item) => item.id === "warmup-plugin")
    expect(plugin?.frontTarget?.entryUrl).toBeTruthy()
    await warmupEntered.promise

    const remove = await app.inject({ method: "DELETE", url: `/api/v1/local-workspaces/${workspace.id}` })
    expect(remove.statusCode).toBe(200)
    releaseWarmup.resolve()
    await Promise.resolve()

    const staleRuntime = await app.inject({ method: "GET", url: plugin!.frontTarget!.entryUrl! })
    expect(staleRuntime.statusCode).toBe(404)
    expect(staleRuntime.body).not.toContain("SPA fallback must not serve runtime URLs")

    const readd = await app.inject({ method: "POST", url: "/api/v1/local-workspaces", payload: { path: workspaceRoot } })
    expect(readd.statusCode).toBe(200)
    const relisted = await app.inject({ method: "GET", url: `/api/v1/agent-plugins?workspaceId=${workspace.id}` })
    expect(relisted.statusCode).toBe(200)
    expect((relisted.json() as Array<{ id: string }>).map((item) => item.id)).toContain("warmup-plugin")
  } finally {
    releaseWarmup.resolve()
    await app.close()
  }
}, 20_000)

test("failed registry removal rolls back the fence and leaves the active target usable", async () => {
  vi.resetModules()
  const actualLocalWorkspaces = await vi.importActual<typeof import("../server/localWorkspaces.js")>("../server/localWorkspaces.js")
  const homeRoot = await makeTempDir("boring-cli-evict-fail-home-")
  const registryPath = join(await makeTempDir("boring-cli-evict-fail-registry-"), "workspaces.yaml")
  const workspaceRoot = await makeTempDir("boring-cli-evict-fail-workspace-")
  process.env.HOME = homeRoot
  await writePlugin(join(workspaceRoot, ".pi", "extensions", "rollback-plugin"), "rollback-plugin")
  const workspace = await actualLocalWorkspaces.createLocalWorkspaceRegistry(registryPath).add(workspaceRoot)
  let failNextRemove = true
  vi.doMock("../server/localWorkspaces.js", () => ({
    ...actualLocalWorkspaces,
    createLocalWorkspaceRegistry: (path: string) => {
      const registry = actualLocalWorkspaces.createLocalWorkspaceRegistry(path)
      if (path !== registryPath) return registry
      return {
        ...registry,
        remove: async (id: string): Promise<void> => {
          if (id === workspace.id && failNextRemove) {
            failNextRemove = false
            throw new Error("injected registry remove failure")
          }
          await registry.remove(id)
        },
      }
    },
  }))

  const { createWorkspacesModeApp } = await import("../server/modeApps.js")
  const app = await createWorkspacesModeApp({ mode: "direct", registryPath, provisionWorkspace: false })
  try {
    const before = await app.inject({ method: "GET", url: `/api/v1/agent-plugins?workspaceId=${workspace.id}` })
    const plugin = (before.json() as Array<{ id: string; frontTarget?: { entryUrl?: string } }>).find((item) => item.id === "rollback-plugin")
    expect(plugin?.frontTarget?.entryUrl).toBeTruthy()
    expect((await app.inject({ method: "GET", url: plugin!.frontTarget!.entryUrl! })).statusCode).toBe(200)

    const failedRemove = await app.inject({ method: "DELETE", url: `/api/v1/local-workspaces/${workspace.id}` })
    expect(failedRemove.statusCode).toBe(500)

    const after = await app.inject({ method: "GET", url: `/api/v1/agent-plugins?workspaceId=${workspace.id}` })
    expect(after.statusCode).toBe(200)
    const afterPlugin = (after.json() as Array<{ id: string; frontTarget?: { entryUrl?: string } }>).find((item) => item.id === "rollback-plugin")
    expect(afterPlugin?.frontTarget?.entryUrl).toBe(plugin!.frontTarget!.entryUrl)
    expect((await app.inject({ method: "GET", url: afterPlugin!.frontTarget!.entryUrl! })).statusCode).toBe(200)
  } finally {
    await app.close()
  }
}, 20_000)

test("queued same-path re-add waits for delete and then deliberately re-admits", async () => {
  vi.resetModules()
  const actualLocalWorkspaces = await vi.importActual<typeof import("../server/localWorkspaces.js")>("../server/localWorkspaces.js")
  const homeRoot = await makeTempDir("boring-cli-evict-queue-home-")
  const registryPath = join(await makeTempDir("boring-cli-evict-queue-registry-"), "workspaces.yaml")
  const workspaceRoot = await makeTempDir("boring-cli-evict-queue-workspace-")
  process.env.HOME = homeRoot
  await writePlugin(join(workspaceRoot, ".pi", "extensions", "queue-plugin"), "queue-plugin")
  const workspace = await actualLocalWorkspaces.createLocalWorkspaceRegistry(registryPath).add(workspaceRoot)
  const removeEntered = deferred()
  const releaseRemove = deferred()
  vi.doMock("../server/localWorkspaces.js", () => ({
    ...actualLocalWorkspaces,
    createLocalWorkspaceRegistry: (path: string) => {
      const registry = actualLocalWorkspaces.createLocalWorkspaceRegistry(path)
      if (path !== registryPath) return registry
      return {
        ...registry,
        remove: async (id: string): Promise<void> => {
          removeEntered.resolve()
          await releaseRemove.promise
          await registry.remove(id)
        },
      }
    },
  }))

  const { createWorkspacesModeApp } = await import("../server/modeApps.js")
  const app = await createWorkspacesModeApp({ mode: "direct", registryPath, provisionWorkspace: false })
  try {
    const remove = app.inject({ method: "DELETE", url: `/api/v1/local-workspaces/${workspace.id}` })
    await removeEntered.promise
    let readdSettled = false
    const readd = app.inject({ method: "POST", url: "/api/v1/local-workspaces", payload: { path: workspaceRoot } })
      .then((response) => { readdSettled = true; return response })
    await Promise.resolve()
    expect(readdSettled).toBe(false)

    releaseRemove.resolve()
    expect((await remove).statusCode).toBe(200)
    const readdResponse = await readd
    expect(readdResponse.statusCode).toBe(200)
    expect((readdResponse.json() as { workspace: LocalWorkspace }).workspace.id).toBe(workspace.id)
    const list = await app.inject({ method: "GET", url: `/api/v1/agent-plugins?workspaceId=${workspace.id}` })
    expect(list.statusCode).toBe(200)
    expect((list.json() as Array<{ id: string }>).map((item) => item.id)).toContain("queue-plugin")
  } finally {
    releaseRemove.resolve()
    await app.close()
  }
}, 20_000)

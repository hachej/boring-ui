import { mkdtemp, rm } from "node:fs/promises"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import Fastify from "fastify"
import type { RuntimeModeAdapter, WorkspaceAgentDispatcherResolver } from "@hachej/boring-agent/server"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const agentServerMock = vi.hoisted(() => ({
  createAgentApp: vi.fn(async () => ({
    register: vi.fn(async () => {}),
  })),
  provisionRuntimeWorkspace: vi.fn(async () => {}),
  provisionWorkspaceRuntime: vi.fn(async () => undefined),
}))

const uiBridgeMock = vi.hoisted(() => ({
  registerWorkspaceUiBridge: vi.fn(() => vi.fn()),
}))

vi.mock("@hachej/boring-agent/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hachej/boring-agent/server")>()
  return {
    ...actual,
    createAgentApp: agentServerMock.createAgentApp,
    provisionRuntimeWorkspace: agentServerMock.provisionRuntimeWorkspace,
    provisionWorkspaceRuntime: agentServerMock.provisionWorkspaceRuntime,
  }
})

vi.mock("../../../shared/plugins/uiBridgeRegistry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../shared/plugins/uiBridgeRegistry")>()
  return {
    ...actual,
    registerWorkspaceUiBridge: uiBridgeMock.registerWorkspaceUiBridge,
  }
})

import { createWorkspaceAgentServer } from "../createWorkspaceAgentServer"

const tempDirs: string[] = []

beforeEach(() => {
  agentServerMock.createAgentApp.mockClear()
  agentServerMock.provisionRuntimeWorkspace.mockClear()
  agentServerMock.provisionWorkspaceRuntime.mockClear()
  uiBridgeMock.registerWorkspaceUiBridge.mockClear()
})

function mockCreateAgentAppOnce(factory: (opts?: unknown) => Promise<unknown>): void {
  agentServerMock.createAgentApp.mockImplementationOnce(factory as never)
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function createCountingModeAdapter(dispose: () => Promise<void> = vi.fn(async () => {})): RuntimeModeAdapter {
  return {
    id: "direct",
    async create(ctx) {
      expect(this).toBeDefined()
      return {
        storageRoot: ctx.workspaceRoot,
        runtimeContext: { runtimeCwd: ctx.workspaceRoot },
        workspace: {} as never,
        sandbox: {} as never,
        fileSearch: {} as never,
      }
    },
    dispose,
  }
}

async function createMockAgentAppOwningAdapter(opts: unknown): Promise<ReturnType<typeof Fastify>> {
  const agentOpts = opts as { runtimeModeAdapter?: RuntimeModeAdapter }
  const app = Fastify({ logger: false })
  app.addHook("onClose", async () => {
    await agentOpts.runtimeModeAdapter?.dispose?.()
  })
  return app
}

describe("createWorkspaceAgentServer runtime adapter ownership", () => {
  test("passes one non-mutating owner adapter into createAgentApp and disposes underlying once", async () => {
    const dispose = vi.fn(async () => {})
    const runtimeModeAdapter = createCountingModeAdapter(dispose)
    const originalDispose = runtimeModeAdapter.dispose
    Object.freeze(runtimeModeAdapter)
    let passedAdapter: RuntimeModeAdapter | undefined
    mockCreateAgentAppOnce(async (opts: unknown) => {
      passedAdapter = (opts as { runtimeModeAdapter?: RuntimeModeAdapter }).runtimeModeAdapter
      return createMockAgentAppOwningAdapter(opts) as never
    })

    const app = await createWorkspaceAgentServer({
      workspaceRoot: await makeTempDir("boring-adapter-identity-"),
      logger: false,
      provisionWorkspace: false,
      runtimeModeAdapter,
    })

    expect(passedAdapter).toBeDefined()
    expect(passedAdapter).not.toBe(runtimeModeAdapter)
    expect(passedAdapter?.id).toBe(runtimeModeAdapter.id)
    expect(runtimeModeAdapter.dispose).toBe(originalDispose)
    await app.close()
    await app.close()
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  test("owner preserves underlying method this semantics for create and provisioning", async () => {
    const dispose = vi.fn(async () => {})
    const sourceThisValues: unknown[] = []
    const runtimeModeAdapter: RuntimeModeAdapter = {
      id: "direct",
      workspaceFsCapability: "strong",
      async create(ctx) {
        sourceThisValues.push(this)
        return {
          storageRoot: ctx.workspaceRoot,
          runtimeContext: { runtimeCwd: ctx.workspaceRoot },
          workspace: {} as never,
          sandbox: {} as never,
          fileSearch: {} as never,
        }
      },
      createProvisioningAdapter() {
        sourceThisValues.push(this)
        return {} as never
      },
      dispose,
    }
    Object.freeze(runtimeModeAdapter)
    mockCreateAgentAppOnce(async (opts: unknown) => {
      const owner = (opts as { runtimeModeAdapter?: RuntimeModeAdapter }).runtimeModeAdapter
      await owner?.create({ workspaceRoot: await makeTempDir("boring-adapter-create-this-"), sessionId: "default" })
      return createMockAgentAppOwningAdapter(opts) as never
    })

    const app = await createWorkspaceAgentServer({
      workspaceRoot: await makeTempDir("boring-adapter-this-"),
      logger: false,
      provisionWorkspace: true,
      runtimeModeAdapter,
    })
    await app.close()

    expect(sourceThisValues).toEqual([runtimeModeAdapter, runtimeModeAdapter])
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  test("validates runtime policy before process-global UI bridge registration", async () => {
    await expect(createWorkspaceAgentServer({
      workspaceRoot: await makeTempDir("boring-adapter-policy-validation-"),
      logger: false,
      provisionWorkspace: false,
      mode: "local",
      runtimeModeAdapter: createCountingModeAdapter(),
    })).rejects.toThrow("runtimeModeAdapter id direct does not match explicit mode local")

    expect(uiBridgeMock.registerWorkspaceUiBridge).not.toHaveBeenCalled()
    expect(agentServerMock.createAgentApp).not.toHaveBeenCalled()
  })

  test("does not double-dispose when dispatcher callback throws during agent app creation", async () => {
    const boom = new Error("dispatcher callback failed")
    const dispose = vi.fn(async () => {})
    const runtimeModeAdapter = createCountingModeAdapter(dispose)
    mockCreateAgentAppOnce(async (opts: unknown) => {
      const agentOpts = opts as {
        runtimeModeAdapter?: RuntimeModeAdapter
        onWorkspaceAgentDispatcher?: (resolver: WorkspaceAgentDispatcherResolver) => void
      }
      expect(agentOpts.runtimeModeAdapter).not.toBe(runtimeModeAdapter)
      try {
        agentOpts.onWorkspaceAgentDispatcher?.({ resolve: vi.fn() } as never)
      } catch (error) {
        await agentOpts.runtimeModeAdapter?.dispose?.()
        throw error
      }
      throw new Error("expected dispatcher callback to throw")
    })

    await expect(createWorkspaceAgentServer({
      workspaceRoot: await makeTempDir("boring-adapter-callback-failure-"),
      logger: false,
      provisionWorkspace: false,
      runtimeModeAdapter,
      onWorkspaceAgentDispatcher: () => { throw boom },
    })).rejects.toBe(boom)

    expect(dispose).toHaveBeenCalledTimes(1)
  })

  test("disposes exactly once when agent app creation rejects before owning cleanup runs", async () => {
    const boom = new Error("agent app creation failed")
    const dispose = vi.fn(async () => {})
    const runtimeModeAdapter = createCountingModeAdapter(dispose)
    mockCreateAgentAppOnce(async (opts: unknown) => {
      expect((opts as { runtimeModeAdapter?: RuntimeModeAdapter }).runtimeModeAdapter).not.toBe(runtimeModeAdapter)
      throw boom
    })

    await expect(createWorkspaceAgentServer({
      workspaceRoot: await makeTempDir("boring-adapter-app-failure-"),
      logger: false,
      provisionWorkspace: false,
      runtimeModeAdapter,
    })).rejects.toBe(boom)

    expect(dispose).toHaveBeenCalledTimes(1)
  })

  test("closes the created app and disposes exactly once when later route registration fails", async () => {
    const boom = new Error("route registration failed")
    const dispose = vi.fn(async () => {})
    const runtimeModeAdapter = createCountingModeAdapter(dispose)
    mockCreateAgentAppOnce(async (opts: unknown) => {
      expect((opts as { runtimeModeAdapter?: RuntimeModeAdapter }).runtimeModeAdapter).not.toBe(runtimeModeAdapter)
      return createMockAgentAppOwningAdapter(opts) as never
    })

    await expect(createWorkspaceAgentServer({
      workspaceRoot: await makeTempDir("boring-adapter-route-failure-"),
      logger: false,
      provisionWorkspace: false,
      runtimeModeAdapter,
      plugins: [{
        id: "failing-route-plugin",
        routes: async () => { throw boom },
      }],
    })).rejects.toBe(boom)

    expect(dispose).toHaveBeenCalledTimes(1)
  })

  test("falls back to adapter dispose when created app close throws before onClose", async () => {
    const boom = new Error("route registration failed")
    const closeFailure = new Error("close failed before onClose")
    const dispose = vi.fn(async () => {})
    const runtimeModeAdapter = createCountingModeAdapter(dispose)
    mockCreateAgentAppOnce(async () => ({
      addHook: vi.fn(),
      register: vi.fn(async () => { throw boom }),
      close: vi.fn(async () => { throw closeFailure }),
    }) as never)

    await expect(createWorkspaceAgentServer({
      workspaceRoot: await makeTempDir("boring-adapter-close-failure-"),
      logger: false,
      provisionWorkspace: false,
      runtimeModeAdapter,
    })).rejects.toBe(boom)

    expect(dispose).toHaveBeenCalledTimes(1)
  })

  test("does not double-dispose after a caller listen failure and close", async () => {
    const dispose = vi.fn(async () => {})
    const runtimeModeAdapter = createCountingModeAdapter(dispose)
    mockCreateAgentAppOnce(async (opts: unknown) => createMockAgentAppOwningAdapter(opts) as never)
    const blocker = Fastify({ logger: false })
    await blocker.listen({ host: "127.0.0.1", port: 0 })
    const port = (blocker.server.address() as AddressInfo).port
    const app = await createWorkspaceAgentServer({
      workspaceRoot: await makeTempDir("boring-adapter-listen-failure-"),
      logger: false,
      provisionWorkspace: false,
      runtimeModeAdapter,
    })

    try {
      await expect(app.listen({ host: "127.0.0.1", port })).rejects.toThrow()
    } finally {
      await app.close().catch(() => undefined)
      await blocker.close()
    }

    expect(dispose).toHaveBeenCalledTimes(1)
  })

  test("preserves the creation error and still calls failing adapter dispose exactly once", async () => {
    const boom = new Error("agent app creation failed before cleanup")
    const dispose = vi.fn(async () => { throw new Error("adapter dispose failed") })
    const runtimeModeAdapter = createCountingModeAdapter(dispose)
    mockCreateAgentAppOnce(async (opts: unknown) => {
      expect((opts as { runtimeModeAdapter?: RuntimeModeAdapter }).runtimeModeAdapter).not.toBe(runtimeModeAdapter)
      throw boom
    })

    await expect(createWorkspaceAgentServer({
      workspaceRoot: await makeTempDir("boring-adapter-dispose-failure-"),
      logger: false,
      provisionWorkspace: false,
      runtimeModeAdapter,
    })).rejects.toBe(boom)

    expect(dispose).toHaveBeenCalledTimes(1)
  })
})

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import Fastify from "fastify"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const agentServerMock = vi.hoisted(() => ({
  createAgentApp: vi.fn(async () => Fastify()),
  provisionRuntimeWorkspace: vi.fn(async () => {}),
  provisionWorkspaceRuntime: vi.fn(async () => undefined),
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

import { createWorkspaceAgentServer } from "../createWorkspaceAgentServer"

const tempDirs: string[] = []

beforeEach(() => {
  agentServerMock.createAgentApp.mockClear()
  agentServerMock.provisionRuntimeWorkspace.mockClear()
  agentServerMock.provisionWorkspaceRuntime.mockClear()
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function mockCreateAgentAppOnce(factory: (opts?: unknown) => Promise<unknown>): void {
  agentServerMock.createAgentApp.mockImplementationOnce(factory as never)
}

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

describe("createWorkspaceAgentServer — WorkspaceBridge RPC composition", () => {
  test("registers a demo handler and calls it through HTTP without shared singleton state", async () => {
    const { createTestBridgeOperationDefinition } = await import("../../../server/workspaceBridge/testing/harness")
    const workspaceA = { root: await makeTempDir("bridge-compose-a-") }
    const workspaceB = { root: await makeTempDir("bridge-compose-b-") }
    const definition = createTestBridgeOperationDefinition<{ value: string }, { value: string }>({
      op: "test.v1.composed",
      callerClassesAllowed: ["browser"],
      requiredCapabilities: ["test:composed"],
    })
    mockCreateAgentAppOnce(async () => Fastify())
    const appA = await createWorkspaceAgentServer({
      workspaceRoot: workspaceA.root,
      provisionWorkspace: false,
      workspaceBridge: { handlers: [{ definition, handler: ({ input }) => ({ value: `a:${(input as { value: string }).value}` }) }] },
    })
    mockCreateAgentAppOnce(async () => Fastify())
    const appB = await createWorkspaceAgentServer({
      workspaceRoot: workspaceB.root,
      provisionWorkspace: false,
      workspaceBridge: { handlers: [{ definition, handler: ({ input }) => ({ value: `b:${(input as { value: string }).value}` }) }] },
    })

    const callA = await appA.inject({
      method: "POST",
      url: "/api/v1/workspace-bridge/call",
      headers: { "content-type": "application/json" },
      payload: { op: "test.v1.composed", input: { value: "one" } },
    })
    const callB = await appB.inject({
      method: "POST",
      url: "/api/v1/workspace-bridge/call",
      headers: { "content-type": "application/json" },
      payload: { op: "test.v1.composed", input: { value: "one" } },
    })

    expect(callA.statusCode).toBe(200)
    expect(callB.statusCode).toBe(200)
    expect(callA.json()).toMatchObject({ ok: true, output: { value: "a:one" } })
    expect(callB.json()).toMatchObject({ ok: true, output: { value: "b:one" } })
    expect((appA as any).__boringWorkspaceBridgeRegistry).not.toBe((appB as any).__boringWorkspaceBridgeRegistry)

    await appA.close()
    await appB.close()
  })

  test("registers WorkspaceBridge handlers contributed by trusted server plugins", async () => {
    const { createTestBridgeOperationDefinition } = await import("../../../server/workspaceBridge/testing/harness")
    const { defineServerPlugin } = await import("../../../server")
    const definition = createTestBridgeOperationDefinition<{ value: string }, { value: string }>({
      op: "plugin.v1.echo",
      callerClassesAllowed: ["browser"],
      requiredCapabilities: ["plugin:echo"],
    })
    mockCreateAgentAppOnce(async () => Fastify())
    const app = await createWorkspaceAgentServer({
      workspaceRoot: await makeTempDir("bridge-plugin-handler-"),
      provisionWorkspace: false,
      plugins: [defineServerPlugin({
        id: "trusted-plugin",
        workspaceBridgeHandlers: [{ definition, handler: ({ input }) => ({ value: `plugin:${(input as { value: string }).value}` }) }],
      })],
    })

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/workspace-bridge/call",
      headers: { "content-type": "application/json" },
      payload: { op: "plugin.v1.echo", input: { value: "one" } },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ ok: true, output: { value: "plugin:one" } })
    await app.close()
  })

  test("rejects workspaceBridgeHandlers from untrusted directory-source server plugins", async () => {
    const workspaceRoot = await makeTempDir("bridge-untrusted-dir-workspace-")
    const dir = await makeTempDir("bridge-untrusted-dir-plugin-")
    await mkdir(join(dir, "src"), { recursive: true })
    await writeFile(join(dir, "package.json"), JSON.stringify({
      name: "untrusted-bridge-plugin",
      type: "module",
      boring: { server: "./src/server.js" },
    }), "utf8")
    await writeFile(join(dir, "src", "server.js"), `
export default {
  id: "untrusted-bridge-plugin",
  workspaceBridgeHandlers: [{
    definition: {
      op: "plugin.v1.untrusted",
      version: 1,
      owner: "untrusted-plugin",
      callerClassesAllowed: ["browser"],
      requiredCapabilities: [],
      inputSchema: { type: "object" },
      timeoutMs: 1000,
      maxInputBytes: 1024,
      maxOutputBytes: 1024,
      idempotencyPolicy: "none",
    },
    handler: () => ({ ok: true }),
  }],
}
`, "utf8")

    mockCreateAgentAppOnce(async () => Fastify())
    await expect(createWorkspaceAgentServer({
      workspaceRoot,
      provisionWorkspace: false,
      plugins: [{ dir, hotReload: true }],
    })).rejects.toThrow(/workspaceBridgeHandlers.*trust: "internal"/)
  })

  test.each(["direct", "local"] as const)("injects WorkspaceBridge runtime env for %s when configured", async (mode) => {
    const { createTestBridgeOperationDefinition } = await import("../../../server/workspaceBridge/testing/harness")
    const definition = createTestBridgeOperationDefinition({
      op: `test.v1.runtime-env.${mode}`,
      callerClassesAllowed: ["runtime"],
      requiredCapabilities: ["test:runtime-env"],
    })
    mockCreateAgentAppOnce(async () => Fastify())
    const app = await createWorkspaceAgentServer({
      workspaceRoot: await makeTempDir(`bridge-runtime-env-${mode}-`),
      mode,
      provisionWorkspace: false,
      workspaceBridge: {
        runtimeTokenSecret: "12345678901234567890123456789012",
        runtimeEnv: {
          bridgeUrl: "http://localhost:7777",
          allowInsecureHttp: true,
          capabilities: ["test:runtime-env"],
          sessionId: `session-${mode}`,
        },
        handlers: [{ definition, handler: () => ({ ok: true }) }],
      },
    })

    const [agentOptions] = agentServerMock.createAgentApp.mock.calls.at(-1) as unknown as [{
      runtimeEnvContributions?: Array<{ id: string; getEnv: () => Promise<Record<string, string>> | Record<string, string> }>
    }]
    const env = await agentOptions.runtimeEnvContributions?.find((entry) => entry.id === "workspace-bridge-runtime-env")?.getEnv()

    expect(env).toMatchObject({
      BORING_WORKSPACE_BRIDGE_URL: "http://localhost:7777/api/v1/workspace-bridge/call",
      BORING_WORKSPACE_ID: "default",
      BORING_AGENT_SESSION_ID: `session-${mode}`,
    })
    expect(env?.BORING_WORKSPACE_BRIDGE_TOKEN).toEqual(expect.any(String))
    expect(JSON.stringify({ tokenPresent: Boolean(env?.BORING_WORKSPACE_BRIDGE_TOKEN) })).not.toContain(env!.BORING_WORKSPACE_BRIDGE_TOKEN)
    await app.close()
  })



  test("injects WorkspaceBridge refresh token env when refresh secret is configured", async () => {
    const { createTestBridgeOperationDefinition } = await import("../../../server/workspaceBridge/testing/harness")
    const definition = createTestBridgeOperationDefinition({
      op: "test.v1.runtime-env-refresh",
      callerClassesAllowed: ["runtime"],
      requiredCapabilities: ["test:runtime-env"],
    })
    mockCreateAgentAppOnce(async () => Fastify())
    const app = await createWorkspaceAgentServer({
      workspaceRoot: await makeTempDir("bridge-runtime-env-refresh-"),
      mode: "direct",
      provisionWorkspace: false,
      workspaceBridge: {
        runtimeTokenSecret: "12345678901234567890123456789012",
        runtimeRefreshTokenSecret: "abcdefghijklmnopqrstuvwxyz1234567890",
        runtimeEnv: {
          bridgeUrl: "http://localhost:7777",
          allowInsecureHttp: true,
          capabilities: ["test:runtime-env"],
        },
        handlers: [{ definition, handler: () => ({ ok: true }) }],
      },
    })

    const [agentOptions] = agentServerMock.createAgentApp.mock.calls.at(-1) as unknown as [{
      runtimeEnvContributions?: Array<{ id: string; getEnv: () => Promise<Record<string, string>> | Record<string, string> }>
    }]
    const env = await agentOptions.runtimeEnvContributions?.find((entry) => entry.id === "workspace-bridge-runtime-env")?.getEnv()

    expect(env).toMatchObject({
      BORING_WORKSPACE_BRIDGE_URL: "http://localhost:7777/api/v1/workspace-bridge/call",
      BORING_WORKSPACE_BRIDGE_TOKEN_URL: "http://localhost:7777/api/v1/workspace-bridge/token",
      BORING_WORKSPACE_ID: "default",
    })
    expect(env?.BORING_WORKSPACE_BRIDGE_TOKEN).toEqual(expect.any(String))
    expect(env?.BORING_WORKSPACE_BRIDGE_REFRESH_TOKEN).toEqual(expect.any(String))
    await app.close()
  })

  test("requires explicit browser bridge auth in production", async () => {
    vi.stubEnv("NODE_ENV", "production")
    mockCreateAgentAppOnce(async () => Fastify())
    await expect(createWorkspaceAgentServer({
      workspaceRoot: await makeTempDir("bridge-prod-auth-"),
      provisionWorkspace: false,
    })).rejects.toThrow(/workspaceBridge\.browserAuthPolicy/)
  })

  test("disables WorkspaceBridge runtime env when capabilities are omitted", async () => {
    mockCreateAgentAppOnce(async () => Fastify())
    const app = await createWorkspaceAgentServer({
      workspaceRoot: await makeTempDir("bridge-runtime-env-missing-caps-"),
      mode: "direct",
      provisionWorkspace: false,
      workspaceBridge: {
        runtimeTokenSecret: "12345678901234567890123456789012",
        runtimeEnv: {
          bridgeUrl: "http://localhost:7777",
          allowInsecureHttp: true,
        },
      },
    })

    const [agentOptions] = agentServerMock.createAgentApp.mock.calls.at(-1) as unknown as [{
      runtimeEnvContributions?: Array<{ id: string; getEnv: () => Promise<Record<string, string>> | Record<string, string> }>
    }]
    const env = await agentOptions.runtimeEnvContributions?.find((entry) => entry.id === "workspace-bridge-runtime-env")?.getEnv()

    expect(env).toEqual({ BORING_WORKSPACE_BRIDGE_DISABLED: "runtime-capabilities-missing" })
    await app.close()
  })

  test("disables WorkspaceBridge runtime env for vercel sandbox without public HTTPS URL", async () => {
    mockCreateAgentAppOnce(async () => Fastify())
    const app = await createWorkspaceAgentServer({
      workspaceRoot: await makeTempDir("bridge-runtime-env-vercel-"),
      mode: "vercel-sandbox",
      provisionWorkspace: false,
      workspaceBridge: {
        runtimeTokenSecret: "12345678901234567890123456789012",
        runtimeEnv: { bridgeUrl: "http://localhost:7777", allowInsecureHttp: true, capabilities: ["test:runtime-env"] },
      },
    })

    const [agentOptions] = agentServerMock.createAgentApp.mock.calls.at(-1) as unknown as [{
      runtimeEnvContributions?: Array<{ id: string; getEnv: () => Promise<Record<string, string>> | Record<string, string> }>
    }]
    const env = await agentOptions.runtimeEnvContributions?.find((entry) => entry.id === "workspace-bridge-runtime-env")?.getEnv()

    expect(env).toEqual({ BORING_WORKSPACE_BRIDGE_DISABLED: "remote-bridge-url-must-be-https" })
    expect(JSON.stringify(env)).not.toContain("12345678901234567890123456789012")
    await app.close()
  })

})

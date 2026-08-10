// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const agentServerMock = vi.hoisted(() => {
  const captureResolvedEnvironment = vi.fn(async (_options?: unknown) => undefined)
  return {
    captureResolvedEnvironment,
    createAgentHost: vi.fn(async (options: any) => ({
      host: { hostId: "test", describe: vi.fn(), drain: vi.fn(async () => {}), close: vi.fn(async () => {}) },
      gateway: {},
      registerDirectRoutes: vi.fn((projection: { authorizeAgentRequest(request: any): Promise<any> }) => async () => {
        const request = { id: "readonly-policy-test", url: "/api/v1/agents/default/sessions", headers: {}, query: {} }
        const authorizedScope = await projection.authorizeAgentRequest(request)
        const verifiedClaim = await options.scopeVerifier.verify(authorizedScope)
        const environment = await options.resolveAuthorizedEnvironmentScope({
          authorizedScope,
          verifiedClaim,
          intent: { kind: "agent-binding", requestId: request.id },
        })
        await captureResolvedEnvironment(environment)
      }),
    })),
    provisionRuntimeWorkspace: vi.fn(async () => {}),
    provisionWorkspaceRuntime: vi.fn(async () => undefined),
  }
})

vi.mock("@hachej/boring-agent/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hachej/boring-agent/server")>()
  return {
    ...actual,
    createAgentHost: agentServerMock.createAgentHost,
    provisionRuntimeWorkspace: agentServerMock.provisionRuntimeWorkspace,
    provisionWorkspaceRuntime: agentServerMock.provisionWorkspaceRuntime,
  }
})

import { createWorkspaceAgentServer } from "../createWorkspaceAgentServer"

const tempDirs: string[] = []

beforeEach(() => {
  agentServerMock.captureResolvedEnvironment.mockClear()
})

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

describe("createWorkspaceAgentServer — readonly workspace policy binding", () => {
  test("sandbox-confined bundle workspace resolves policy paths via storageRoot", async () => {
    // Regression: local-mode bundles expose a confined workspace whose root is
    // the virtual `/workspace`, which is not a registered node workspace. The
    // policy path resolver must fall back to the bundle's storageRoot instead
    // of failing every access (including plain reads) with
    // RUNTIME_READONLY_FILESYSTEM_POLICY_INVALID (surfaced as HTTP 403
    // "path traversal rejected" on /api/v1/tree in the ui-review harness).
    const hostRoot = await makeTempDir("readonly-policy-")
    await mkdir(join(hostRoot, ".agents"), { recursive: true })
    await writeFile(join(hostRoot, ".agents", "rule.md"), "protected")
    await writeFile(join(hostRoot, "notes.md"), "writable")

    await createWorkspaceAgentServer({
      workspaceRoot: hostRoot,
      provisionWorkspace: false,
      readonlyWorkspacePaths: [".agents"],
    })

    const [environment] = agentServerMock.captureResolvedEnvironment.mock.calls.at(-1) as unknown as [{
      transformRuntimeBundle?: (bundle: any) => Promise<any>
    }]
    expect(environment.transformRuntimeBundle).toBeTypeOf("function")
    const bundle = await environment.transformRuntimeBundle!({
      // Confined workspace as produced by local/sandboxed mode adapters.
      workspace: { root: "/workspace" },
      storageRoot: hostRoot,
      sandbox: { async exec() { return { stdout: "", stderr: "", exitCode: 0 } } },
    })

    const userBinding = bundle.filesystemBindings.find((binding: any) => binding.filesystem === "user")
    expect(userBinding).toBeDefined()

    const rootAccess = await userBinding.operations.resolveAccess({ path: "." })
    expect(rootAccess.capabilities.read).toBe(true)

    const protectedAccess = await userBinding.operations.resolveAccess({ path: ".agents/rule.md" })
    expect(protectedAccess.capabilities.read).toBe(true)
    expect(protectedAccess.capabilities.write).toBe(false)

    const writableAccess = await userBinding.operations.resolveAccess({ path: "notes.md" })
    expect(writableAccess.capabilities.write).toBe(true)
  })
})

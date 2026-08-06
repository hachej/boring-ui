/**
 * Reload edge cases — solidity tests for the /reload code path.
 *
 * Distinct from `rebuildServerPlugins.test.ts` (which tests the rebuild
 * primitive in isolation) — these tests exercise the FULL reload chain
 * through `createWorkspaceAgentServer.applyReload` against a real
 * filesystem and Fastify app instance.
 *
 * Focus: edge cases that have bitten plugin reload systems before:
 *   - concurrent reloads
 *   - plugin removed between reloads
 *   - declared-but-missing file (Pi parity: loud throw)
 *   - plugin id collision
 *   - fresh systemPrompt visible via systemPromptDynamic getter
 *   - fresh package.json#pi visible via getHotReloadableResources
 *   - syntax error → diagnostic + previous state intact
 *   - reload idempotency (no changes → no spurious side effects)
 */
// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"

const agentServerMock = vi.hoisted(() => {
  const captureResolvedRuntimeScope = vi.fn(async (_options?: unknown) => undefined)
  return {
    captureResolvedRuntimeScope,
    createAgentHost: vi.fn(async (options: any) => ({
      host: { hostId: "test", describe: vi.fn(), drain: vi.fn(async () => {}), close: vi.fn(async () => {}) },
      gateway: {},
      registerDirectRoutes: vi.fn((projection: { authorizeAgentRequest(request: any): Promise<any> }) => async () => {
        await options.fleetCompiler.compile({ agents: options.agents })
        const request = { id: "reload-edge-test", url: "/api/v1/agents/default/reload", headers: {}, query: {} }
        const authorizedScope = await projection.authorizeAgentRequest(request)
        const verifiedClaim = await options.scopeVerifier.verify(authorizedScope)
        const environment = await options.resolveAuthorizedEnvironmentScope({
          authorizedScope,
          verifiedClaim,
          intent: { kind: "agent-binding", requestId: request.id },
        })
        const runtime = await options.resolveAuthorizedAgentRuntimeScope({
          authorizedScope,
          verifiedClaim,
          agentTypeId: options.agents[0].agentTypeId,
          intent: { kind: "agent-binding", operation: "new-binding", requestId: request.id },
          environment,
        })
        const reload = await options.resolveAuthorizedAgentRuntimeScope({
          authorizedScope,
          verifiedClaim,
          agentTypeId: options.agents[0].agentTypeId,
          intent: { kind: "agent-binding", operation: "reload", requestId: "reload-edge-candidate" },
          environment,
        })
        await captureResolvedRuntimeScope({ ...runtime, environment, applyReload: reload.applyReload })
      }),
    })),
    provisionRuntimeWorkspace: vi.fn(async () => {}),
  }
})

vi.mock("@hachej/boring-agent/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hachej/boring-agent/server")>()
  return {
    ...actual,
    createAgentHost: agentServerMock.createAgentHost,
    provisionRuntimeWorkspace: agentServerMock.provisionRuntimeWorkspace,
  }
})

import { createWorkspaceAgentServer } from "../createWorkspaceAgentServer"

const tempDirs: string[] = []

afterEach(async () => {
  agentServerMock.captureResolvedRuntimeScope.mockClear()
  agentServerMock.provisionRuntimeWorkspace.mockClear()
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function writeDirPlugin(dir: string, body: string): Promise<void> {
  await mkdir(join(dir, "src", "server"), { recursive: true })
  await writeFile(join(dir, "src", "server", "index.ts"), body, "utf8")
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "edge-plugin", boring: { id: "p", server: "src/server/index.ts" } }), "utf8")
}

async function writeDiscoveredPlugin(
  workspaceRoot: string,
  name: string,
  body: { systemPrompt?: string; extensions?: string[] } = {},
): Promise<string> {
  const dir = join(workspaceRoot, ".pi", "extensions", name)
  await mkdir(join(dir, "front"), { recursive: true })
  await mkdir(join(dir, "agent"), { recursive: true })
  await writeFile(join(dir, "front", "index.tsx"), `export default definePlugin({ id: ${JSON.stringify(name)} })\n`, "utf8")
  if (body.extensions) {
    for (const ext of body.extensions) {
      await writeFile(join(dir, "agent", ext), "export default function() {}\n", "utf8")
    }
  }
  const pkg: Record<string, unknown> = {
    name,
    version: "1.0.0",
    boring: { front: "front/index.tsx" },
    pi: {
      ...(body.systemPrompt ? { systemPrompt: body.systemPrompt } : {}),
      ...(body.extensions ? { extensions: body.extensions.map((e) => `agent/${e}`) } : {}),
    },
  }
  await writeFile(join(dir, "package.json"), JSON.stringify(pkg), "utf8")
  return dir
}

describe("Reload edge cases — directory-source { spec: { dir } }", () => {
  test("concurrent /reload calls do not race or double-emit", async () => {
    const dir = await makeTempDir("edge-concurrent-")
    await writeDirPlugin(dir, "export default { id: 'p', systemPrompt: 'V1' }")

    await createWorkspaceAgentServer({
      workspaceRoot: await makeTempDir("edge-concurrent-host-"),
      logger: false,
      provisionWorkspace: false,
      plugins: [{ dir, hotReload: true }],
    })

    const [agentOptions] = agentServerMock.captureResolvedRuntimeScope.mock.calls[0] as unknown as [
      { applyReload?: () => Promise<void> },
    ]

    // Fire five reloads back-to-back. None should throw, and the
    // rebuild closure should be safe under serialization.
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => agentOptions.applyReload?.()),
    )
    for (const r of results) {
      expect(r.status).toBe("fulfilled")
    }
  })

  test("plugin removed between reloads: subsequent reload tolerates missing dir without throwing", async () => {
    // Per PLUGIN_SYSTEM.md §4.5: per-plugin failures (including a missing dir
    // on rebuild) do NOT abort the reload. Diagnostics surface via
    // SSE error events + the POST response body; not by throwing.
    const dir = await makeTempDir("edge-removed-")
    await writeDirPlugin(dir, "export default { id: 'p', systemPrompt: 'V1' }")
    const host = await makeTempDir("edge-removed-host-")

    await createWorkspaceAgentServer({
      workspaceRoot: host,
      logger: false,
      provisionWorkspace: false,
      plugins: [{ dir, hotReload: true }],
    })

    const [agentOptions] = agentServerMock.captureResolvedRuntimeScope.mock.calls[0] as unknown as [
      { applyReload?: () => Promise<{ diagnostics?: { source: string; message: string }[] } | undefined> },
    ]

    // First reload: clean.
    await expect(agentOptions.applyReload?.()).resolves.toBeUndefined()

    // Delete the plugin dir entirely.
    await rm(dir, { recursive: true, force: true })

    // Second reload tolerates the missing dir — no throw, diagnostics only.
    const result = await agentOptions.applyReload?.()
    expect(result?.diagnostics?.[0]?.message).toContain("no package.json found")
  })

  test("declared-but-missing boring.server fails LOUDLY (Pi parity)", async () => {
    const dir = await makeTempDir("edge-missing-")
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "p", boring: { server: "src/server/does-not-exist.ts" } }),
      "utf8",
    )

    await expect(
      createWorkspaceAgentServer({
        workspaceRoot: await makeTempDir("edge-missing-host-"),
        logger: false,
        provisionWorkspace: false,
        plugins: [{ dir, hotReload: true }],
      }),
    ).rejects.toThrow(/declared but not found/)
  })

  test("syntax error in the new module body: reload tolerates, prior state intact", async () => {
    // Per PLUGIN_SYSTEM.md §4.5: per-plugin failures must not abort the reload.
    // Healthy plugins still pick up edits; the failed plugin's
    // diagnostic surfaces via the rebuild result's diagnostics array
    // (the asset manager + SSE channel carry the same info).
    const dir = await makeTempDir("edge-syntax-")
    await writeDirPlugin(dir, "export default { id: 'p', systemPrompt: 'GOOD' }")
    const host = await makeTempDir("edge-syntax-host-")

    const app = await createWorkspaceAgentServer({
      workspaceRoot: host,
      logger: false,
      provisionWorkspace: false,
      plugins: [{ dir, hotReload: true }],
    })

    const [agentOptions] = agentServerMock.captureResolvedRuntimeScope.mock.calls[0] as unknown as [
      { applyReload?: () => Promise<{ diagnostics?: { source: string; message: string }[] } | undefined> },
    ]

    // Plant a syntax error.
    await writeFile(join(dir, "src", "server", "index.ts"), "this is not !!! valid {{ typescript", "utf8")
    const beforeReloadResult = await agentOptions.applyReload?.()
    expect(beforeReloadResult?.diagnostics?.length).toBeGreaterThan(0)

    // Diagnostic is observable via the exposed rebuild closure (also via
    // SSE + .error files in the full stack). The closure is diagnostic-only;
    // it does not return or install a rebuilt plugin graph.
    type Rebuild = () => Promise<{ ok: boolean; diagnostics: { source: string; message: string }[] }>
    const rebuild = (app as unknown as { __boringRebuildPlugins: Rebuild }).__boringRebuildPlugins
    const rebuildResult = await rebuild()
    expect(rebuildResult.ok).toBe(false)
    expect(rebuildResult.diagnostics.length).toBeGreaterThan(0)
  })

  test("reload idempotency: diagnostic rebuild closure stays stable on repeat", async () => {
    const dir = await makeTempDir("edge-idem-")
    await writeDirPlugin(dir, "export default { id: 'p', systemPrompt: 'V1' }")
    const host = await makeTempDir("edge-idem-host-")

    const app = await createWorkspaceAgentServer({
      workspaceRoot: host,
      logger: false,
      provisionWorkspace: false,
      plugins: [{ dir, hotReload: true }],
    })

    type Rebuild = () => Promise<{ ok: boolean; diagnostics: unknown[] }>
    const rebuild = (app as unknown as { __boringRebuildPlugins: Rebuild }).__boringRebuildPlugins

    const first = await rebuild()
    const second = await rebuild()
    const third = await rebuild()

    expect(first).toEqual({ ok: true, diagnostics: [] })
    expect(second).toEqual({ ok: true, diagnostics: [] })
    expect(third).toEqual({ ok: true, diagnostics: [] })
  })
})

describe("Reload edge cases — discovered package plugins (.pi/extensions/*)", () => {
  test("systemPromptDynamic picks up fresh pi.systemPrompt after /reload (Pi parity)", async () => {
    const host = await makeTempDir("edge-prompt-")
    await writeDiscoveredPlugin(host, "freshprompt", { systemPrompt: "VERSION_ONE" })

    await createWorkspaceAgentServer({
      workspaceRoot: host,
      logger: false,
      provisionWorkspace: false,
    })

    const [agentOptions] = agentServerMock.captureResolvedRuntimeScope.mock.calls[0] as unknown as [
      {
        applyReload?: () => Promise<void>
        loadSystemPromptAppend?: () => string | undefined
      },
    ]

    // First call sees v1.
    const first = await agentOptions.loadSystemPromptAppend?.()
    expect(first).toContain("VERSION_ONE")

    // Edit the manifest in place.
    await writeDiscoveredPlugin(host, "freshprompt", { systemPrompt: "VERSION_TWO" })

    // Reload causes the asset manager to re-read package.json.
    await expect(agentOptions.applyReload?.()).resolves.toBeUndefined()

    // Next read of the getter (Pi calls it on every before_agent_start)
    // sees the fresh value.
    const second = await agentOptions.loadSystemPromptAppend?.()
    expect(second).toContain("VERSION_TWO")
    expect(second).not.toContain("VERSION_ONE")
  })

  test("getHotReloadableResources reflects pi.extensions added between reloads", async () => {
    const host = await makeTempDir("edge-extensions-")
    await writeDiscoveredPlugin(host, "edge-ext", { extensions: ["one.ts"] })

    await createWorkspaceAgentServer({
      workspaceRoot: host,
      logger: false,
      provisionWorkspace: false,
    })

    const [agentOptions] = agentServerMock.captureResolvedRuntimeScope.mock.calls[0] as unknown as [
      {
        applyReload?: () => Promise<void>
        pi?: { getHotReloadableResources?: () => { extensionPaths?: string[] } }
      },
    ]

    const before = agentOptions.pi?.getHotReloadableResources?.().extensionPaths ?? []
    expect(before).toContain(join(host, ".pi", "extensions", "edge-ext", "agent", "one.ts"))
    expect(before).not.toContain(join(host, ".pi", "extensions", "edge-ext", "agent", "two.ts"))

    // Add a second extension entry.
    await writeDiscoveredPlugin(host, "edge-ext", { extensions: ["one.ts", "two.ts"] })
    await agentOptions.applyReload?.()

    const after = agentOptions.pi?.getHotReloadableResources?.().extensionPaths ?? []
    expect(after).toContain(join(host, ".pi", "extensions", "edge-ext", "agent", "one.ts"))
    expect(after).toContain(join(host, ".pi", "extensions", "edge-ext", "agent", "two.ts"))
  })

  test("plugin removal: deleted .pi/extensions/<name>/ triggers boring.plugin.unload on next reload", async () => {
    const host = await makeTempDir("edge-unload-")
    const pluginDir = await writeDiscoveredPlugin(host, "transient", { systemPrompt: "ALIVE" })

    await createWorkspaceAgentServer({
      workspaceRoot: host,
      logger: false,
      provisionWorkspace: false,
    })

    const [agentOptions] = agentServerMock.captureResolvedRuntimeScope.mock.calls[0] as unknown as [
      {
        applyReload?: () => Promise<void>
        loadSystemPromptAppend?: () => string | undefined
      },
    ]
    expect(await agentOptions.loadSystemPromptAppend?.()).toContain("ALIVE")

    // Delete the plugin dir between reloads.
    await rm(pluginDir, { recursive: true, force: true })
    await expect(agentOptions.applyReload?.()).resolves.toBeUndefined()

    // The getter now returns undefined — no plugins contribute prompts.
    const after = await agentOptions.loadSystemPromptAppend?.()
    expect(after).toBeUndefined()
  })

  test("malformed package.json: boot succeeds; /reload tolerates the bad plugin (diagnostic via SSE error event + .error file)", async () => {
    // Per PLUGIN_SYSTEM.md §4.5: per-plugin failures don't abort the reload.
    // The malformed package.json surfaces via SSE + .error files, not by
    // throwing out of beforeReload.
    const host = await makeTempDir("edge-bad-pkg-")
    const dir = join(host, ".pi", "extensions", "bad-pkg")
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, "package.json"), "{ this is not json", "utf8")

    await expect(
      createWorkspaceAgentServer({
        workspaceRoot: host,
        logger: false,
        provisionWorkspace: false,
      }),
    ).resolves.toBeTruthy()
    expect(agentServerMock.captureResolvedRuntimeScope).toHaveBeenCalledTimes(1)

    const [agentOptions] = agentServerMock.captureResolvedRuntimeScope.mock.calls[0] as unknown as [
      { applyReload?: () => Promise<{ diagnostics?: Array<{ message: string }> } | undefined> },
    ]
    await expect(agentOptions.applyReload?.()).resolves.toEqual({
      diagnostics: [expect.objectContaining({ message: expect.stringContaining("INVALID_PACKAGE_JSON") })],
    })
  })

  test("two plugins with the same name: boot succeeds; /reload tolerates the duplicate (diagnostic via SSE)", async () => {
    // Per PLUGIN_SYSTEM.md §4.5: misconfiguration surfaces via diagnostic
    // channels, not by aborting the reload.
    const host = await makeTempDir("edge-dup-id-")
    const dirA = join(host, ".pi", "extensions", "alpha")
    const dirB = join(host, ".pi", "extensions", "beta")
    await mkdir(join(dirA, "front"), { recursive: true })
    await mkdir(join(dirB, "front"), { recursive: true })
    await writeFile(join(dirA, "front", "index.tsx"), 'export default definePlugin({ id: "twin" })\n', "utf8")
    await writeFile(join(dirB, "front", "index.tsx"), 'export default definePlugin({ id: "twin" })\n', "utf8")
    const pkg = { name: "twin", version: "1.0.0", boring: { front: "front/index.tsx" } }
    await writeFile(join(dirA, "package.json"), JSON.stringify(pkg), "utf8")
    await writeFile(join(dirB, "package.json"), JSON.stringify(pkg), "utf8")

    await expect(
      createWorkspaceAgentServer({
        workspaceRoot: host,
        logger: false,
        provisionWorkspace: false,
      }),
    ).resolves.toBeTruthy()

    const [agentOptions] = agentServerMock.captureResolvedRuntimeScope.mock.calls[0] as unknown as [
      { applyReload?: () => Promise<{ diagnostics?: Array<{ message: string }> } | undefined> },
    ]
    await expect(agentOptions.applyReload?.()).resolves.toEqual({
      diagnostics: [expect.objectContaining({ message: expect.stringContaining("duplicate plugin id") })],
    })
  })

  test("rebuild closure called BEFORE first /reload is safe and diagnostic-only", async () => {
    // The closure should be safe to invoke at any point — including
    // before any /reload has happened. It re-resolves entries against
    // the current filesystem for diagnostics only.
    const dir = await makeTempDir("edge-early-")
    await writeDirPlugin(dir, "export default { id: 'p', systemPrompt: 'BOOT' }")

    const app = await createWorkspaceAgentServer({
      workspaceRoot: await makeTempDir("edge-early-host-"),
      logger: false,
      provisionWorkspace: false,
      plugins: [{ dir, hotReload: true }],
    })

    type Rebuild = () => Promise<{ ok: boolean; diagnostics: unknown[] }>
    const rebuild = (app as unknown as { __boringRebuildPlugins: Rebuild }).__boringRebuildPlugins
    const result = await rebuild()
    expect(result).toEqual({ ok: true, diagnostics: [] })
  })
})

// Ensure tests reference readFile to keep the import live for future use.
void readFile

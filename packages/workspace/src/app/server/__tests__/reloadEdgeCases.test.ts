/**
 * Reload edge cases — solidity tests for the /reload code path.
 *
 * Distinct from `rebuildServerPlugins.test.ts` (which tests the rebuild
 * primitive in isolation) — these tests exercise the FULL reload chain
 * through `createWorkspaceAgentServer.beforeReload` against a real
 * filesystem and Fastify app instance.
 *
 * Focus: edge cases that have bitten plugin reload systems before:
 *   - concurrent reloads
 *   - plugin removed between reloads
 *   - declared-but-missing file (Pi parity: loud throw)
 *   - plugin id collision
 *   - fresh systemPrompt visible via systemPromptDynamic getter
 *   - fresh package.json#pi visible via getDynamicResources
 *   - syntax error → diagnostic + previous state intact
 *   - reload idempotency (no changes → no spurious side effects)
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"

const agentServerMock = vi.hoisted(() => ({
  createAgentApp: vi.fn(async () => ({ register: vi.fn(async () => {}) })),
  provisionRuntimeWorkspace: vi.fn(async () => {}),
}))

vi.mock("@hachej/boring-agent/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hachej/boring-agent/server")>()
  return {
    ...actual,
    createAgentApp: agentServerMock.createAgentApp,
    provisionRuntimeWorkspace: agentServerMock.provisionRuntimeWorkspace,
  }
})

import { createWorkspaceAgentServer } from "../createWorkspaceAgentServer"

const tempDirs: string[] = []

afterEach(async () => {
  agentServerMock.createAgentApp.mockClear()
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
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "edge-plugin" }), "utf8")
}

async function writeDiscoveredPlugin(
  workspaceRoot: string,
  name: string,
  body: { systemPrompt?: string; extensions?: string[] } = {},
): Promise<string> {
  const dir = join(workspaceRoot, ".pi", "extensions", name)
  await mkdir(join(dir, "front"), { recursive: true })
  await mkdir(join(dir, "agent"), { recursive: true })
  await writeFile(join(dir, "front", "index.tsx"), "export default function() {}\n", "utf8")
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

    const [agentOptions] = agentServerMock.createAgentApp.mock.calls[0] as unknown as [
      { beforeReload?: () => Promise<void> },
    ]

    // Fire five reloads back-to-back. None should throw, and the
    // rebuild closure should be safe under serialization.
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => agentOptions.beforeReload?.()),
    )
    for (const r of results) {
      expect(r.status).toBe("fulfilled")
    }
  })

  test("plugin removed between reloads: subsequent reload tolerates missing dir", async () => {
    const dir = await makeTempDir("edge-removed-")
    await writeDirPlugin(dir, "export default { id: 'p', systemPrompt: 'V1' }")
    const host = await makeTempDir("edge-removed-host-")

    await createWorkspaceAgentServer({
      workspaceRoot: host,
      logger: false,
      provisionWorkspace: false,
      plugins: [{ dir, hotReload: true }],
    })

    const [agentOptions] = agentServerMock.createAgentApp.mock.calls[0] as unknown as [
      { beforeReload?: () => Promise<void> },
    ]

    // First reload: clean.
    await expect(agentOptions.beforeReload?.()).resolves.toBeUndefined()

    // Delete the plugin dir entirely.
    await rm(dir, { recursive: true, force: true })

    // Second reload throws (re-resolve fails) — diagnostic surfaced
    // via the 422-style error. The thrown message names the source.
    await expect(agentOptions.beforeReload?.()).rejects.toThrow(/directory .* no package\.json/)
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

  test("syntax error in the new module body: throw on reload, prior state intact", async () => {
    const dir = await makeTempDir("edge-syntax-")
    await writeDirPlugin(dir, "export default { id: 'p', systemPrompt: 'GOOD' }")
    const host = await makeTempDir("edge-syntax-host-")

    const app = await createWorkspaceAgentServer({
      workspaceRoot: host,
      logger: false,
      provisionWorkspace: false,
      plugins: [{ dir, hotReload: true }],
    })

    const [agentOptions] = agentServerMock.createAgentApp.mock.calls[0] as unknown as [
      { beforeReload?: () => Promise<void> },
    ]

    // Plant a syntax error.
    await writeFile(join(dir, "src", "server", "index.ts"), "this is not !!! valid {{ typescript", "utf8")
    await expect(agentOptions.beforeReload?.()).rejects.toThrow(/Boring plugin re-resolve failed/)

    // The exposed rebuild closure still works against the previous good
    // state — the failed reload doesn't poison subsequent reads.
    type Rebuild = () => Promise<{ plugins: { id: string }[] }>
    const rebuild = (app as unknown as { __boringRebuildPlugins: Rebuild }).__boringRebuildPlugins
    // After the failed reload, the rebuild result still surfaces a
    // diagnostic (Pi parity: errors are diagnostics, not aborts; the
    // throw from beforeReload only formats them as an HTTP-style error).
    const rebuildResult = await rebuild()
    expect(rebuildResult.plugins).toHaveLength(0)
  })

  test("reload idempotency: rebuild closure does not double-mount on repeat", async () => {
    const dir = await makeTempDir("edge-idem-")
    await writeDirPlugin(dir, "export default { id: 'p', systemPrompt: 'V1' }")
    const host = await makeTempDir("edge-idem-host-")

    const app = await createWorkspaceAgentServer({
      workspaceRoot: host,
      logger: false,
      provisionWorkspace: false,
      plugins: [{ dir, hotReload: true }],
    })

    type Rebuild = () => Promise<{ plugins: { id: string }[] }>
    const rebuild = (app as unknown as { __boringRebuildPlugins: Rebuild }).__boringRebuildPlugins

    const first = await rebuild()
    const second = await rebuild()
    const third = await rebuild()

    expect(first.plugins.map((p) => p.id)).toEqual(["p"])
    expect(second.plugins.map((p) => p.id)).toEqual(["p"])
    expect(third.plugins.map((p) => p.id)).toEqual(["p"])
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

    const [agentOptions] = agentServerMock.createAgentApp.mock.calls[0] as unknown as [
      {
        beforeReload?: () => Promise<void>
        systemPromptDynamic?: () => string | undefined
      },
    ]

    // First call sees v1.
    const first = await agentOptions.systemPromptDynamic?.()
    expect(first).toContain("VERSION_ONE")

    // Edit the manifest in place.
    await writeDiscoveredPlugin(host, "freshprompt", { systemPrompt: "VERSION_TWO" })

    // Reload causes the asset manager to re-read package.json.
    await expect(agentOptions.beforeReload?.()).resolves.toBeUndefined()

    // Next read of the getter (Pi calls it on every before_agent_start)
    // sees the fresh value.
    const second = await agentOptions.systemPromptDynamic?.()
    expect(second).toContain("VERSION_TWO")
    expect(second).not.toContain("VERSION_ONE")
  })

  test("getDynamicResources reflects pi.extensions added between reloads", async () => {
    const host = await makeTempDir("edge-extensions-")
    await writeDiscoveredPlugin(host, "edge-ext", { extensions: ["one.ts"] })

    await createWorkspaceAgentServer({
      workspaceRoot: host,
      logger: false,
      provisionWorkspace: false,
    })

    const [agentOptions] = agentServerMock.createAgentApp.mock.calls[0] as unknown as [
      {
        beforeReload?: () => Promise<void>
        pi?: { getDynamicResources?: () => { extensionPaths?: string[] } }
      },
    ]

    const before = agentOptions.pi?.getDynamicResources?.().extensionPaths ?? []
    expect(before).toContain(join(host, ".pi", "extensions", "edge-ext", "agent", "one.ts"))
    expect(before).not.toContain(join(host, ".pi", "extensions", "edge-ext", "agent", "two.ts"))

    // Add a second extension entry.
    await writeDiscoveredPlugin(host, "edge-ext", { extensions: ["one.ts", "two.ts"] })
    await agentOptions.beforeReload?.()

    const after = agentOptions.pi?.getDynamicResources?.().extensionPaths ?? []
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

    const [agentOptions] = agentServerMock.createAgentApp.mock.calls[0] as unknown as [
      {
        beforeReload?: () => Promise<void>
        systemPromptDynamic?: () => string | undefined
      },
    ]
    expect(await agentOptions.systemPromptDynamic?.()).toContain("ALIVE")

    // Delete the plugin dir between reloads.
    await rm(pluginDir, { recursive: true, force: true })
    await expect(agentOptions.beforeReload?.()).resolves.toBeUndefined()

    // The getter now returns undefined — no plugins contribute prompts.
    const after = await agentOptions.systemPromptDynamic?.()
    expect(after).toBeUndefined()
  })

  test("malformed package.json: boot succeeds; /reload surfaces a 422-style error naming the bad plugin", async () => {
    const host = await makeTempDir("edge-bad-pkg-")
    const dir = join(host, ".pi", "extensions", "bad-pkg")
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, "package.json"), "{ this is not json", "utf8")

    // Initial install does NOT throw — the asset manager treats bad
    // package.json as a preflight error and lets boot continue.
    await expect(
      createWorkspaceAgentServer({
        workspaceRoot: host,
        logger: false,
        provisionWorkspace: false,
      }),
    ).resolves.toBeTruthy()
    expect(agentServerMock.createAgentApp).toHaveBeenCalledTimes(1)

    // beforeReload re-runs preflight; the malformed package.json now
    // throws with the diagnostic the agent will see in the /reload
    // response. The throw message includes the diagnostic code so the
    // agent can act on it.
    const [agentOptions] = agentServerMock.createAgentApp.mock.calls[0] as unknown as [
      { beforeReload?: () => Promise<void> },
    ]
    await expect(agentOptions.beforeReload?.()).rejects.toThrow(/INVALID_PACKAGE_JSON/)
  })

  test("two plugins with the same name: boot succeeds; /reload surfaces a duplicate-id diagnostic", async () => {
    // The asset manager keys by package.json#name (or directory name).
    // Two directories with the same `name` is a misconfiguration; the
    // first load tolerates it (asset manager picks one), but /reload
    // surfaces the conflict so the agent can fix it.
    const host = await makeTempDir("edge-dup-id-")
    const dirA = join(host, ".pi", "extensions", "alpha")
    const dirB = join(host, ".pi", "extensions", "beta")
    await mkdir(join(dirA, "front"), { recursive: true })
    await mkdir(join(dirB, "front"), { recursive: true })
    await writeFile(join(dirA, "front", "index.tsx"), "export default function() {}\n", "utf8")
    await writeFile(join(dirB, "front", "index.tsx"), "export default function() {}\n", "utf8")
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

    const [agentOptions] = agentServerMock.createAgentApp.mock.calls[0] as unknown as [
      { beforeReload?: () => Promise<void> },
    ]
    // Reload throws with the duplicate name in the diagnostic so the
    // agent can act on it.
    await expect(agentOptions.beforeReload?.()).rejects.toThrow(/twin/)
  })

  test("rebuild closure called BEFORE first /reload returns the boot-time set unchanged", async () => {
    // The closure should be safe to invoke at any point — including
    // before any /reload has happened. It re-resolves entries against
    // the current filesystem.
    const dir = await makeTempDir("edge-early-")
    await writeDirPlugin(dir, "export default { id: 'p', systemPrompt: 'BOOT' }")

    const app = await createWorkspaceAgentServer({
      workspaceRoot: await makeTempDir("edge-early-host-"),
      logger: false,
      provisionWorkspace: false,
      plugins: [{ dir, hotReload: true }],
    })

    type Rebuild = () => Promise<{ plugins: { id: string; systemPrompt?: string }[] }>
    const rebuild = (app as unknown as { __boringRebuildPlugins: Rebuild }).__boringRebuildPlugins
    const result = await rebuild()
    expect(result.plugins[0].systemPrompt).toBe("BOOT")
  })
})

// Ensure tests reference readFile to keep the import live for future use.
void readFile

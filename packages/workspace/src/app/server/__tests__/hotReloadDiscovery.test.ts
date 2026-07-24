/**
 * Regression test: asset manager discovers plugin dirs created AFTER
 * boot. Synthetic, no LLM — proves the reload pipeline works
 * end-to-end when given a valid manifest. The LLM-driven
 * plugin-creation evals (eval/__tests__/plugin-creation.test.ts)
 * sometimes fail because the LLM writes manifests that don't
 * preflight-pass; this test pins the host-side machinery.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { FastifyInstance } from "fastify"
import { createWorkspaceAgentServer } from "../createWorkspaceAgentServer"

describe("synthetic: asset manager discovers newly-created plugin dirs on /reload", () => {
  let app: FastifyInstance
  let workspaceRoot: string

  beforeAll(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "synth-discovery-"))
    app = await createWorkspaceAgentServer({
      workspaceRoot, mode: "direct", logger: false, provisionWorkspace: false,
    })
  }, 30_000)

  afterAll(async () => {
    if (app) await app.close()
    if (workspaceRoot) await rm(workspaceRoot, { recursive: true, force: true })
  })

  test("plugin created AFTER boot appears in /api/v1/agent-plugins after /reload", async () => {
    const before = await app.inject({ method: "GET", url: "/api/v1/agent-plugins" })
    expect(before.json().find((p: { id: string }) => p.id === "synth-after-boot")).toBeUndefined()

    const pluginDir = join(workspaceRoot, ".pi", "extensions", "synth-after-boot")
    await mkdir(join(pluginDir, "front"), { recursive: true })
    await writeFile(join(pluginDir, "front", "index.tsx"), 'export default definePlugin({ id: "synth-after-boot" })\n', "utf8")
    await writeFile(join(pluginDir, "package.json"), JSON.stringify({
      name: "synth-after-boot",
      version: "1.0.0",
      boring: { front: "front/index.tsx", server: false },
      pi: { systemPrompt: "synth" },
    }), "utf8")

    const reload = await app.inject({ method: "POST", url: "/api/v1/agent/reload", payload: {} })
    expect(reload.statusCode).toBe(200)

    const after = await app.inject({ method: "GET", url: "/api/v1/agent-plugins" })
    const plugin = after.json().find((p: { id: string }) => p.id === "synth-after-boot")
    expect(plugin, JSON.stringify(after.json(), null, 2)).toBeTruthy()
    expect(plugin.boring.front).toBe("front/index.tsx")
  })

})

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { createFolderModeApp } from "../server/cli.js"

const tempDirs: string[] = []
const originalHome = process.env.HOME

afterEach(async () => {
  process.env.HOME = originalHome
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function writePlugin(root: string, name: string): Promise<void> {
  await mkdir(join(root, "front"), { recursive: true })
  await writeFile(join(root, "front", "index.tsx"), "export default function Plugin() { return null }\n", "utf8")
  await writeFile(join(root, "package.json"), JSON.stringify({
    name,
    version: "1.0.0",
    boring: { front: "front/index.tsx", label: name },
  }), "utf8")
}

async function readSsePrelude(url: string): Promise<string> {
  const controller = new AbortController()
  const response = await fetch(url, { signal: controller.signal })
  if (!response.body) throw new Error("missing SSE response body")
  const reader = response.body.getReader()
  let text = ""
  try {
    for (let i = 0; i < 12; i += 1) {
      const { done, value } = await reader.read()
      if (done) break
      text += new TextDecoder().decode(value)
      if (text.includes("frontTarget")) break
    }
  } finally {
    controller.abort()
    try { await reader.cancel() } catch {}
  }
  return text
}

describe("folder mode runtime plugin wiring", () => {
  test("folder mode list, events, and meta use native frontTarget payloads and trust meta", async () => {
    const homeRoot = await makeTempDir("boring-cli-folder-home-")
    const workspaceRoot = await makeTempDir("boring-cli-folder-workspace-")
    process.env.HOME = homeRoot

    const globalPlugin = join(homeRoot, ".pi", "agent", "extensions", "global-plugin")
    const localPlugin = join(workspaceRoot, ".pi", "extensions", "local-plugin")
    await writePlugin(globalPlugin, "global-plugin")
    await writePlugin(localPlugin, "local-plugin")

    const app = await createFolderModeApp({
      workspaceRoot,
      mode: "direct",
      projectName: "Folder Workspace",
      provisionWorkspace: false,
    })

    const address = await app.listen({ port: 0, host: "127.0.0.1" })
    try {
      const list = await app.inject({ method: "GET", url: "/api/v1/agent-plugins" })
      expect(list.statusCode).toBe(200)
      expect(list.json()).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: "global-plugin",
          revision: 1,
          frontTarget: expect.objectContaining({
            kind: "native",
            revision: 1,
            trust: "local-trusted-native",
            entryUrl: expect.stringContaining("/api/v1/agent-plugins/runtime/folder/global-plugin/1/front/index.tsx"),
          }),
        }),
        expect.objectContaining({
          id: "local-plugin",
          revision: 1,
          frontTarget: expect.objectContaining({
            kind: "native",
            revision: 1,
            trust: "local-trusted-native",
            entryUrl: expect.stringContaining("/api/v1/agent-plugins/runtime/folder/local-plugin/1/front/index.tsx"),
          }),
        }),
      ]))
      for (const plugin of list.json() as Array<Record<string, unknown>>) {
        expect(plugin.frontUrl).toBeUndefined()
      }

      const meta = await app.inject({ method: "GET", url: "/api/v1/workspace/meta" })
      expect(meta.statusCode).toBe(200)
      expect(meta.json()).toMatchObject({
        workspaceRoot,
        projectName: "Folder Workspace",
        runtimePluginFrontLoadingEnabled: true,
        runtimePluginTrustLabel: "Trusted local runtime plugins",
        runtimePluginTrustDescription: expect.stringContaining("CLI-owned runtime module host"),
        runtimePluginDiagnosticsEnabled: true,
      })

      const diagnostics = await app.inject({ method: "GET", url: "/api/v1/runtime-plugin-diagnostics" })
      expect(diagnostics.statusCode).toBe(200)
      expect(diagnostics.json()).toMatchObject({
        workspaceId: "folder",
        plugins: expect.arrayContaining([
          expect.objectContaining({
            id: "global-plugin",
            rootDir: globalPlugin,
            frontPath: join(globalPlugin, "front", "index.tsx"),
            serverLoadedRevision: 1,
            host: expect.objectContaining({
              pluginId: "global-plugin",
              workspaceId: "folder",
              revision: 1,
              entryUrl: expect.stringContaining("/api/v1/agent-plugins/runtime/folder/global-plugin/1/front/index.tsx"),
            }),
          }),
        ]),
      })
      const globalRuntimeUrl = (diagnostics.json() as { plugins: Array<{ id: string; host?: { entryUrl?: string } }> }).plugins.find((plugin) => plugin.id === "global-plugin")?.host?.entryUrl
      expect(globalRuntimeUrl).toBeTruthy()

      const staleRuntime = await app.inject({ method: "GET", url: "/api/v1/agent-plugins/runtime/folder/global-plugin/0/front/index.tsx" })
      expect(staleRuntime.statusCode).toBe(409)
      const diagnosticsAfterFailure = await app.inject({ method: "GET", url: "/api/v1/runtime-plugin-diagnostics" })
      expect(diagnosticsAfterFailure.json()).toMatchObject({
        plugins: expect.arrayContaining([
          expect.objectContaining({
            id: "global-plugin",
            host: expect.objectContaining({ lastErrorCode: "PLUGIN_RUNTIME_REVISION_MISMATCH" }),
          }),
        ]),
      })

      const healthyRuntime = await app.inject({ method: "GET", url: globalRuntimeUrl! })
      expect(healthyRuntime.statusCode).toBe(200)
      const diagnosticsAfterRecovery = await app.inject({ method: "GET", url: "/api/v1/runtime-plugin-diagnostics" })
      const recoveredGlobal = (diagnosticsAfterRecovery.json() as { plugins: Array<{ id: string; host?: { lastErrorCode?: string } }> }).plugins.find((plugin) => plugin.id === "global-plugin")
      expect(recoveredGlobal?.host?.lastErrorCode).toBeUndefined()

      const sseText = await readSsePrelude(`${address}/api/v1/agent-plugins/events`)
      expect(sseText).toContain("event: boring.plugin.load")
      expect(sseText).toContain("frontTarget")
      expect(sseText).not.toContain("frontUrl")
      expect(sseText).toContain('"id":"global-plugin"')
      expect(sseText).toContain('"id":"local-plugin"')
    } finally {
      await app.close()
    }
  }, 20_000)
})

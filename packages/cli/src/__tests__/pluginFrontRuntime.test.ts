import fastify from "fastify"
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { ErrorCode } from "@hachej/boring-agent/shared"
import type { BoringServerPluginManifest } from "@hachej/boring-workspace/server"
import {
  createPluginFrontRuntimeHost,
  PLUGIN_FRONT_RUNTIME_BASE_PATH,
  __testingRuntimeSingletonModuleCode,
  type PluginFrontRuntimeDiagnostic,
} from "../server/pluginFrontRuntime"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function writeRuntimePlugin(root: string, files: Record<string, string>): Promise<BoringServerPluginManifest> {
  for (const [relativePath, content] of Object.entries(files)) {
    const path = join(root, relativePath)
    await mkdir(join(path, ".."), { recursive: true })
    await writeFile(path, content, "utf8")
  }
  return {
    id: "runtime-plugin",
    rootDir: root,
    version: "1.0.0",
    boring: { front: "front/index.tsx", label: "Runtime Plugin" },
    frontPath: join(root, "front", "index.tsx"),
  }
}

describe("pluginFrontRuntime", () => {
  test("serves a transformed runtime module graph through the CLI-owned host surface", async () => {
    const diagnostics: PluginFrontRuntimeDiagnostic[] = []
    const pluginRoot = await makeTempDir("plugin-front-runtime-happy-")
    const plugin = await writeRuntimePlugin(pluginRoot, {
      "front/index.tsx": [
        'import { definePlugin } from "@hachej/boring-workspace/plugin"',
        'import { events } from "@hachej/boring-workspace/events"',
        'import { Panel } from "./panel"',
        'import "./styles.css"',
        'export const eventBus = events',
        'export default definePlugin({',
        '  id: "runtime-plugin",',
        '  label: "Runtime Plugin",',
        '  outputs: [{',
        '    type: "panel",',
        '    panel: { id: "runtime-panel", title: "Runtime", component: Panel },',
        '  }],',
        '})',
      ].join("\n"),
      "front/panel.ts": [
        'import { useState } from "react"',
        'import logo from "./logo.svg"',
        'import { label } from "../shared/message"',
        'export const logoUrl = logo',
        'export function Panel() {',
        '  const [value] = useState(label)',
        '  return value',
        '}',
      ].join("\n"),
      "front/styles.css": ".runtime-panel { color: tomato; }\n",
      "front/logo.svg": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>\n',
      "shared/message.ts": 'export const label = "hello from shared"\n',
    })

    const host = await createPluginFrontRuntimeHost({ onDiagnostic: (entry) => diagnostics.push(entry) })
    const app = fastify({ logger: false })
    await host.registerRoutes(app)
    const entryUrl = host.trackPlugin({
      workspaceId: "workspace-a",
      plugin,
      revision: 1,
      frontEntrySubpath: "front/index.tsx",
    })

    try {
      const entry = await app.inject({ method: "GET", url: `${entryUrl}?v=1&t=111` })
      expect(entry.statusCode).toBe(200)
      expect(entry.headers["content-type"]).toContain("application/javascript")
      expect(entry.body).toContain(`${PLUGIN_FRONT_RUNTIME_BASE_PATH}/workspace-a/runtime-plugin/1/front/panel.ts`)
      expect(entry.body).toContain(`${PLUGIN_FRONT_RUNTIME_BASE_PATH}/workspace-a/runtime-plugin/1/front/styles.css`)
      expect(entry.body).not.toContain("/@fs/")

      const panel = await app.inject({
        method: "GET",
        url: `${PLUGIN_FRONT_RUNTIME_BASE_PATH}/workspace-a/runtime-plugin/1/front/panel.ts`,
      })
      expect(panel.statusCode).toBe(200)
      expect(panel.body).toContain(`${PLUGIN_FRONT_RUNTIME_BASE_PATH}/workspace-a/runtime-plugin/1/shared/message.ts`)
      expect(panel.body).toContain(`${PLUGIN_FRONT_RUNTIME_BASE_PATH}/workspace-a/runtime-plugin/1/front/logo.svg?import&module`)
      expect(panel.body).toContain(`${PLUGIN_FRONT_RUNTIME_BASE_PATH}/__vite/singleton/react`)
      const reactSingletonPath = panel.body.match(/"(\/api\/v1\/agent-plugins\/runtime\/__vite\/singleton\/react)"/)?.[1]
      expect(reactSingletonPath).toBeTruthy()
      const reactSingleton = await app.inject({ method: "GET", url: reactSingletonPath! })
      expect(reactSingleton.statusCode).toBe(200)
      expect(reactSingleton.body).toContain("export const useEffectEvent")
      expect(reactSingleton.body).toContain("export const Activity")

      const logo = await app.inject({
        method: "GET",
        url: `${PLUGIN_FRONT_RUNTIME_BASE_PATH}/workspace-a/runtime-plugin/1/front/logo.svg?import&module`,
      })
      expect(logo.statusCode).toBe(200)
      expect(logo.headers["content-type"]).toContain("application/javascript")
      expect(logo.body).toContain("data:image/svg+xml;base64")
      const rawLogo = await app.inject({
        method: "GET",
        url: `${PLUGIN_FRONT_RUNTIME_BASE_PATH}/workspace-a/runtime-plugin/1/front/logo.svg`,
      })
      expect(rawLogo.statusCode).toBe(200)
      expect(rawLogo.headers["content-type"]).toContain("image/svg+xml")
      expect(rawLogo.body).toContain("<svg")

      const stylesheet = await app.inject({
        method: "GET",
        url: `${PLUGIN_FRONT_RUNTIME_BASE_PATH}/workspace-a/runtime-plugin/1/front/styles.css?import`,
      })
      expect(stylesheet.statusCode).toBe(200)
      expect(stylesheet.headers["content-type"]).toContain("application/javascript")

      expect(stylesheet.body).toContain(`${PLUGIN_FRONT_RUNTIME_BASE_PATH}/__vite/client`)
      expect((await app.inject({ method: "GET", url: "/@vite/client" })).statusCode).toBe(404)

      const workspaceSingletonPaths = [...entry.body.matchAll(/"(\/api\/v1\/agent-plugins\/runtime\/__vite\/singleton\/%40hachej%2Fboring-workspace(?:%2Fplugin|%2Fevents))"/g)]
        .map((match) => match[1])
        .sort()
      expect(workspaceSingletonPaths).toEqual([
        `${PLUGIN_FRONT_RUNTIME_BASE_PATH}/__vite/singleton/%40hachej%2Fboring-workspace%2Fevents`,
        `${PLUGIN_FRONT_RUNTIME_BASE_PATH}/__vite/singleton/%40hachej%2Fboring-workspace%2Fplugin`,
      ])
      const workspacePluginSingleton = await app.inject({ method: "GET", url: `${PLUGIN_FRONT_RUNTIME_BASE_PATH}/__vite/singleton/%40hachej%2Fboring-workspace%2Fplugin` })
      expect(workspacePluginSingleton.statusCode).toBe(200)
      expect(workspacePluginSingleton.body).toContain("export const definePlugin")
      expect((await app.inject({ method: "GET", url: "/packages/agent/src/shared/error-codes.ts" })).statusCode).toBe(404)

      const underscoreWorkspaceUrl = host.trackPlugin({
        workspaceId: "_app-1234abcd",
        plugin,
        revision: 1,
        frontEntrySubpath: "front/index.tsx",
      })
      expect(underscoreWorkspaceUrl).toContain("/_app-1234abcd/")

      expect(diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({
          level: "info",
          stage: "cache",
          outcome: "cache-miss",
          workspaceId: "workspace-a",
          pluginId: "runtime-plugin",
          revision: 1,
          requestedPath: "front/index.tsx",
        }),
      ]))
    } finally {
      await app.close()
    }
    // Full Vite module-graph transform is heavy; give it headroom on loaded CI runners.
  }, 120_000)

  test("serves minted Vite client/env support routes without the full runtime graph", async () => {
    const pluginRoot = await makeTempDir("plugin-front-runtime-vite-support-")
    const plugin = await writeRuntimePlugin(pluginRoot, {
      "front/index.tsx": 'import "./styles.css"\nexport const ok = true\n',
      "front/styles.css": ".runtime-panel { color: tomato; }\n",
    })

    const host = await createPluginFrontRuntimeHost()
    const app = fastify({ logger: false })
    await host.registerRoutes(app)
    host.trackPlugin({
      workspaceId: "workspace-a",
      plugin,
      revision: 1,
      frontEntrySubpath: "front/index.tsx",
    })

    try {
      const stylesheet = await app.inject({
        method: "GET",
        url: `${PLUGIN_FRONT_RUNTIME_BASE_PATH}/workspace-a/runtime-plugin/1/front/styles.css?import`,
      })
      expect(stylesheet.statusCode).toBe(200)
      expect(stylesheet.body).toContain(`${PLUGIN_FRONT_RUNTIME_BASE_PATH}/__vite/client`)

      const viteClient = await app.inject({ method: "GET", url: `${PLUGIN_FRONT_RUNTIME_BASE_PATH}/__vite/client` })
      expect(viteClient.statusCode).toBe(200)
      expect(viteClient.headers["content-type"]).toContain("javascript")
      expect(viteClient.body).not.toContain("/@vite/env")
      expect(viteClient.body).not.toContain("/@fs/")
      const envSupportPath = viteClient.body.match(new RegExp(`"(${PLUGIN_FRONT_RUNTIME_BASE_PATH}/__vite/(?:env|proxy/[^"']*env\\.mjs))"`))?.[1]
      expect(envSupportPath).toBeTruthy()
      const mintedEnv = await app.inject({ method: "GET", url: envSupportPath! })
      expect(mintedEnv.statusCode).toBe(200)
      expect(mintedEnv.headers["content-type"]).toContain("javascript")

      const viteEnv = await app.inject({ method: "GET", url: `${PLUGIN_FRONT_RUNTIME_BASE_PATH}/__vite/env` })
      expect(viteEnv.statusCode).toBe(200)
      expect(viteEnv.headers["content-type"]).toContain("javascript")
    } finally {
      await app.close()
    }
  }, 20_000)

  test("rejects direct __vite proxy access that was never minted by a validated runtime request", async () => {
    const host = await createPluginFrontRuntimeHost()
    const app = fastify({ logger: false })
    await host.registerRoutes(app)

    try {
      const response = await app.inject({
        method: "GET",
        url: `${PLUGIN_FRONT_RUNTIME_BASE_PATH}/__vite/proxy/packages%2Fagent%2Fsrc%2Fshared%2Ferror-codes.ts`,
      })
      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({
        error: expect.objectContaining({ code: ErrorCode.enum.PATH_NOT_FOUND }),
      })

      const traversal = await app.inject({
        method: "GET",
        url: `${PLUGIN_FRONT_RUNTIME_BASE_PATH}/__vite/proxy/node_modules%2F.vite%2Fdeps%2F..%2F..%2Fpackages%2Fagent%2Fsrc%2Fshared%2Ferror-codes.ts`,
      })
      expect(traversal.statusCode).toBe(404)
    } finally {
      await app.close()
    }
  }, 20_000)

  test("rejects symlinked allowed roots that escape the plugin root", async () => {
    const pluginRoot = await makeTempDir("plugin-front-runtime-root-symlink-escape-")
    const outsideRoot = await makeTempDir("plugin-front-runtime-root-symlink-target-")
    await mkdir(join(pluginRoot, "front"), { recursive: true })
    await writeFile(join(pluginRoot, "front", "index.tsx"), 'export const ok = true\n', "utf8")
    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({
      name: "runtime-plugin",
      version: "1.0.0",
      boring: { front: "front/index.tsx", label: "Runtime Plugin" },
    }), "utf8")
    await mkdir(outsideRoot, { recursive: true })
    await writeFile(join(outsideRoot, "secret.ts"), 'export const secret = true\n', "utf8")
    await symlink(outsideRoot, join(pluginRoot, "shared"))

    const plugin: BoringServerPluginManifest = {
      id: "runtime-plugin",
      rootDir: pluginRoot,
      version: "1.0.0",
      boring: { front: "front/index.tsx", label: "Runtime Plugin" },
      frontPath: join(pluginRoot, "front", "index.tsx"),
    }

    const host = await createPluginFrontRuntimeHost()
    const app = fastify({ logger: false })
    await host.registerRoutes(app)
    host.trackPlugin({ workspaceId: "workspace-a", plugin, revision: 1, frontEntrySubpath: "front/index.tsx" })

    try {
      const escapedRoot = await app.inject({
        method: "GET",
        url: `${PLUGIN_FRONT_RUNTIME_BASE_PATH}/workspace-a/runtime-plugin/1/shared/secret.ts`,
      })
      expect(escapedRoot.statusCode).toBe(404)
      expect(escapedRoot.json()).toEqual({
        error: expect.objectContaining({ code: ErrorCode.enum.PATH_NOT_FOUND }),
      })
    } finally {
      await app.close()
    }
  }, 20_000)

  test("rejects stale revisions, private files, symlink escapes, and null-byte paths with stable codes", async () => {
    const pluginRoot = await makeTempDir("plugin-front-runtime-validation-")
    const outsideRoot = await makeTempDir("plugin-front-runtime-outside-")
    await writeFile(join(outsideRoot, "escape.tsx"), 'export const escaped = true\n', "utf8")
    const plugin = await writeRuntimePlugin(pluginRoot, {
      "front/index.tsx": 'export const ok = true\n',
      "front/Package.json": '{}\n',
    })
    await symlink(join(outsideRoot, "escape.tsx"), join(pluginRoot, "front", "escape.tsx"))

    const host = await createPluginFrontRuntimeHost()
    const app = fastify({ logger: false })
    await host.registerRoutes(app)
    host.trackPlugin({ workspaceId: "workspace-a", plugin, revision: 2, frontEntrySubpath: "front/index.tsx" })

    try {
      const stale = await app.inject({
        method: "GET",
        url: `${PLUGIN_FRONT_RUNTIME_BASE_PATH}/workspace-a/runtime-plugin/1/front/index.tsx`,
      })
      expect(stale.statusCode).toBe(409)
      expect(stale.json()).toEqual({
        error: expect.objectContaining({ code: ErrorCode.enum.PLUGIN_RUNTIME_REVISION_MISMATCH }),
      })

      const privateFile = await app.inject({
        method: "GET",
        url: `${PLUGIN_FRONT_RUNTIME_BASE_PATH}/workspace-a/runtime-plugin/2/front/.env`,
      })
      expect(privateFile.statusCode).toBe(403)
      expect(privateFile.json()).toEqual({
        error: expect.objectContaining({ code: ErrorCode.enum.PLUGIN_RUNTIME_PRIVATE_FILE }),
      })

      const casedPrivateFile = await app.inject({
        method: "GET",
        url: `${PLUGIN_FRONT_RUNTIME_BASE_PATH}/workspace-a/runtime-plugin/2/front/Package.json`,
      })
      expect(casedPrivateFile.statusCode).toBe(403)
      expect(casedPrivateFile.json()).toEqual({
        error: expect.objectContaining({ code: ErrorCode.enum.PLUGIN_RUNTIME_PRIVATE_FILE }),
      })

      const symlinkEscape = await app.inject({
        method: "GET",
        url: `${PLUGIN_FRONT_RUNTIME_BASE_PATH}/workspace-a/runtime-plugin/2/front/escape.tsx`,
      })
      expect(symlinkEscape.statusCode).toBe(404)
      expect(symlinkEscape.json()).toEqual({
        error: expect.objectContaining({ code: ErrorCode.enum.PATH_NOT_FOUND }),
      })

      await expect(host.serve({
        workspaceId: "workspace-a",
        pluginId: "runtime-plugin",
        revision: 2,
        subpath: `front/\0secret.tsx`,
      })).rejects.toMatchObject({ code: ErrorCode.enum.PATH_NULL_BYTE, statusCode: 400 })
    } finally {
      await app.close()
    }
  }, 20_000)

  test("allows nested front entries to import siblings anywhere under front/", async () => {
    const pluginRoot = await makeTempDir("plugin-front-runtime-nested-front-")
    const plugin = await writeRuntimePlugin(pluginRoot, {
      "front/nested/index.ts": 'import { Panel } from "../shared-ui"\nexport const Demo = Panel\n',
      "front/shared-ui.ts": 'export function Panel() { return "nested ok" }\n',
    })
    plugin.boring.front = "front/nested/index.ts"
    plugin.frontPath = join(pluginRoot, "front", "nested", "index.ts")

    const host = await createPluginFrontRuntimeHost()
    const app = fastify({ logger: false })
    await host.registerRoutes(app)
    const entryUrl = host.trackPlugin({
      workspaceId: "workspace-a",
      plugin,
      revision: 1,
      frontEntrySubpath: "front/nested/index.ts",
    })

    try {
      const entry = await app.inject({ method: "GET", url: entryUrl })
      expect(entry.statusCode).toBe(200)
      expect(entry.body).toContain(`${PLUGIN_FRONT_RUNTIME_BASE_PATH}/workspace-a/runtime-plugin/1/front/shared-ui.ts`)

      await writeFile(join(pluginRoot, "front", "shared-ui.ts"), 'export function Panel() { return "revision two" }\n', "utf8")
      host.trackPlugin({
        workspaceId: "workspace-a",
        plugin,
        revision: 2,
        frontEntrySubpath: "front/nested/index.ts",
      })
      await rm(join(pluginRoot, "front", "shared-ui.ts"), { force: true })
      const previousGoodLazyChunk = await app.inject({
        method: "GET",
        url: `${PLUGIN_FRONT_RUNTIME_BASE_PATH}/workspace-a/runtime-plugin/1/front/shared-ui.ts`,
      })
      expect(previousGoodLazyChunk.statusCode).toBe(200)
      expect(previousGoodLazyChunk.body).toContain("nested ok")
      expect(previousGoodLazyChunk.body).not.toContain("revision two")
      await writeFile(join(pluginRoot, "front", "late.tsx"), "export const late = true\n", "utf8")
      const lateFileOnOldRevision = await app.inject({
        method: "GET",
        url: `${PLUGIN_FRONT_RUNTIME_BASE_PATH}/workspace-a/runtime-plugin/1/front/late.tsx`,
      })
      expect(lateFileOnOldRevision.statusCode).toBe(404)
    } finally {
      await app.close()
    }
  }, 20_000)

  test("keeps plain strings/comments from tripping unsafe-import validation", async () => {
    const pluginRoot = await makeTempDir("plugin-front-runtime-string-literal-")
    const plugin = await writeRuntimePlugin(pluginRoot, {
      "front/index.tsx": [
        'export const example = "from \'node:fs\'"',
        'export const docs = "import(target)"',
        'export const templateDocs = `import("./child")`',
        '// import(target)',
      ].join("\n"),
    })

    const host = await createPluginFrontRuntimeHost()
    host.trackPlugin({
      workspaceId: "workspace-a",
      plugin,
      revision: 1,
      frontEntrySubpath: "front/index.tsx",
    })

    try {
      const entry = await host.serve({
        workspaceId: "workspace-a",
        pluginId: "runtime-plugin",
        revision: 1,
        subpath: "front/index.tsx",
      })
      expect(entry.body).toContain("example")
    } finally {
      await host.close()
    }
  }, 20_000)

  test("does not mint privileged Vite proxy URLs from plain strings", async () => {
    const pluginRoot = await makeTempDir("plugin-front-runtime-plain-host-string-")
    const plugin = await writeRuntimePlugin(pluginRoot, {
      "front/index.tsx": [
        'export const hostPath = "/packages/agent/src/server/registerAgentRoutes.ts"',
        `export const forgedRuntimePath = "${PLUGIN_FRONT_RUNTIME_BASE_PATH}/__vite/proxy/packages%2Fagent%2Fsrc%2Fserver%2FregisterAgentRoutes.ts"`,
        'export const importText = \'import "/packages/agent/src/shared/error-codes.ts"\'',
      ].join("\n"),
    })

    const host = await createPluginFrontRuntimeHost()
    const app = fastify({ logger: false })
    await host.registerRoutes(app)
    host.trackPlugin({ workspaceId: "workspace-a", plugin, revision: 1, frontEntrySubpath: "front/index.tsx" })

    try {
      const entry = await app.inject({
        method: "GET",
        url: `${PLUGIN_FRONT_RUNTIME_BASE_PATH}/workspace-a/runtime-plugin/1/front/index.tsx`,
      })
      expect(entry.statusCode).toBe(200)
      expect(entry.body).toContain("/packages/agent/src/server/registerAgentRoutes.ts")
      expect(entry.body).toContain(`${PLUGIN_FRONT_RUNTIME_BASE_PATH}/__vite/proxy/packages%2Fagent%2Fsrc%2Fserver%2FregisterAgentRoutes.ts`)

      const forgedProxy = await app.inject({
        method: "GET",
        url: `${PLUGIN_FRONT_RUNTIME_BASE_PATH}/__vite/proxy/packages%2Fagent%2Fsrc%2Fserver%2FregisterAgentRoutes.ts`,
      })
      expect(forgedProxy.statusCode).toBe(404)
    } finally {
      await app.close()
    }
  }, 20_000)

  test("rejects CSS absolute imports with a structured unsafe-import error", async () => {
    const pluginRoot = await makeTempDir("plugin-front-runtime-css-unsafe-")
    const plugin = await writeRuntimePlugin(pluginRoot, {
      "front/index.tsx": 'import "./bad.css"\nimport "./bad-unquoted.css"\nexport const ok = true\n',
      "front/bad.css": '@import "/packages/agent/src/shared/error-codes.ts";\n',
      "front/bad-unquoted.css": '@import url(/packages/agent/src/shared/error-codes.ts);\n',
    })

    const host = await createPluginFrontRuntimeHost()
    host.trackPlugin({ workspaceId: "workspace-a", plugin, revision: 1, frontEntrySubpath: "front/index.tsx" })

    try {
      await expect(host.serve({
        workspaceId: "workspace-a",
        pluginId: "runtime-plugin",
        revision: 1,
        subpath: "front/bad.css",
        search: "?import",
      })).rejects.toMatchObject({ code: ErrorCode.enum.PLUGIN_RUNTIME_UNSAFE_IMPORT, statusCode: 400 })

      await expect(host.serve({
        workspaceId: "workspace-a",
        pluginId: "runtime-plugin",
        revision: 1,
        subpath: "front/bad-unquoted.css",
        search: "?import",
      })).rejects.toMatchObject({ code: ErrorCode.enum.PLUGIN_RUNTIME_UNSAFE_IMPORT, statusCode: 400 })
    } finally {
      await host.close()
    }
  }, 20_000)

  test("exposes host singleton allowlist and rejects literal + computed absolute import bypasses", async () => {
    const pluginRoot = await makeTempDir("plugin-front-runtime-singleton-")
    const plugin = await writeRuntimePlugin(pluginRoot, {
      "front/index.tsx": 'export const ok = true\n',
      "front/absolute.tsx": `import React from ${JSON.stringify(`file://${join(pluginRoot, "node_modules", "react", "index.js")}`)}\nexport default React\n`,
      "front/vendored-react.tsx": 'import React from "./node_modules/react/index.js"\nexport default React\n',
      "front/computed.tsx": [
        `const target = \`${`file://${join(pluginRoot, "node_modules", "react", "index.js")}`}\``,
        'export const load = () => import(target)',
      ].join("\n"),
      "front/template.tsx": [
        'export const load = () => import(`./child`)',
      ].join("\n"),
      "front/glob.tsx": [
        'export const modules = import.meta.glob("/packages/agent/src/**/*.ts", { eager: true, query: "?raw" })',
      ].join("\n"),
      "front/server-import.tsx": 'import { createWorkspaceAgentServer } from "@hachej/boring-workspace/app/server"\nexport const server = createWorkspaceAgentServer\n',
      "front/child.tsx": 'export const child = true\n',
      "node_modules/react/index.js": 'export default { local: true }\n',
    })

    const host = await createPluginFrontRuntimeHost()
    host.trackPlugin({ workspaceId: "workspace-a", plugin, revision: 1, frontEntrySubpath: "front/index.tsx" })

    try {
      expect(host.singletonModules).toEqual(expect.arrayContaining([
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@hachej/boring-workspace",
        "@hachej/boring-workspace/plugin",
      ]))
      const jsxDevSingletonCode = __testingRuntimeSingletonModuleCode("react/jsx-dev-runtime") ?? ""
      expect(jsxDevSingletonCode).toContain("export default normalized")
      expect(jsxDevSingletonCode).toContain("export const jsxDEV = normalized")

      await expect(host.serve({
        workspaceId: "workspace-a",
        pluginId: "runtime-plugin",
        revision: 1,
        subpath: "front/absolute.tsx",
      })).rejects.toMatchObject({ code: ErrorCode.enum.PLUGIN_RUNTIME_UNSAFE_IMPORT, statusCode: 400 })

      await expect(host.serve({
        workspaceId: "workspace-a",
        pluginId: "runtime-plugin",
        revision: 1,
        subpath: "front/vendored-react.tsx",
      })).rejects.toMatchObject({ code: ErrorCode.enum.PLUGIN_RUNTIME_PRIVATE_FILE, statusCode: 403 })

      await expect(host.serve({
        workspaceId: "workspace-a",
        pluginId: "runtime-plugin",
        revision: 1,
        subpath: "front/computed.tsx",
      })).rejects.toMatchObject({ code: ErrorCode.enum.PLUGIN_RUNTIME_UNSAFE_IMPORT, statusCode: 400 })

      await expect(host.serve({
        workspaceId: "workspace-a",
        pluginId: "runtime-plugin",
        revision: 1,
        subpath: "front/template.tsx",
      })).rejects.toMatchObject({ code: ErrorCode.enum.PLUGIN_RUNTIME_UNSAFE_IMPORT, statusCode: 400 })

      await expect(host.serve({
        workspaceId: "workspace-a",
        pluginId: "runtime-plugin",
        revision: 1,
        subpath: "front/glob.tsx",
      })).rejects.toMatchObject({ code: ErrorCode.enum.PLUGIN_RUNTIME_UNSAFE_IMPORT, statusCode: 400 })

      await expect(host.serve({
        workspaceId: "workspace-a",
        pluginId: "runtime-plugin",
        revision: 1,
        subpath: "front/server-import.tsx",
      })).rejects.toMatchObject({ code: ErrorCode.enum.PLUGIN_RUNTIME_UNSAFE_IMPORT, statusCode: 400 })
    } finally {
      await host.close()
    }
  }, 20_000)

  test("does not create native runtime targets for root-level front entries", async () => {
    const pluginRoot = await makeTempDir("plugin-front-runtime-root-front-")
    const plugin = await writeRuntimePlugin(pluginRoot, {
      "index.tsx": "export default function Plugin() { return null }\n",
    })
    plugin.boring.front = "index.tsx"
    plugin.frontPath = join(pluginRoot, "index.tsx")

    const host = await createPluginFrontRuntimeHost()
    try {
      const resolver = host.createFrontTargetResolver("workspace-a")
      expect(resolver(plugin, { revision: 1, frontEntrySubpath: "index.tsx" })).toBeUndefined()
      expect(() => host.trackPlugin({
        workspaceId: "workspace-a",
        plugin,
        revision: 1,
        frontEntrySubpath: "index.tsx",
      })).toThrow(/front\/ directory/)
    } finally {
      await host.close()
    }
  }, 20_000)

  test("logs cache hit/miss fields and invalidates narrowly on revision changes and workspace disposal", async () => {
    const diagnostics: PluginFrontRuntimeDiagnostic[] = []
    const pluginRoot = await makeTempDir("plugin-front-runtime-cache-")
    const plugin = await writeRuntimePlugin(pluginRoot, {
      "front/index.tsx": 'export const version = "v1"\n',
    })

    const host = await createPluginFrontRuntimeHost({ onDiagnostic: (entry) => diagnostics.push(entry) })
    const app = fastify({ logger: false })
    await host.registerRoutes(app)
    const firstUrl = host.trackPlugin({
      workspaceId: "workspace-a",
      plugin,
      revision: 1,
      frontEntrySubpath: "front/index.tsx",
    })

    try {
      const first = await app.inject({ method: "GET", url: `${firstUrl}?v=1&t=one` })
      const second = await app.inject({ method: "GET", url: `${firstUrl}?v=1&t=two` })
      expect(first.statusCode).toBe(200)
      expect(second.statusCode).toBe(200)
      expect(first.body).toBe(second.body)

      await writeFile(join(pluginRoot, "front", "index.tsx"), 'export const version = "v2"\n', "utf8")
      const secondUrl = host.trackPlugin({
        workspaceId: "workspace-a",
        plugin,
        revision: 2,
        frontEntrySubpath: "front/index.tsx",
      })
      const newRevision = await app.inject({ method: "GET", url: `${secondUrl}?v=2&t=three` })
      expect(newRevision.statusCode).toBe(200)
      expect(newRevision.body).not.toBe(first.body)

      await host.disposeWorkspace("workspace-a")
      const disposed = await app.inject({ method: "GET", url: `${secondUrl}?v=2&t=four` })
      expect(disposed.statusCode).toBe(404)
      expect(disposed.json()).toEqual({
        error: expect.objectContaining({ code: ErrorCode.enum.PATH_NOT_FOUND }),
      })

      expect(diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({
          level: "info",
          stage: "cache",
          outcome: "cache-miss",
          workspaceId: "workspace-a",
          pluginId: "runtime-plugin",
          revision: 1,
          requestedPath: "front/index.tsx",
        }),
        expect.objectContaining({
          level: "info",
          stage: "cache",
          outcome: "cache-hit",
          workspaceId: "workspace-a",
          pluginId: "runtime-plugin",
          revision: 1,
          requestedPath: "front/index.tsx",
        }),
        expect.objectContaining({
          level: "info",
          stage: "cleanup",
          outcome: "disposed",
          workspaceId: "workspace-a",
          pluginId: "runtime-plugin",
          revision: 1,
          requestedPath: "front/index.tsx",
        }),
        expect.objectContaining({
          level: "warn",
          stage: "validate",
          outcome: "rejected",
          workspaceId: "workspace-a",
          pluginId: "runtime-plugin",
          revision: 2,
          requestedPath: "front/index.tsx",
          code: ErrorCode.enum.PATH_NOT_FOUND,
        }),
      ]))
    } finally {
      await app.close()
    }
  }, 20_000)
})

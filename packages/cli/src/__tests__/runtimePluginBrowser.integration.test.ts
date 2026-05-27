/**
 * Rerun manually from packages/cli:
 *   ../../node_modules/.bin/vitest run src/__tests__/runtimePluginBrowser.integration.test.ts --reporter=dot
 */
import { execFileSync } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium, expect as pwExpect } from "@playwright/test"
import type { FastifyInstance } from "fastify"
import { afterEach, beforeAll, expect, test } from "vitest"
import { registerStatic } from "../server/cli.js"
import { createLocalWorkspaceRegistry } from "../server/localWorkspaces.js"
import { createLocalFolderModeApp, createLocalWorkspacesModeApp } from "./localRuntimePluginHarness"

const testDir = dirname(fileURLToPath(import.meta.url))
const cliRoot = resolve(testDir, "../..")
const publicDir = join(cliRoot, "public")
const tempDirs: string[] = []
const openApps: FastifyInstance[] = []
const originalHome = process.env.HOME
const originalRegistry = process.env.BORING_UI_WORKSPACES_PATH

beforeAll(() => {
  execFileSync(resolve(cliRoot, "../../node_modules/.bin/vite"), ["build", "--config", resolve(cliRoot, "vite.config.ts")], {
    cwd: cliRoot,
    stdio: "ignore",
  })
}, 300_000)

afterEach(async () => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  if (originalRegistry === undefined) delete process.env.BORING_UI_WORKSPACES_PATH
  else process.env.BORING_UI_WORKSPACES_PATH = originalRegistry
  await Promise.all(openApps.splice(0).map((app) => app.close()))
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function writeRuntimePlugin(root: string, options: {
  pluginId: string
  title: string
  label: string
  bodyText: string
  leftTabId?: string
  extraImports?: string
  delayMs?: number
}) {
  await mkdir(join(root, "front"), { recursive: true })
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: options.pluginId,
    version: "1.0.0",
    boring: { front: "front/index.tsx", label: options.label },
  }, null, 2), "utf8")
  const delayBlock = options.delayMs
    ? `await new Promise((resolve) => setTimeout(resolve, ${options.delayMs}))\n`
    : ""
  await writeFile(join(root, "front", "index.tsx"), `${options.extraImports ?? ""}
import { useState } from "react"
import { definePlugin } from "@hachej/boring-workspace/plugin"
${delayBlock}
function RuntimePane() {
  const [value] = useState(${JSON.stringify(options.bodyText)})
  return <div>{value}</div>
}

export default definePlugin({
  id: ${JSON.stringify(options.pluginId)},
  leftTabs: [{
    id: ${JSON.stringify(options.leftTabId ?? `${options.pluginId}.tab`)},
    title: ${JSON.stringify(options.title)},
    panelId: ${JSON.stringify(options.leftTabId ?? `${options.pluginId}.tab`)},
    component: RuntimePane,
  }],
})
`, "utf8")
}

async function removeRuntimeFront(root: string) {
  const pkgPath = join(root, "package.json")
  const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as { boring?: Record<string, unknown> }
  if (pkg.boring) delete pkg.boring.front
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2), "utf8")
}

async function startApp(app: FastifyInstance): Promise<string> {
  openApps.push(app)
  await registerStatic(app, publicDir)
  return await app.listen({ port: 0, host: "127.0.0.1" })
}

async function withBrowser(run: (page: import("@playwright/test").Page, trace: string[]) => Promise<void>) {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const trace: string[] = []
  page.on("console", (message) => trace.push(`[browser:${message.type()}] ${message.text()}`))
  try {
    await run(page, trace)
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n\nTrace:\n${trace.join("\n")}`)
  } finally {
    await browser.close()
  }
}

async function reloadViaBrowser(page: import("@playwright/test").Page, headers?: Record<string, string>) {
  return await page.evaluate(async (requestHeaders) => {
    const response = await fetch("/api/v1/agent/reload", {
      method: "POST",
      headers: requestHeaders,
    })
    return {
      status: response.status,
      json: await response.json(),
    }
  }, headers ?? {})
}

test("built folder mode browser path hot-loads, preserves previous-good revisions, and unloads removed fronts", { timeout: 180_000 }, async () => {
  const homeRoot = await makeTempDir("boring-cli-browser-folder-home-")
  const workspaceRoot = await makeTempDir("boring-cli-browser-folder-workspace-")
  process.env.HOME = homeRoot

  const pluginRoot = join(workspaceRoot, ".pi", "extensions", "runtime-plugin")
  await writeRuntimePlugin(pluginRoot, {
    pluginId: "runtime-plugin",
    title: "Runtime Tab",
    label: "Runtime Plugin",
    bodyText: "runtime-plugin-ready-v1",
  })

  const app = await createLocalFolderModeApp({
    workspaceRoot,
    mode: "direct",
    projectName: "Folder Browser",
  })
  const address = await startApp(app)

  await withBrowser(async (page, trace) => {
    trace.push("open folder mode page")
    await page.goto(address, { waitUntil: "load" })
    await pwExpect(page.getByText("Trusted local runtime plugins")).toBeVisible()
    await page.getByRole("button", { name: "Workbench" }).click()
    await pwExpect(page.getByText("Runtime Tab")).toBeVisible()

    trace.push("render runtime plugin left tab v1")
    await page.locator('button[role="tab"]').filter({ hasText: "Runtime Tab" }).click({ force: true })
    await pwExpect(page.getByText("runtime-plugin-ready-v1")).toBeVisible()

    trace.push("reload to v2")
    await writeRuntimePlugin(pluginRoot, {
      pluginId: "runtime-plugin",
      title: "Runtime Tab",
      label: "Runtime Plugin",
      bodyText: "runtime-plugin-ready-v2",
    })
    const reloadV2 = await reloadViaBrowser(page)
    expect(reloadV2.status).toBe(200)
    await pwExpect(page.getByText("runtime-plugin-ready-v2")).toBeVisible()
    const runtimeUrlAfterV2 = ((await app.inject({ method: "GET", url: "/api/v1/agent-plugins" })).json() as Array<{ id: string; frontTarget?: { entryUrl?: string } }>)
      .find((plugin) => plugin.id === "runtime-plugin")?.frontTarget?.entryUrl
    expect(runtimeUrlAfterV2).toBeTruthy()

    trace.push("reload with unsafe import keeps previous good revision")
    await writeRuntimePlugin(pluginRoot, {
      pluginId: "runtime-plugin",
      title: "Runtime Tab",
      label: "Runtime Plugin",
      bodyText: "runtime-plugin-bad-import",
      extraImports: 'import "/packages/agent/src/shared/error-codes.ts"\n',
    })
    const reloadBadImport = await reloadViaBrowser(page)
    expect(reloadBadImport.status).toBe(200)
    await pwExpect(page.getByText("runtime-plugin-ready-v2")).toBeVisible()
    const runtimeUrlAfterBadImport = ((await app.inject({ method: "GET", url: "/api/v1/agent-plugins" })).json() as Array<{ id: string; frontTarget?: { entryUrl?: string } }>)
      .find((plugin) => plugin.id === "runtime-plugin")?.frontTarget?.entryUrl
    expect(runtimeUrlAfterBadImport).toBeTruthy()
    const runtimeImportError = await app.inject({ method: "GET", url: runtimeUrlAfterBadImport! })
    expect(runtimeImportError.statusCode).toBe(400)
    expect(runtimeImportError.body).toContain("plugin runtime import bypasses the host runtime URL space")

    trace.push("reload with register collision keeps previous good revision")
    await writeRuntimePlugin(pluginRoot, {
      pluginId: "runtime-plugin",
      title: "Runtime Tab",
      label: "Runtime Plugin",
      bodyText: "runtime-plugin-bad-register",
      leftTabId: "files",
    })
    const reloadBadRegister = await reloadViaBrowser(page)
    expect(reloadBadRegister.status).toBe(200)
    await pwExpect(page.getByText("runtime-plugin-ready-v2")).toBeVisible()
    await pwExpect.poll(() => trace.some((line) => line.includes("PLUGIN_OUTPUT_ID_COLLISION"))).toBe(true)

    trace.push("remove boring.front and verify unload")
    await removeRuntimeFront(pluginRoot)
    const reloadRemoved = await reloadViaBrowser(page)
    expect(reloadRemoved.status).toBe(200)
    await pwExpect(page.getByText("Runtime Tab")).toHaveCount(0)
    await pwExpect(page.getByText("runtime-plugin-ready-v2")).toHaveCount(0)
    const removedRuntime = await app.inject({ method: "GET", url: runtimeUrlAfterV2! })
    expect(removedRuntime.statusCode).toBe(404)
  })
})

test("built workspaces mode browser path handles zero-plugin replay completion and workspace-switch races", { timeout: 180_000 }, async () => {
  const homeRoot = await makeTempDir("boring-cli-browser-workspaces-home-")
  const registryPath = join(await makeTempDir("boring-cli-browser-workspaces-registry-"), "workspaces.yaml")
  const workspaceA = await makeTempDir("boring-cli-browser-workspace-a-")
  const workspaceB = await makeTempDir("boring-cli-browser-workspace-b-")
  process.env.HOME = homeRoot
  process.env.BORING_UI_WORKSPACES_PATH = registryPath

  await writeRuntimePlugin(join(workspaceA, ".pi", "extensions", "slow-plugin"), {
    pluginId: "slow-plugin",
    title: "Slow Tab",
    label: "Slow Plugin",
    bodyText: "slow-plugin-ready",
    delayMs: 1500,
  })
  const registry = createLocalWorkspaceRegistry(registryPath)
  const registeredA = await registry.add(workspaceA, { name: "Workspace A" })
  const registeredB = await registry.add(workspaceB, { name: "Workspace B" })

  const app = await createLocalWorkspacesModeApp({ mode: "direct", registryPath })
  const address = await startApp(app)

  await withBrowser(async (page, trace) => {
    trace.push("open workspace A and immediately switch to empty workspace B")
    await page.goto(`${address}/workspace/${encodeURIComponent(registeredA.id)}`, { waitUntil: "domcontentloaded" })
    await page.goto(`${address}/workspace/${encodeURIComponent(registeredB.id)}`, { waitUntil: "load" })

    await pwExpect(page.getByText("Trusted local runtime plugins")).toBeVisible()
    await pwExpect(page.getByText("Plugins loading…")).toHaveCount(0)
    await pwExpect(page.getByText("Slow Tab")).toHaveCount(0)
    await pwExpect(page.getByText("slow-plugin-ready")).toHaveCount(0)
    await pwExpect(page).toHaveURL(new RegExp(`/workspace/${registeredB.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`))
  })
})

import { test, expect } from "@playwright/test"
import { readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const SHELL_KEY = "boring-macro:shell"

async function bootClean(page: import("@playwright/test").Page): Promise<void> {
  await expect.poll(async () => {
    const res = await page.context().request.get("/health").catch(() => null)
    return res?.ok() ?? false
  }).toBe(true)
  await page.addInitScript((shellKey) => {
    localStorage.clear()
    localStorage.setItem(`${shellKey}:surface`, "1")
  }, SHELL_KEY)
  await page.goto("/", { waitUntil: "domcontentloaded" })
  await expect(page.getByRole("textbox", { name: /ask anything/i })).toBeVisible()
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const macroFrontPath = resolve(__dirname, "../src/plugins/macro/front/index.tsx")

test("/api/boring.reload exposes edited macro front factory through real Vite /@fs import", async ({ page, request }) => {
  const original = await readFile(macroFrontPath, "utf8")
  const needle = [
    "title: meta?.title || seriesId,",
    "        params: { seriesId },",
    "        score: 0,",
  ].join("\n")
  expect(original, "macro front surface resolver needle changed — update the e2e needle").toContain(needle)
  const marker = `HOT-${Date.now()}`
  const edited = original.replace(needle, [
    `title: \`${marker}:\${seriesId}\`,`,
    "        params: { seriesId },",
    "        score: 100,",
  ].join("\n"))

  await bootClean(page)

  try {
    await writeFile(macroFrontPath, edited, "utf8")
    const reload = await request.post("/api/boring.reload")
    expect(reload.status(), await reload.text()).toBe(200)
    const body = await reload.json() as { plugins: Array<{ id: string; revision: number; frontUrl?: string }> }
    const plugin = body.plugins.find((entry) => entry.id === "boring-plugin-macro")
    expect(plugin?.frontUrl).toBeTruthy()

    const resolved = await page.evaluate(async ({ frontUrl, revision, marker }) => {
      const mod = await import(/* @vite-ignore */ `${frontUrl}?import&e2e=${Date.now()}&v=${revision}`)
      const surfaceResolvers: Array<{ kind: string; resolve(request: { kind: string; target: string; meta?: unknown }): unknown }> = []
      const api = {
        registerPanel() {},
        registerLeftTab() {},
        registerCommand() {},
        registerSurfaceResolver(resolver: { kind: string; resolve(request: { kind: string; target: string; meta?: unknown }): unknown }) {
          surfaceResolvers.push(resolver)
        },
      }
      mod.default(api)
      const resolver = surfaceResolvers.find((entry) => entry.kind === "macro.open-series")
      return {
        title: (resolver?.resolve({ kind: "macro.open-series", target: "E2EHOT" }) as { title?: string } | undefined)?.title,
        marker,
      }
    }, { frontUrl: plugin!.frontUrl!, revision: plugin!.revision, marker })

    expect(resolved.title).toBe(`${marker}:E2EHOT`)
  } finally {
    await writeFile(macroFrontPath, original, "utf8")
    await request.post("/api/boring.reload").catch(() => undefined)
  }
})

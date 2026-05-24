import { readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const here = dirname(fileURLToPath(import.meta.url))
const pluginRoot = resolve(here, "../../..")
const repoRoot = resolve(pluginRoot, "../..")

function readJson(path: string) {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, any>
}

function listSourceFiles(root: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(root)) {
    const path = join(root, entry)
    if (entry === "dist" || entry === "node_modules") continue
    const stat = statSync(path)
    if (stat.isDirectory()) out.push(...listSourceFiles(path))
    else if (/\.[cm]?tsx?$/.test(entry)) out.push(path)
  }
  return out
}

describe("ask-user package boundary", () => {
  it("publishes intentional front/agent/shared subpaths and no server surface", () => {
    const manifest = readJson(join(pluginRoot, "package.json"))
    expect(Object.keys(manifest.exports)).toEqual(expect.arrayContaining([".", "./front", "./agent", "./shared", "./package.json"]))
    expect(manifest.exports["./server"]).toBeUndefined()
    expect(manifest.boring).toMatchObject({ label: "Questions", front: "dist/front/index.js" })
    expect(manifest.boring.server).toBeUndefined()
  })

  it("keeps ask-user contracts out of workspace and agent generic barrels", () => {
    const genericFiles = [
      "packages/workspace/src/shared/index.ts",
      "packages/workspace/src/index.ts",
      "packages/agent/src/server/index.ts",
      "packages/agent/src/shared/index.ts",
    ]
    for (const file of genericFiles) {
      const text = readFileSync(join(repoRoot, file), "utf8")
      expect(text, file).not.toMatch(/ask-user|AskUser|ASK_USER/)
    }
  })

  it("does not couple ask-user shared contracts to boring-agent or pi-ask-user wrappers", () => {
    const sharedFiles = listSourceFiles(join(pluginRoot, "src/shared"))
    for (const file of sharedFiles) {
      const text = readFileSync(file, "utf8")
      expect(text, relative(repoRoot, file)).not.toMatch(/from\s+["']@hachej\/boring-agent|from\s+["']@boring\/agent/)
    }
    const manifests = [join(repoRoot, "package.json"), join(pluginRoot, "package.json")]
    for (const manifestPath of manifests) {
      expect(readFileSync(manifestPath, "utf8"), relative(repoRoot, manifestPath)).not.toMatch(/pi-ask-user/)
    }
  })

  it("centralizes raw ASK_USER error string values in shared/error-codes.ts", () => {
    const offenders: string[] = []
    for (const file of listSourceFiles(join(pluginRoot, "src"))) {
      const rel = relative(pluginRoot, file)
      if (rel === "src/shared/error-codes.ts" || rel.includes("__tests__")) continue
      const text = readFileSync(file, "utf8")
      if (/["'`]ASK_USER_[A-Z0-9_]+["'`]/.test(text)) offenders.push(rel)
    }
    expect(offenders).toEqual([])
  })
})

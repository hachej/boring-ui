import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const INBOX_DIR = join(process.cwd(), "src/front/inbox")
const SOURCE_RE = /from\s+["']([^"']+)["']/g

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(entry) ? [path] : []
  })
}

describe("human-action inbox import boundary", () => {
  it("uses only public workspace imports, package imports, or local files", () => {
    const violations: string[] = []
    for (const file of sourceFiles(INBOX_DIR)) {
      const text = readFileSync(file, "utf8")
      for (const match of text.matchAll(SOURCE_RE)) {
        const source = match[1]!
        if (source.startsWith("../../../front/") || source.startsWith("../../../shared/") || source.includes("packages/workspace/src")) {
          violations.push(`${relative(process.cwd(), file)} deep-imports workspace internals via ${source}`)
          continue
        }
        if (source.startsWith(".") || source.startsWith("@hachej/boring-workspace") || source.startsWith("@hachej/boring-ui-kit") || !source.startsWith("@hachej/")) continue
        violations.push(`${relative(process.cwd(), file)} imports ${source}`)
      }
    }
    expect(violations).toEqual([])
  })
})

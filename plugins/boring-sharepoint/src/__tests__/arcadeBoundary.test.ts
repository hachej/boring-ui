import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

const packageRoot = new URL("../..", import.meta.url)

describe("Arcade package boundaries", () => {
  it("keeps Arcade SDK imports out of shared and front source", () => {
    const forbiddenMatches = listSourceFiles("src")
      .filter((path) => path.includes("/shared/") || path.includes("/front/"))
      .flatMap((path) => {
        const source = readFileSync(path, "utf8")
        return source.includes("@arcadeai/arcadejs") ? [relative(packageRoot.pathname, path)] : []
      })

    expect(forbiddenMatches).toEqual([])
  })

  it("does not call Microsoft Graph directly from plugin source", () => {
    const forbiddenMatches = listSourceFiles("src")
      .filter((path) => !path.includes("/__tests__/"))
      .flatMap((path) => {
        const source = readFileSync(path, "utf8")
        return /graph\.microsoft\.com|driveItem:preview/i.test(source) ? [relative(packageRoot.pathname, path)] : []
      })

    expect(forbiddenMatches).toEqual([])
  })
})

function listSourceFiles(path: string): string[] {
  const absolutePath = join(packageRoot.pathname, path)
  const stat = statSync(absolutePath)
  if (stat.isFile()) return absolutePath.endsWith(".ts") || absolutePath.endsWith(".tsx") ? [absolutePath] : []
  return readdirSync(absolutePath).flatMap((entry) => listSourceFiles(join(path, entry)))
}

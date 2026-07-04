import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

const packageRoot = new URL("../..", import.meta.url)

describe("SharePoint plugin package boundaries", () => {
  it("keeps Arcade SDK and server imports out of source", () => {
    const forbiddenPackage = ["@arcadeai", "arcadejs"].join("/")
    const forbiddenWorkspaceServer = ["@hachej", "boring-workspace", "server"].join("/")
    const relativeServerImport = /from\s+["']\.\.?\/server(?:\/|["'])/

    const forbiddenMatches = listSourceFiles("src").flatMap((path) => {
      const source = readFileSync(path, "utf8")
      const matches: string[] = []
      if (source.includes(forbiddenPackage)) matches.push(`${relative(packageRoot.pathname, path)} imports Arcade SDK`)
      if (source.includes(forbiddenWorkspaceServer) || relativeServerImport.test(source)) {
        matches.push(`${relative(packageRoot.pathname, path)} imports server code`)
      }
      return matches
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

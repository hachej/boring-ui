import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { describe, expect, it } from "vitest"

const packageRoot = fileURLToPath(new URL("../../../../", import.meta.url))
const repoRoot = path.resolve(packageRoot, "../..")
const buildScript = path.resolve(packageRoot, "scripts/build-front-css.mjs")
const output = path.resolve(packageRoot, "dist/front/styles.css")

function buildFrom(cwd: string) {
  execFileSync(process.execPath, [buildScript], { cwd })
  return readFileSync(output)
}

describe("build-front-css", () => {
  it("produces the same complete stylesheet from the repo root and package directory", () => {
    const fromRepoRoot = buildFrom(repoRoot)
    const fromPackageRoot = buildFrom(packageRoot)

    expect(fromRepoRoot.byteLength).toBeGreaterThanOrEqual(100_000)
    expect(fromPackageRoot).toEqual(fromRepoRoot)
  })
})

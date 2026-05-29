import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const playgroundDir = resolve(here, "../..")
const repoRoot = resolve(playgroundDir, "../..")

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
}

/** Map of every workspace package name -> its dependency names. */
function buildWorkspacePackageMap(): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const group of ["packages", "plugins"]) {
    const groupDir = join(repoRoot, group)
    let entries: string[]
    try {
      entries = readdirSync(groupDir)
    } catch {
      continue
    }
    for (const entry of entries) {
      const pkgPath = join(groupDir, entry, "package.json")
      let pkg: Record<string, unknown>
      try {
        pkg = readJson(pkgPath)
      } catch {
        continue
      }
      const name = pkg.name
      if (typeof name !== "string") continue
      const deps = { ...(pkg.dependencies as object), ...(pkg.peerDependencies as object) }
      map.set(name, Object.keys(deps))
    }
  }
  return map
}

/** Ordered list of @hachej/* packages a build script compiles, via `--filter X build`. */
function extractBuildChain(script: string): string[] {
  const chain: string[] = []
  const re = /--filter\s+(@hachej\/[\w-]+)\s+build/g
  let m: RegExpExecArray | null
  while ((m = re.exec(script)) !== null) chain.push(m[1])
  return chain
}

describe("workspace-playground build chain", () => {
  const pkg = readJson(join(playgroundDir, "package.json"))
  const scripts = pkg.scripts as Record<string, string>
  const workspacePackages = buildWorkspacePackageMap()
  // Only workspace packages can satisfy a `build` step; @hachej deps that are
  // NOT workspace packages (none today) would be external and irrelevant here.
  const buildScripts = ["dev", "build", "test:e2e"].filter((name) => scripts[name]?.includes("--filter"))

  it("has build scripts to validate", () => {
    expect(buildScripts.length).toBeGreaterThan(0)
  })

  for (const scriptName of buildScripts) {
    describe(`${scriptName} script`, () => {
      const chain = extractBuildChain(scripts[scriptName])
      const built = new Set(chain)

      // Build order among @hachej packages is irrelevant: tsup externalizes
      // workspace deps, so their imports only resolve at vite serve-time, after
      // every `&&`-chained build has completed. The invariant that actually
      // prevents the regression (a plugin's dist importing a dep whose dist was
      // never produced) is PRESENCE — every workspace dependency of every built
      // package must itself be built somewhere in the chain before vite runs.
      it("builds every workspace dependency of each built package", () => {
        const missing: string[] = []
        for (const builtPkg of chain) {
          const deps = workspacePackages.get(builtPkg)
          if (!deps) continue // not a workspace package we can introspect
          for (const dep of deps) {
            if (!workspacePackages.has(dep)) continue // external dep, not built here
            if (!built.has(dep)) {
              missing.push(`"${builtPkg}" depends on "${dep}", which is never built in the ${scriptName} chain`)
            }
          }
        }
        expect(missing, missing.join("\n")).toEqual([])
      })
    })
  }
})

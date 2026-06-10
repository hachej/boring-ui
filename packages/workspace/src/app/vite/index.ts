import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"

/**
 * Vite plugin that generates the `virtual:boring-front-plugins` module from
 * `boring.defaultPlugins` in the app's package.json.
 *
 * Each listed npm package is checked for a `boring.front` field; if present,
 * its `/front` subpath export is imported and included in the default export
 * array. Packages without a front entry are silently skipped.
 *
 * Zero-config plugins are wired this way. Plugins that need custom config
 * (e.g. deck) should be composed inline and spread alongside the array.
 */
export function boringDefaultFrontPlugins(opts: { appRoot: string }) {
  const virtualId = "virtual:boring-front-plugins"
  const resolvedId = "\0" + virtualId
  return {
    name: "boring-default-front-plugins",
    resolveId(id: string) {
      return id === virtualId ? resolvedId : undefined
    },
    load(id: string) {
      if (id !== resolvedId) return undefined
      let entries: string[]
      try {
        const manifest = JSON.parse(readFileSync(join(opts.appRoot, "package.json"), "utf-8")) as {
          boring?: { defaultPlugins?: unknown[] }
        }
        entries = (manifest.boring?.defaultPlugins ?? []).filter((e): e is string => typeof e === "string")
      } catch {
        return "export default []"
      }
      const req = createRequire(join(opts.appRoot, "package.json"))
      const imports: string[] = []
      const vars: string[] = []
      let i = 0
      for (const pkg of entries) {
        if (pkg.startsWith(".") || pkg.startsWith("/")) continue
        try {
          const pkgJson = JSON.parse(readFileSync(req.resolve(`${pkg}/package.json`), "utf-8")) as {
            boring?: { front?: string }
          }
          if (pkgJson.boring?.front) {
            imports.push(`import _p${i} from ${JSON.stringify(`${pkg}/front`)}`)
            vars.push(`_p${i}`)
            i++
          }
        } catch {
          // package has no /front subpath or no boring.front field — skip
        }
      }
      return [...imports, `export default [${vars.join(", ")}]`].join("\n")
    },
  }
}

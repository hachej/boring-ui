import { describe, expect, test } from "vitest"
import { collectStaticImportFiles, staticManifestImportKeys } from "./front-bundle-graph.mjs"

describe("CLI front bundle graph", () => {
  test("preserves genuine eager edges and their static closure", () => {
    const manifest = {
      entry: { file: "entry.js", imports: ["eager"] },
      eager: { file: "eager.js", imports: ["eager-child"] },
      "eager-child": { file: "eager-child.js" },
    }

    expect([...collectStaticImportFiles(manifest, ["entry"])]).toEqual([
      "entry.js",
      "eager.js",
      "eager-child.js",
    ])
  })

  test("keeps a Vite preload-only overlap behind its dynamic boundary", () => {
    const manifest = {
      descriptor: {
        file: "descriptor.js",
        imports: ["shared", "lazy-panel"],
        dynamicImports: ["lazy-panel"],
      },
      shared: { file: "shared.js" },
      "lazy-panel": { file: "lazy-panel.js", imports: ["lazy-panel-child"] },
      "lazy-panel-child": { file: "lazy-panel-child.js" },
    }

    expect(staticManifestImportKeys(manifest.descriptor)).toEqual(["shared"])
    expect([...collectStaticImportFiles(manifest, ["descriptor"])]).toEqual([
      "descriptor.js",
      "shared.js",
    ])
  })

  test("fails visibly when a static manifest edge drifts out of the graph", () => {
    expect(() => collectStaticImportFiles({ entry: { file: "entry.js", imports: ["missing"] } }, ["entry"]))
      .toThrow("manifest import missing is missing")
  })
})

import { describe, expect, test } from "vitest"
import { collectStaticImportFiles, collectStaticImportResources, staticManifestImportKeys } from "./front-bundle-graph.mjs"

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

  test("counts imports that also appear in dynamicImports as mandatory", () => {
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

    expect(staticManifestImportKeys(manifest.descriptor)).toEqual(["shared", "lazy-panel"])
    expect([...collectStaticImportFiles(manifest, ["descriptor"])]).toEqual([
      "descriptor.js",
      "shared.js",
      "lazy-panel.js",
      "lazy-panel-child.js",
    ])
  })

  test("collects and deduplicates CSS across the complete static closure", () => {
    const manifest = {
      entry: {
        file: "entry.js",
        css: ["entry.css", "shared.css"],
        imports: ["shared"],
      },
      shared: {
        file: "shared.js",
        css: ["shared.css", "shared-chunk.css"],
      },
    }

    const resources = collectStaticImportResources(manifest, ["entry"])
    expect([...resources.jsFiles]).toEqual(["entry.js", "shared.js"])
    expect([...resources.cssFiles]).toEqual(["entry.css", "shared.css", "shared-chunk.css"])
  })

  test("fails visibly when a static manifest edge drifts out of the resource graph", () => {
    expect(() => collectStaticImportResources({ entry: { file: "entry.js", imports: ["missing"] } }, ["entry"]))
      .toThrow("manifest import missing is missing")
  })
})

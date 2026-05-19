import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { scaffoldPlugin } from "../server/scaffoldPlugin"

describe("scaffoldPlugin", () => {
  let workspaceRoot: string

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), "scaffold-plugin-"))
  })

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true })
  })

  test("creates .pi/extensions/<name>/{package.json,front/index.tsx}", () => {
    const result = scaffoldPlugin({ name: "my-plugin", workspaceRoot })
    expect(result.pluginDir).toBe(join(workspaceRoot, ".pi", "extensions", "my-plugin"))
    expect(result.filesCreated).toHaveLength(2)

    const pkg = JSON.parse(readFileSync(join(result.pluginDir, "package.json"), "utf8"))
    expect(pkg).toMatchObject({
      name: "my-plugin",
      version: "0.1.0",
      boring: { label: "My Plugin", front: "front/index.tsx", server: false },
      pi: { systemPrompt: expect.stringContaining("My Plugin") },
    })

    const front = readFileSync(join(result.pluginDir, "front", "index.tsx"), "utf8")
    expect(front).toContain('import { definePlugin } from "@hachej/boring-workspace/plugin"')
    expect(front).toContain('"my-plugin"')
    expect(front).toContain('"my-plugin.panel"')
    expect(front).toContain('"my-plugin.open"')
    expect(front).toContain('"my-plugin.tab"')
    expect(front).toContain("MyPluginPane")
  })

  test("rejects non-kebab-case names", () => {
    for (const bad of ["My-Plugin", "my_plugin", "MyPlugin", "1plugin", "", "my plugin", "my--plugin"]) {
      expect(() => scaffoldPlugin({ name: bad, workspaceRoot })).toThrow(/kebab-case/)
    }
  })

  test("refuses to overwrite an existing plugin", () => {
    scaffoldPlugin({ name: "dup", workspaceRoot })
    expect(() => scaffoldPlugin({ name: "dup", workspaceRoot })).toThrow(/already exists/)
  })

  test("derives a multi-word PascalCase pane component name", () => {
    const result = scaffoldPlugin({ name: "csv-viz", workspaceRoot })
    const front = readFileSync(join(result.pluginDir, "front", "index.tsx"), "utf8")
    expect(front).toContain("CsvVizPane")
    expect(front).toContain('label: "Csv Viz"')
  })
})

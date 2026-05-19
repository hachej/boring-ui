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

  test("creates .pi/extensions/<name>/{package.json,front/index.tsx,server/index.ts,.gitignore}", () => {
    const result = scaffoldPlugin({ name: "my-plugin", workspaceRoot })
    expect(result.pluginDir).toBe(join(workspaceRoot, ".pi", "extensions", "my-plugin"))
    expect(result.filesCreated).toHaveLength(4)
    const gitignore = readFileSync(join(result.pluginDir, ".gitignore"), "utf8")
    expect(gitignore).toContain(".boring-signature.json")

    const pkg = JSON.parse(readFileSync(join(result.pluginDir, "package.json"), "utf8"))
    expect(pkg).toMatchObject({
      name: "my-plugin",
      version: "0.1.0",
      boring: {
        label: "My Plugin",
        front: "front/index.tsx",
        // Always include the server stub — front-only plugins delete it
        // (the CLI's "Next steps" output explains how).
        server: "server/index.ts",
      },
      pi: { systemPrompt: expect.stringContaining("My Plugin") },
    })

    const front = readFileSync(join(result.pluginDir, "front", "index.tsx"), "utf8")
    expect(front).toContain('import { definePlugin } from "@hachej/boring-workspace/plugin"')
    expect(front).toContain('"my-plugin"')
    expect(front).toContain('"my-plugin.panel"')
    expect(front).toContain('"my-plugin.open"')
    expect(front).toContain('"my-plugin.tab"')
    expect(front).toContain("MyPluginPane")
    // The scaffold reads from the canonical template files (not inline
    // strings), so placeholder leakage like "<kebab-name>" indicates the
    // substitution missed something.
    expect(front).not.toContain("<kebab-name>")
    expect(front).not.toContain("<Label>")
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

  test("reads from canonical template files (single source of truth)", () => {
    // Sanity: scaffold output should match what the system prompt points
    // at — the templates in packages/pi/references/workspace/templates/.
    const result = scaffoldPlugin({ name: "share-source", workspaceRoot })
    const pkg = JSON.parse(readFileSync(join(result.pluginDir, "package.json"), "utf8"))
    // The _doc_ key from the template must be stripped before writing
    // (it's a comment for human readers of the template).
    expect(pkg._doc_).toBeUndefined()
    expect(pkg.boring.server).toBe("server/index.ts")
  })

  test("server stub is shape-correct and uses the plugin id", () => {
    const result = scaffoldPlugin({ name: "tool-plugin", workspaceRoot })
    const serverPath = join(result.pluginDir, "server", "index.ts")
    const serverSource = readFileSync(serverPath, "utf8")
    expect(serverSource).toContain('import { defineServerPlugin')
    expect(serverSource).toContain('"@hachej/boring-workspace/server"')
    expect(serverSource).toContain('"tool-plugin"')
    // Sanity that we didn't leak template placeholders.
    expect(serverSource).not.toContain("<kebab-name>")
  })
})

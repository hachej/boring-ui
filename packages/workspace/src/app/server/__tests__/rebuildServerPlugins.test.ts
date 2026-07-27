import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"
import { rebuildServerPlugins } from "../rebuildServerPlugins"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

describe("rebuildServerPlugins", () => {
  test("re-resolves dir entries", async () => {
    const dir = await makeTempDir("rebuild-dir-")
    await mkdir(join(dir, "src", "server"), { recursive: true })
    await writeFile(
      join(dir, "src", "server", "index.ts"),
      "export default { id: 'rebuilt', systemPrompt: 'REBUILT_PROMPT' }",
      "utf8",
    )
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "p", boring: { id: "rebuilt", server: "src/server/index.ts" } }), "utf8")

    const result = await rebuildServerPlugins({
      entries: [{ dir, hotReload: true }],
      ctx: { workspaceRoot: "/tmp/host", bridge: {} as never },
    })

    expect(result.ok).toBe(true)
    expect(result.diagnostics).toEqual([])
  })

  test("failed dir entry surfaces a diagnostic and other entries keep going", async () => {
    const goodDir = await makeTempDir("rebuild-good-")
    await mkdir(join(goodDir, "src", "server"), { recursive: true })
    await writeFile(
      join(goodDir, "src", "server", "index.ts"),
      "export default { id: 'good', systemPrompt: 'OK' }",
      "utf8",
    )
    await writeFile(join(goodDir, "package.json"), JSON.stringify({ name: "p", boring: { id: "good", server: "src/server/index.ts" } }), "utf8")

    const result = await rebuildServerPlugins({
      entries: [
        { dir: "/nonexistent", hotReload: true },
        { dir: goodDir, hotReload: true },
      ],
      ctx: { workspaceRoot: "/tmp/host", bridge: {} as never },
    })

    expect(result.ok).toBe(false)
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0].source).toBe("directory (/nonexistent)")
  })

  test("rejects unsafe explicit boring.server paths before import", async () => {
    const dir = await makeTempDir("rebuild-unsafe-explicit-")
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "p", boring: { server: "../outside.js" } }),
      "utf8",
    )

    const result = await rebuildServerPlugins({
      entries: [{ dir, hotReload: true }],
      ctx: { workspaceRoot: "/tmp/host", bridge: {} as never },
    })

    expect(result.ok).toBe(false)
    expect(result.diagnostics[0]?.message).toContain("boring.server")
    expect(result.diagnostics[0]?.message).toContain("safe relative path")
  })

  test("rejects explicit server entry symlink escapes before import", async () => {
    const dir = await makeTempDir("rebuild-explicit-symlink-")
    const outside = await makeTempDir("rebuild-explicit-outside-")
    await mkdir(join(dir, "src"), { recursive: true })
    await mkdir(join(outside, "server"), { recursive: true })
    await writeFile(join(outside, "server", "index.ts"), "export default { id: 'escape' }", "utf8")
    await symlink(join(outside, "server"), join(dir, "src", "server"), "dir")
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "p", boring: { server: "src/server/index.ts" } }), "utf8")

    const result = await rebuildServerPlugins({
      entries: [{ dir, hotReload: true }],
      ctx: { workspaceRoot: "/tmp/host", bridge: {} as never },
    })

    expect(result.ok).toBe(false)
    expect(result.diagnostics[0]?.message).toContain("boring.server: resolved path escapes plugin root")
  })

  test("pre-built objects are accepted without diagnostics", async () => {
    const result = await rebuildServerPlugins({
      entries: [{ id: "obj", systemPrompt: "O" }],
      ctx: { workspaceRoot: "/tmp/host", bridge: {} as never },
    })

    expect(result).toEqual({ ok: true, diagnostics: [] })
  })
})

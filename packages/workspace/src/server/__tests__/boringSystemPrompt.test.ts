import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { buildBoringSystemPrompt } from "../boringSystemPrompt"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

describe("buildBoringSystemPrompt", () => {
  test("points plugin authors at workspace-installed package docs", async () => {
    const workspaceRoot = await makeTempDir("boring-system-prompt-")
    const prompt = buildBoringSystemPrompt({ workspaceRoot })

    expect(prompt).toContain(join(workspaceRoot, "node_modules", "@hachej", "boring-workspace", "dist", "docs", "plugins.md"))
    expect(prompt).toContain(join(workspaceRoot, "node_modules", "@hachej", "boring-workspace", "dist", "docs", "panels.md"))
    expect(prompt).toContain("boring-plugin-authoring")
  })

  test("stays lean — points at the skill, not the full docs inline", () => {
    const prompt = buildBoringSystemPrompt()

    expect(prompt).toContain("Fallback reference docs location")
    expect(prompt).toContain("boring-plugin-authoring")
    expect(prompt).not.toContain("## Universal plugin layout")
    // The prompt should be a thin pointer, not a duplicate of the skill.
    expect(prompt.length).toBeLessThan(1200)
  })
})

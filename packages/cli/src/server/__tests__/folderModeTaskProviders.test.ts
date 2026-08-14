import { execFile } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { afterEach, describe, expect, test } from "vitest"
import { detectFolderModeTaskProviders } from "../folderModeTaskProviders.js"

const execFileAsync = promisify(execFile)
const roots: string[] = []

async function workspaceFixture(options: { beads: boolean; github: boolean }): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "boring-folder-task-providers-"))
  roots.push(root)
  if (options.beads) {
    await mkdir(join(root, ".beads"), { recursive: true })
    await writeFile(join(root, ".beads", "beads.db"), "fixture", "utf8")
  }
  if (options.github) {
    await execFileAsync("git", ["init", "--quiet", root])
    await execFileAsync("git", ["-C", root, "remote", "add", "origin", "git@github.com:hachej/boring-ui.git"])
  }
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("folder-mode task provider detection", () => {
  test.each([
    { beads: false, github: false, expected: [] },
    { beads: true, github: false, expected: [{ provider: "beads" }] },
    { beads: false, github: true, expected: [{ provider: "github", repo: "auto" }] },
    {
      beads: true,
      github: true,
      expected: [{ provider: "github", repo: "auto" }, { provider: "beads" }],
    },
  ])("detects beads=$beads github=$github", async ({ beads, github, expected }) => {
    const workspaceRoot = await workspaceFixture({ beads, github })
    await expect(detectFolderModeTaskProviders(workspaceRoot)).resolves.toEqual(expected)
  })
})

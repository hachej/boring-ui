// @vitest-environment node

import { mkdtemp, mkdir, realpath, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"
import { commitPublishedFolder } from "../commitPublishedFolder"

const execFileAsync = promisify(execFile)

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "app-runner-git-"))
  await mkdir(join(root, "apps", "demo"), { recursive: true })
  await writeFile(join(root, "apps", "demo", "index.js"), "export default {}")
  return root
}

async function git(cwd: string, args: string[]) {
  return execFileAsync("git", args, { cwd })
}

describe("commitPublishedFolder", () => {
  it("creates an app-owned repository and commits its contents", async () => {
    const root = await workspace()
    const sha = await commitPublishedFolder(root, "apps/demo", "publish")
    expect(sha).toMatch(/^[0-9a-f]{40}$/)
    expect((await git(join(root, "apps", "demo"), ["rev-parse", "--show-toplevel"])).stdout.trim()).toBe(await realpath(join(root, "apps", "demo")))
  })

  it.each(["/tmp", "../outside", "apps/../../outside"])("rejects unconfined directory %s", async (dir) => {
    const root = await workspace()
    await expect(commitPublishedFolder(root, dir, "publish")).rejects.toThrow(/workspace-relative|inside the workspace/)
  })

  it("rejects a symlink that escapes the workspace", async () => {
    const root = await workspace()
    const outside = await mkdtemp(join(tmpdir(), "app-runner-outside-"))
    await symlink(outside, join(root, "apps", "escape"))
    await expect(commitPublishedFolder(root, "apps/escape", "publish")).rejects.toThrow(/inside the workspace/)
  })

  it("refuses unsafe local config before Git can execute it", async () => {
    const root = await workspace()
    const app = join(root, "apps", "demo")
    await git(app, ["init"])
    await git(app, ["config", "filter.evil.clean", "sh -c 'touch ../executed; cat'"])
    await writeFile(join(app, ".gitattributes"), "index.js filter=evil\n")
    await expect(commitPublishedFolder(root, "apps/demo", "publish")).rejects.toThrow(/unsafe Git configuration/)
    await expect(realpath(join(root, "apps", "executed"))).rejects.toThrow()
  })

  it("refuses nested repositories", async () => {
    const root = await workspace()
    const nested = join(root, "apps", "demo", "nested")
    await mkdir(nested)
    await git(nested, ["init"])
    await expect(commitPublishedFolder(root, "apps/demo", "publish")).rejects.toThrow(/nested Git repository/)
  })
})

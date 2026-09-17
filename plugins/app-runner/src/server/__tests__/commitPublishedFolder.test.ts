// @vitest-environment node

import { mkdtemp, mkdir, realpath, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"
import { commitPublishedFolder, resolvePublishGitContext } from "../commitPublishedFolder"

const execFileAsync = promisify(execFile)

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "app-runner-git-"))
  await mkdir(join(root, "apps", "demo"), { recursive: true })
  await writeFile(join(root, "apps", "demo", "index.js"), "export default {}")
  return root
}

describe("commitPublishedFolder", () => {
  it("commits through host-owned metadata outside the workspace", async () => {
    const root = await workspace()
    const sha = await commitPublishedFolder(root, "apps/demo", "publish")
    const context = await resolvePublishGitContext(root, "apps/demo")

    expect(sha).toMatch(/^[0-9a-f]{40}$/)
    expect(context.cwd.startsWith(await realpath(root))).toBe(false)
    expect(context.gitDir.startsWith(await realpath(root))).toBe(false)
    expect((await execFileAsync("git", [`--git-dir=${context.gitDir}`, "rev-parse", "HEAD"], { cwd: context.cwd })).stdout.trim()).toBe(sha)
  })

  it.each(["/tmp", "../outside", "apps/../../outside"])('rejects unconfined directory %s', async (dir) => {
    const root = await workspace()
    await expect(commitPublishedFolder(root, dir, "publish")).rejects.toThrow(/workspace-relative|inside the workspace/)
  })

  it("rejects a symlink that escapes the workspace", async () => {
    const root = await workspace()
    const outside = await mkdtemp(join(tmpdir(), "app-runner-outside-"))
    await symlink(outside, join(root, "apps", "escape"))
    await expect(commitPublishedFolder(root, "apps/escape", "publish")).rejects.toThrow(/inside the workspace/)
  })

  it("refuses app-controlled Git metadata without executing its hooks or filters", async () => {
    const root = await workspace()
    const app = join(root, "apps", "demo")
    await execFileAsync("git", ["init"], { cwd: app })
    await execFileAsync("git", ["config", "filter.evil.clean", "sh -c 'touch ../executed; cat'"], { cwd: app })
    await writeFile(join(app, ".gitattributes"), "index.js filter=evil\n")

    await expect(commitPublishedFolder(root, "apps/demo", "publish")).rejects.toThrow(/app-controlled Git metadata/)
    await expect(realpath(join(root, "apps", "executed"))).rejects.toThrow()
  })

  it("refuses nested repositories", async () => {
    const root = await workspace()
    const nested = join(root, "apps", "demo", "nested")
    await mkdir(nested)
    await mkdir(join(nested, ".git"))
    await expect(commitPublishedFolder(root, "apps/demo", "publish")).rejects.toThrow(/nested Git repository/)
  })

  it("refuses a metadata root within the workspace", async () => {
    const root = await workspace()
    await expect(resolvePublishGitContext(root, "apps/demo", join(root, ".boring", "git"))).rejects.toThrow(/outside/)
  })
})

// @vitest-environment node

import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { APP_RUNNER_MAX_FILE_BYTES } from "../../shared/constants"
import { commitPublishedFolder } from "../commitPublishedFolder"
import { AppRunnerLimitError, collectAppFiles } from "../collectAppFiles"

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "app-runner-collect-"))
  const app = join(root, "apps", "demo")
  await mkdir(join(app, "nested"), { recursive: true })
  await writeFile(join(app, "index.js"), "export const value = 'committed'\n")
  await writeFile(join(app, ".env.local"), "SECRET=do-not-publish\n")
  await writeFile(join(app, "nested", ".private"), "hidden\n")
  await writeFile(join(app, ".gitignore"), "ignored.txt\n")
  await writeFile(join(app, "ignored.txt"), "ignored secret\n")
  return { root, app }
}

describe("collectAppFiles", () => {
  it("reads the reported commit and excludes dotfiles and gitignored files", async () => {
    const { root, app } = await fixture()
    const sha = await commitPublishedFolder(root, "apps/demo", "publish")
    await writeFile(join(app, "index.js"), "export const value = 'unpublished'\n")

    const result = await collectAppFiles(root, "apps/demo", sha)

    expect(result.files).toEqual({ "app/index.js": "export const value = 'committed'\n" })
    expect(JSON.stringify(result.files)).not.toContain("do-not-publish")
    expect(JSON.stringify(result.files)).not.toContain("ignored secret")
  })

  it("enforces the per-file limit before any hub request", async () => {
    const { root, app } = await fixture()
    await writeFile(join(app, "large.txt"), "x".repeat(APP_RUNNER_MAX_FILE_BYTES + 1))
    const sha = await commitPublishedFolder(root, "apps/demo", "oversized")

    await expect(collectAppFiles(root, "apps/demo", sha)).rejects.toMatchObject({ code: "FILE_TOO_LARGE" } satisfies Partial<AppRunnerLimitError>)
  })
})

import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdtemp, readdir, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { afterEach, describe, expect, it } from "vitest"
import {
  UI_REVIEW_TEMP_PREFIX,
  assertRemovableUiReviewTempRoot,
  assertWithinUiReviewTempRoot,
  cleanupUiReviewTempRoot,
  createUiReviewTempDir,
  uiReviewTempRoot,
} from "../core/tempRoot"

const toolRoot = resolve(import.meta.dirname, "../..")

afterEach(async () => { await cleanupUiReviewTempRoot() })

describe("ui review run-scoped temp root", () => {
  it("places every temp directory under one run root and removes it on cleanup", async () => {
    const root = await uiReviewTempRoot()
    const first = await createUiReviewTempDir("alpha.")
    const second = await createUiReviewTempDir("beta.")
    expect(root.startsWith(join(resolve(tmpdir()), UI_REVIEW_TEMP_PREFIX))).toBe(true)
    expect(dirname(first)).toBe(root)
    expect(dirname(second)).toBe(root)
    expect(await uiReviewTempRoot()).toBe(root)

    expect(await cleanupUiReviewTempRoot()).toBe(root)
    expect(existsSync(root)).toBe(false)
    expect(existsSync(first)).toBe(false)
  })

  it("is idempotent so finally, exit and signal handlers can all call it", async () => {
    const root = await uiReviewTempRoot()
    expect(await cleanupUiReviewTempRoot()).toBe(root)
    expect(await cleanupUiReviewTempRoot()).toBeUndefined()
    expect(await cleanupUiReviewTempRoot()).toBeUndefined()
  })

  it("never follows a symlink out of the run root", async () => {
    const outside = await mkdtemp(join(tmpdir(), "ui-review-symlink-target."))
    try {
      const keepMe = join(outside, "keep.txt")
      await writeFile(keepMe, "survivor", "utf8")
      const root = await uiReviewTempRoot()
      await symlink(outside, join(root, "escape"), "dir")

      await cleanupUiReviewTempRoot()
      expect(existsSync(root)).toBe(false)
      expect(existsSync(keepMe)).toBe(true)
      expect(await readdir(outside)).toEqual(["keep.txt"])
    } finally {
      const { rm } = await import("node:fs/promises")
      await rm(outside, { recursive: true, force: true })
    }
  })

  it("refuses to remove anything outside the run root", () => {
    expect(() => assertRemovableUiReviewTempRoot(tmpdir())).toThrow("UI_REVIEW_TEMP_ROOT_OUTSIDE_TMPDIR")
    expect(() => assertRemovableUiReviewTempRoot("/home/someone/work")).toThrow("UI_REVIEW_TEMP_ROOT_OUTSIDE_TMPDIR")
    expect(() => assertRemovableUiReviewTempRoot(join(tmpdir(), "someone-elses-dir"))).toThrow("UI_REVIEW_TEMP_ROOT_UNOWNED")
    expect(assertRemovableUiReviewTempRoot(join(tmpdir(), `${UI_REVIEW_TEMP_PREFIX}abc`))).toBe(join(resolve(tmpdir()), `${UI_REVIEW_TEMP_PREFIX}abc`))

    const root = join(tmpdir(), `${UI_REVIEW_TEMP_PREFIX}xyz`)
    expect(() => assertWithinUiReviewTempRoot(root, root)).toThrow("UI_REVIEW_TEMP_OUTSIDE_ROOT")
    expect(() => assertWithinUiReviewTempRoot(root, join(root, "..", "elsewhere"))).toThrow("UI_REVIEW_TEMP_OUTSIDE_ROOT")
    expect(assertWithinUiReviewTempRoot(root, join(root, "child"))).toBe(join(root, "child"))
  })

  it("removes the run root when the process is terminated by SIGTERM", async () => {
    const child = spawn("node_modules/.bin/tsx", ["src/__tests__/temp-root-child.ts"], { cwd: toolRoot, stdio: ["ignore", "pipe", "inherit"] })
    try {
      const root = await new Promise<string>((resolveRoot, reject) => {
        let stdout = ""
        child.stdout.setEncoding("utf8")
        child.stdout.on("data", (chunk: string) => {
          stdout += chunk
          const match = /UI_REVIEW_TEMP_ROOT:(.+)/.exec(stdout)
          if (match) resolveRoot(match[1]!.trim())
        })
        child.on("error", reject)
        child.on("exit", (code) => reject(new Error(`child exited early: ${code}`)))
      })
      expect(existsSync(root)).toBe(true)
      expect((await readdir(root)).length).toBe(1)

      const exitCode = await new Promise<number | null>((resolveExit) => {
        child.once("exit", (code) => resolveExit(code))
        child.kill("SIGTERM")
      })
      expect(exitCode).toBe(143)
      await sleep(50)
      expect(existsSync(root)).toBe(false)
    } finally {
      if (child.exitCode === null) child.kill("SIGKILL")
    }
  }, 60_000)
})

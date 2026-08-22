import { spawn, type ChildProcessByStdio } from "node:child_process"
import { existsSync, rmSync } from "node:fs"
import { mkdtemp, readdir, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import type { Readable } from "node:stream"
import { afterEach, describe, expect, it } from "vitest"
import {
  UI_REVIEW_TEMP_PREFIX,
  assertRemovableUiReviewTempRoot,
  assertWithinUiReviewTempRoot,
  cleanupUiReviewTempRootSync,
  createUiReviewTempDir,
  uiReviewTempRoot,
} from "../core/tempRoot"

const toolRoot = resolve(import.meta.dirname, "../..")

type TempRootChild = ChildProcessByStdio<null, Readable, null>

afterEach(() => { cleanupUiReviewTempRootSync() })

describe("ui review run-scoped temp root", () => {
  it("places every temp directory under one run root and removes it on cleanup", async () => {
    const root = await uiReviewTempRoot()
    const first = await createUiReviewTempDir("alpha.")
    const second = await createUiReviewTempDir("beta.")
    expect(root.startsWith(join(resolve(tmpdir()), UI_REVIEW_TEMP_PREFIX))).toBe(true)
    expect(dirname(first)).toBe(root)
    expect(dirname(second)).toBe(root)
    expect(await uiReviewTempRoot()).toBe(root)

    expect(cleanupUiReviewTempRootSync()).toBe(root)
    expect(existsSync(root)).toBe(false)
    expect(existsSync(first)).toBe(false)
  })

  it("is idempotent so finally, exit and signal handlers can all call it", async () => {
    const root = await uiReviewTempRoot()
    expect(cleanupUiReviewTempRootSync()).toBe(root)
    expect(cleanupUiReviewTempRootSync()).toBeUndefined()
    expect(cleanupUiReviewTempRootSync()).toBeUndefined()
  })

  it("never follows a symlink out of the run root", async () => {
    const outside = await mkdtemp(join(tmpdir(), "ui-review-symlink-target."))
    try {
      const keepMe = join(outside, "keep.txt")
      await writeFile(keepMe, "survivor", "utf8")
      const root = await uiReviewTempRoot()
      await symlink(outside, join(root, "escape"), "dir")

      cleanupUiReviewTempRootSync()
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

  it("removes the run root when a CLI entrypoint that armed the signal handlers is terminated by SIGTERM", async () => {
    const child = spawnTempRootChild("armed")
    try {
      const { root, listeners } = await readChildHandshake(child)
      expect(listeners).toEqual({ SIGINT: 1, SIGTERM: 1, SIGHUP: 1 })
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

  it("arms no signal handler on its own, so a worker that merely imports it keeps its own shutdown", async () => {
    const child = spawnTempRootChild("bare")
    let leaked: string | undefined
    try {
      const { root, listeners } = await readChildHandshake(child)
      leaked = root
      // Creating the run root must never install a `process.exit()`-ing signal handler.
      expect(listeners).toEqual({ SIGINT: 0, SIGTERM: 0, SIGHUP: 0 })
      expect(existsSync(root)).toBe(true)

      await new Promise<void>((resolveExit) => {
        child.once("exit", () => resolveExit())
        child.kill("SIGTERM")
      })
      await sleep(50)
      // Cleanup still happens — it just rides the `exit` listener rather than a signal handler.
      expect(existsSync(root)).toBe(false)
    } finally {
      if (child.exitCode === null) child.kill("SIGKILL")
      if (leaked && existsSync(leaked)) rmSync(assertRemovableUiReviewTempRoot(leaked), { recursive: true, force: true })
    }
  }, 60_000)

  it("adds no signal listeners when a temp directory is created in-process", async () => {
    const before = countTempRootSignalListeners()
    await createUiReviewTempDir("no-handlers.")
    expect(countTempRootSignalListeners()).toEqual(before)
  })
})

function spawnTempRootChild(mode: "armed" | "bare"): TempRootChild {
  return spawn("node_modules/.bin/tsx", ["src/__tests__/temp-root-child.ts", mode], { cwd: toolRoot, stdio: ["ignore", "pipe", "inherit"] })
}

/** Resolve once the child has reported both its listener counts and its run root. */
function readChildHandshake(child: TempRootChild): Promise<{ root: string; listeners: Record<string, number> }> {
  return new Promise((resolveHandshake, reject) => {
    let stdout = ""
    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk
      const listeners = /UI_REVIEW_TEMP_LISTENERS:(.+)/.exec(stdout)
      const root = /UI_REVIEW_TEMP_ROOT:(.+)/.exec(stdout)
      if (listeners && root) resolveHandshake({ root: root[1]!.trim(), listeners: JSON.parse(listeners[1]!.trim()) as Record<string, number> })
    })
    child.on("error", reject)
    child.on("exit", (code) => reject(new Error(`child exited early: ${code}`)))
  })
}

function countTempRootSignalListeners(): Record<string, number> {
  return { SIGINT: process.listenerCount("SIGINT"), SIGTERM: process.listenerCount("SIGTERM"), SIGHUP: process.listenerCount("SIGHUP") }
}

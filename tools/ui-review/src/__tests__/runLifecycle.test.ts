import { spawn, type ChildProcess } from "node:child_process"
import { access, mkdir, readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { describe, expect, test } from "vitest"
import {
  UI_REVIEW_RUN_ROOT_PREFIX,
  createUiReviewRunLifecycle,
  deleteOwnedUiReviewRunRoot,
} from "../../scripts/ui-review-run-lifecycle.mjs"

const FIXTURE = resolve(import.meta.dirname, "fixtures/run-lifecycle-child.mjs")

describe.sequential("owned UI review run lifecycle", () => {
  test("removes the run root after normal exit", async () => {
    const area = await createUiReviewRunLifecycle()
    try {
      const temporaryDirectory = await area.allocateDirectory("tmp")
      const run = spawnFixture("normal", { TMPDIR: temporaryDirectory })
      const ready = await run.ready
      expect(await run.closed).toMatchObject({ code: 0, signal: null })
      await expect(access(ready.root)).rejects.toMatchObject({ code: "ENOENT" })
      expect(await countRunRoots(temporaryDirectory)).toBe(0)
    } finally {
      await area.cleanup()
    }
  })

  test("removes the run root after a thrown error", async () => {
    const area = await createUiReviewRunLifecycle()
    try {
      const temporaryDirectory = await area.allocateDirectory("tmp")
      const run = spawnFixture("throw", { TMPDIR: temporaryDirectory })
      const ready = await run.ready
      expect(await run.closed).toMatchObject({ code: 1, signal: null })
      expect(run.stderr()).toContain("UI_REVIEW_FIXTURE_THROW")
      await expect(access(ready.root)).rejects.toMatchObject({ code: "ENOENT" })
      expect(await countRunRoots(temporaryDirectory)).toBe(0)
    } finally {
      await area.cleanup()
    }
  })

  for (const [signal, status] of [["SIGINT", 130], ["SIGTERM", 143]] as const) {
    test(`cleans before preserving ${signal} shell status`, async () => {
      const area = await createUiReviewRunLifecycle()
      try {
        const temporaryDirectory = await area.allocateDirectory("tmp")
        const run = spawnFixture("wait", { TMPDIR: temporaryDirectory })
        const ready = await run.ready
        run.child.kill(signal)
        expect(await run.closed).toMatchObject({ code: status, signal: null })
        await expect(access(ready.root)).rejects.toMatchObject({ code: "ENOENT" })
        expect(await countRunRoots(temporaryDirectory)).toBe(0)
      } finally {
        await area.cleanup()
      }
    })
  }

  test("bounds TERM to KILL and terminates stubborn descendants", async () => {
    const area = await createUiReviewRunLifecycle()
    try {
      const temporaryDirectory = await area.allocateDirectory("tmp")
      const pidFile = join(await area.allocateDirectory("pids"), "descendants.json")
      const run = spawnFixture("hung-child", {
        TMPDIR: temporaryDirectory,
        UI_REVIEW_PID_FILE: pidFile,
        UI_REVIEW_TEST_GRACE_MS: "100",
      })
      const ready = await run.ready
      const descendants = await waitForJson(pidFile) as { child: number; grandchild: number }
      const started = Date.now()
      run.child.kill("SIGTERM")
      expect(await run.closed).toMatchObject({ code: 143, signal: null })
      expect(Date.now() - started).toBeGreaterThanOrEqual(80)
      expect(Date.now() - started).toBeLessThan(2_000)
      await expectProcessesGone([descendants.child, descendants.grandchild])
      await expect(access(ready.root)).rejects.toMatchObject({ code: "ENOENT" })
      expect(await countRunRoots(temporaryDirectory)).toBe(0)
    } finally {
      await area.cleanup()
    }
  })

  test("creates the owned root beneath a custom TMPDIR", async () => {
    const area = await createUiReviewRunLifecycle()
    try {
      const customTmp = await area.allocateDirectory("custom-tmp")
      const run = spawnFixture("normal", { TMPDIR: customTmp })
      const ready = await run.ready
      expect(ready.root.startsWith(`${customTmp}/${UI_REVIEW_RUN_ROOT_PREFIX}`)).toBe(true)
      expect(await run.closed).toMatchObject({ code: 0, signal: null })
      expect(await countRunRoots(customTmp)).toBe(0)
    } finally {
      await area.cleanup()
    }
  })

  test("preserves a caller-owned isolation root", async () => {
    const area = await createUiReviewRunLifecycle()
    try {
      const temporaryDirectory = await area.allocateDirectory("tmp")
      const isolationRoot = await area.allocateDirectory("caller-isolation")
      const run = spawnFixture("normal", { TMPDIR: temporaryDirectory, UI_REVIEW_ISOLATION_ROOT: isolationRoot })
      await run.ready
      expect(await run.closed).toMatchObject({ code: 0, signal: null })
      expect(await readFile(join(isolationRoot, "isolation-survived.txt"), "utf8")).toBe("isolation\n")
      expect(await countRunRoots(temporaryDirectory)).toBe(0)
    } finally {
      await area.cleanup()
    }
  })

  test("preserves explicit output", async () => {
    const area = await createUiReviewRunLifecycle()
    try {
      const temporaryDirectory = await area.allocateDirectory("tmp")
      const outputRoot = await area.allocateDirectory("explicit-output")
      const run = spawnFixture("normal", { TMPDIR: temporaryDirectory, UI_REVIEW_OUTPUT_DIR: outputRoot })
      await run.ready
      expect(await run.closed).toMatchObject({ code: 0, signal: null })
      expect(await readFile(join(outputRoot, "output-survived.txt"), "utf8")).toBe("output\n")
      expect(await countRunRoots(temporaryDirectory)).toBe(0)
    } finally {
      await area.cleanup()
    }
  })

  test("preserves an explicit baseline directory", async () => {
    const area = await createUiReviewRunLifecycle()
    try {
      const temporaryDirectory = await area.allocateDirectory("tmp")
      const baselineRoot = await area.allocateDirectory("explicit-baseline")
      await writeFile(join(baselineRoot, "baseline-survived.txt"), "baseline\n", "utf8")
      const run = spawnFixture("normal", { TMPDIR: temporaryDirectory, UI_REVIEW_BASELINE_DIR: baselineRoot })
      await run.ready
      expect(await run.closed).toMatchObject({ code: 0, signal: null })
      expect(await readFile(join(baselineRoot, "baseline-survived.txt"), "utf8")).toBe("baseline\n")
      expect(await countRunRoots(temporaryDirectory)).toBe(0)
    } finally {
      await area.cleanup()
    }
  })

  test("refuses recursive deletion outside an exact marked run-root parent", async () => {
    const area = await createUiReviewRunLifecycle()
    try {
      const protectedDirectory = await area.allocateDirectory("protected")
      await expect(deleteOwnedUiReviewRunRoot(protectedDirectory, area.root)).rejects.toThrow("UI_REVIEW_RUN_ROOT_PARENT_INVALID")
      await expect(access(protectedDirectory)).resolves.toBeUndefined()
    } finally {
      await area.cleanup()
    }
  })

  test("requires the ownership marker before recursive deletion", async () => {
    const area = await createUiReviewRunLifecycle()
    try {
      const unmarkedDirectory = await area.allocateDirectory("boring-ui-review-run")
      await expect(deleteOwnedUiReviewRunRoot(unmarkedDirectory, area.root)).rejects.toThrow("UI_REVIEW_RUN_ROOT_MARKER_INVALID")
      await expect(access(unmarkedDirectory)).resolves.toBeUndefined()
    } finally {
      await area.cleanup()
    }
  })
})

function spawnFixture(mode: string, overrides: NodeJS.ProcessEnv = {}) {
  const child = spawn(process.execPath, [FIXTURE, mode], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...overrides },
  })
  let stdout = ""
  let stderr = ""
  child.stdout.setEncoding("utf8")
  child.stderr.setEncoding("utf8")
  child.stdout.on("data", (chunk: string) => { stdout += chunk })
  child.stderr.on("data", (chunk: string) => { stderr += chunk })
  const ready = waitForReady(child, () => stdout)
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveClose, reject) => {
    child.once("error", reject)
    child.once("close", (code, signal) => resolveClose({ code, signal }))
  })
  return { child, ready, closed, stderr: () => stderr }
}

async function waitForReady(child: ChildProcess, stdout: () => string) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const line = stdout().split("\n").find((entry) => entry.startsWith("UI_REVIEW_FIXTURE_READY:"))
    if (line) return JSON.parse(line.slice("UI_REVIEW_FIXTURE_READY:".length)) as { root: string; isolationRoot: string; outputRoot: string }
    if (child.exitCode !== null) throw new Error(`fixture exited before ready: ${child.exitCode}`)
    await sleep(10)
  }
  throw new Error("fixture did not become ready")
}

async function waitForJson(path: string): Promise<unknown> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    try { return JSON.parse(await readFile(path, "utf8")) }
    catch { await sleep(10) }
  }
  throw new Error(`missing JSON fixture: ${path}`)
}

async function expectProcessesGone(pids: number[]) {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    if (pids.every((pid) => !processExists(pid))) return
    await sleep(20)
  }
  expect(pids.filter(processExists), "descendant processes still alive").toEqual([])
}

function processExists(pid: number) {
  try { process.kill(pid, 0); return true }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH" }
}

async function countRunRoots(parent: string) {
  const { readdir } = await import("node:fs/promises")
  return (await readdir(parent)).filter((entry) => entry.startsWith(UI_REVIEW_RUN_ROOT_PREFIX)).length
}

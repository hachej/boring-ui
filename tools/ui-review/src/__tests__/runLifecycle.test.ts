import { spawn, type ChildProcess } from "node:child_process"
import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import { delimiter, join, resolve, sep } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { afterEach, describe, expect, test } from "vitest"
import {
  UI_REVIEW_RUN_ROOT_PREFIX,
  createUiReviewRunLifecycle,
  deleteOwnedUiReviewRunRoot,
} from "../../scripts/ui-review-run-lifecycle.mjs"

const FIXTURE = resolve(import.meta.dirname, "fixtures/run-lifecycle-child.mjs")
const TOOL_ROOT = resolve(import.meta.dirname, "../..")
const TSX_CLI = resolve(TOOL_ROOT, "node_modules/tsx/dist/cli.mjs")
const RUNNER = resolve(TOOL_ROOT, "scripts/run-ui-review.mjs")
const spawnedProcesses = new Set<ChildProcess>()
const spawnedDescendantPids = new Set<number>()
afterEach(async () => {
  await Promise.all([...spawnedDescendantPids].map(stopDescendantProcess))
  spawnedDescendantPids.clear()
  await Promise.all([...spawnedProcesses].map(stopSpawnedProcess))
  spawnedProcesses.clear()
})

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

  test("preserves shell-equivalent status for other POSIX signals", async () => {
    const area = await createUiReviewRunLifecycle()
    try {
      const status = await area.run(process.execPath, ["-e", 'process.kill(process.pid, "SIGKILL")'], { stdio: "ignore" })
      expect(status).toBe(137)
    } finally {
      await area.cleanup()
    }
  })

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
      spawnedDescendantPids.add(descendants.child)
      spawnedDescendantPids.add(descendants.grandchild)
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
      expect(ready.root.startsWith(`${customTmp}${sep}${UI_REVIEW_RUN_ROOT_PREFIX}`)).toBe(true)
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

  test("refuses recursive deletion when the expected parent is not exact", async () => {
    const area = await createUiReviewRunLifecycle()
    let nestedRun: Awaited<ReturnType<typeof createUiReviewRunLifecycle>> | undefined
    try {
      const nestedParent = await area.allocateDirectory("nested-parent")
      nestedRun = await createUiReviewRunLifecycle({ temporaryDirectory: nestedParent })
      await expect(deleteOwnedUiReviewRunRoot(nestedRun.root, area.root)).rejects.toThrow("UI_REVIEW_RUN_ROOT_PARENT_INVALID")
      await expect(access(nestedRun.root)).resolves.toBeUndefined()
    } finally {
      if (nestedRun) await nestedRun.cleanup()
      await area.cleanup()
    }
  })


  test("makes signal installation idempotent and rejects use after cleanup", async () => {
    const beforeInt = process.listenerCount("SIGINT")
    const beforeTerm = process.listenerCount("SIGTERM")
    const lifecycle = await createUiReviewRunLifecycle()
    lifecycle.installSignalHandlers()
    lifecycle.installSignalHandlers()
    expect(process.listenerCount("SIGINT")).toBe(beforeInt + 1)
    expect(process.listenerCount("SIGTERM")).toBe(beforeTerm + 1)
    lifecycle.removeSignalHandlers()
    expect(process.listenerCount("SIGINT")).toBe(beforeInt)
    expect(process.listenerCount("SIGTERM")).toBe(beforeTerm)
    await lifecycle.cleanup()
    await expect(lifecycle.allocateDirectory("late")).rejects.toThrow("UI_REVIEW_RUN_LIFECYCLE_CLOSED:closed")
    await expect(lifecycle.run(process.execPath, ["--version"])).rejects.toThrow("UI_REVIEW_RUN_LIFECYCLE_CLOSED:closed")
  })

  test("the production runner wires owned temp paths and preserves explicit directories", async () => {
    const area = await createUiReviewRunLifecycle()
    try {
      const temporaryDirectory = await area.allocateDirectory("runner-tmp")
      const bin = await area.allocateDirectory("runner-bin")
      const isolationRoot = await area.allocateDirectory("runner-isolation")
      const outputRoot = await area.allocateDirectory("runner-output")
      const baselineRoot = await area.allocateDirectory("runner-baseline")
      const capturePath = join(await area.allocateDirectory("runner-capture"), "env.json")
      await writeFile(join(baselineRoot, "keep.txt"), "baseline\n", "utf8")
      await writeFakePnpm(bin, capturePath)
      const run = spawnRunner({
        TMPDIR: temporaryDirectory,
        PATH: `${bin}${delimiter}${process.env.PATH}`,
        UI_REVIEW_ISOLATION_ROOT: isolationRoot,
        UI_REVIEW_OUTPUT_DIR: outputRoot,
        UI_REVIEW_TEST_ENV_CAPTURE: capturePath,
      }, ["--baseline-dir", baselineRoot])
      expect(await run.closed).toMatchObject({ code: 0, signal: null })
      const captured = JSON.parse(await readFile(capturePath, "utf8")) as Record<string, string>
      const buildEnv = JSON.parse(await readFile(`${capturePath}.build`, "utf8")) as Record<string, string | null>
      expect(buildEnv.UI_REVIEW_OWNED_RUN_ROOT).toBeNull()
      expect(buildEnv.TMPDIR?.startsWith(captured.UI_REVIEW_OWNED_RUN_ROOT + sep)).toBe(true)
      expect(captured.UI_REVIEW_OUTPUT_DIR).toBe(outputRoot)
      expect(captured.UI_REVIEW_BASELINE_DIR).toBe(baselineRoot)
      expect(captured.TMPDIR).toBe(captured.TMP)
      expect(captured.TMPDIR).toBe(captured.TEMP)
      expect(captured.TMPDIR.startsWith(captured.UI_REVIEW_OWNED_RUN_ROOT + sep)).toBe(true)
      expect(captured.UI_REVIEW_OWNED_RUN_ROOT.startsWith(temporaryDirectory + sep)).toBe(true)
      await expect(access(captured.UI_REVIEW_OWNED_RUN_ROOT)).rejects.toMatchObject({ code: "ENOENT" })
      expect(await readFile(join(baselineRoot, "keep.txt"), "utf8")).toBe("baseline\n")
      await expect(access(isolationRoot)).resolves.toBeUndefined()
      await expect(access(outputRoot)).resolves.toBeUndefined()
      expect(await countRunRoots(temporaryDirectory)).toBe(0)
    } finally {
      await area.cleanup()
    }
  }, 15_000)

  test("the production runner cleans and preserves status on SIGTERM", async () => {
    const area = await createUiReviewRunLifecycle()
    try {
      const temporaryDirectory = await area.allocateDirectory("runner-signal-tmp")
      const bin = await area.allocateDirectory("runner-signal-bin")
      const capturePath = join(await area.allocateDirectory("runner-signal-capture"), "env.json")
      await writeFakePnpm(bin, capturePath, true)
      const run = spawnRunner({
        TMPDIR: temporaryDirectory,
        PATH: `${bin}${delimiter}${process.env.PATH}`,
      })
      const captured = await waitForJson(capturePath) as Record<string, string>
      run.child.kill("SIGTERM")
      expect(await run.closed).toMatchObject({ code: 143, signal: null })
      await expect(access(captured.UI_REVIEW_OWNED_RUN_ROOT)).rejects.toMatchObject({ code: "ENOENT" })
      expect(await countRunRoots(temporaryDirectory)).toBe(0)
    } finally {
      await area.cleanup()
    }
  }, 20_000)

  test("the production runner cleans its root after a thrown error", async () => {
    const area = await createUiReviewRunLifecycle()
    try {
      const temporaryDirectory = await area.allocateDirectory("runner-error-tmp")
      const bin = await area.allocateDirectory("runner-error-bin")
      const outputRoot = await area.allocateDirectory("runner-error-output")
      await writeFile(join(outputRoot, "occupied.txt"), "occupied\n", "utf8")
      await writeFakePnpm(bin)
      const run = spawnRunner({
        TMPDIR: temporaryDirectory,
        PATH: `${bin}${delimiter}${process.env.PATH}`,
        UI_REVIEW_OUTPUT_DIR: outputRoot,
      })
      expect(await run.closed).toMatchObject({ code: 1, signal: null })
      expect(run.stderr()).toContain("UI_REVIEW_OUTPUT_NOT_EMPTY")
      expect(await countRunRoots(temporaryDirectory)).toBe(0)
      expect(await readFile(join(outputRoot, "occupied.txt"), "utf8")).toBe("occupied\n")
    } finally {
      await area.cleanup()
    }
  }, 15_000)

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

async function writeFakePnpm(bin: string, capturePath?: string, hang = false) {
  const path = join(bin, "pnpm")
  await writeFile(path, `#!/usr/bin/env node
import { writeFileSync } from "node:fs"
const command = process.argv.slice(2).join(" ")
const capturePath = ${JSON.stringify(capturePath ?? "")}
if (command.includes("run build:deps")) {
  if (capturePath) writeFileSync(capturePath + ".build", JSON.stringify({ UI_REVIEW_OWNED_RUN_ROOT: process.env.UI_REVIEW_OWNED_RUN_ROOT ?? null, TMPDIR: process.env.TMPDIR }))
  process.exit(0)
}
if (command.includes("exec playwright test")) {
  if (capturePath) {
    const keys = ["UI_REVIEW_OUTPUT_DIR", "UI_REVIEW_BASELINE_DIR", "UI_REVIEW_OWNED_RUN_ROOT", "TMPDIR", "TMP", "TEMP"]
    writeFileSync(capturePath, JSON.stringify(Object.fromEntries(keys.map((key) => [key, process.env[key]]))))
  }
  if (${hang}) {
    process.on("SIGTERM", () => {})
    setInterval(() => {}, 1_000)
  } else {
    process.exit(Number(process.env.UI_REVIEW_TEST_PLAYWRIGHT_STATUS ?? 0))
  }
}
process.exit(9)
`, "utf8")
  await chmod(path, 0o755)
}

function spawnRunner(overrides: NodeJS.ProcessEnv, extraArgs: string[] = []) {
  const child = spawn(process.execPath, [TSX_CLI, RUNNER, "review", "workspace-component-baselines", "--critic=fixture", ...extraArgs], {
    cwd: TOOL_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...overrides },
  })
  spawnedProcesses.add(child)
  child.once("close", () => spawnedProcesses.delete(child))
  let stderr = ""
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (chunk: string) => { stderr += chunk })
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveClose, reject) => {
    child.once("error", reject)
    child.once("close", (code, signal) => resolveClose({ code, signal }))
  })
  return { child, closed, stderr: () => stderr }
}

function spawnFixture(mode: string, overrides: NodeJS.ProcessEnv = {}) {
  const child = spawn(process.execPath, [FIXTURE, mode], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...overrides },
  })
  spawnedProcesses.add(child)
  child.once("close", () => spawnedProcesses.delete(child))
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

async function stopDescendantProcess(pid: number) {
  if (!processExists(pid)) return
  try { process.kill(pid, "SIGTERM") } catch {}
  await sleep(50)
  if (processExists(pid)) {
    try { process.kill(pid, "SIGKILL") } catch {}
  }
  const deadline = Date.now() + 2_000
  while (processExists(pid) && Date.now() < deadline) await sleep(20)
}

async function stopSpawnedProcess(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill("SIGTERM")
  const closed = new Promise<boolean>((resolveClose) => child.once("close", () => resolveClose(true)))
  const stopped = await Promise.race([closed, sleep(2_000).then(() => false)])
  if (!stopped && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL")
    await new Promise<void>((resolveClose) => child.once("close", () => resolveClose()))
  }
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
  const deadline = Date.now() + 15_000
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

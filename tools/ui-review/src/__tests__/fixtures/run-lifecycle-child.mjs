import { spawn } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { createUiReviewRunLifecycle } from "../../../scripts/ui-review-run-lifecycle.mjs"

const [mode = "normal"] = process.argv.slice(2)
if (mode === "stubborn-descendant") {
  process.on("SIGTERM", () => {})
  const grandchild = spawn(process.execPath, [import.meta.filename, "stubborn-grandchild"], { stdio: "ignore" })
  await writeFile(process.env.UI_REVIEW_PID_FILE, `${JSON.stringify({ child: process.pid, grandchild: grandchild.pid })}\n`, "utf8")
  setInterval(() => {}, 1_000)
} else if (mode === "stubborn-grandchild") {
  process.on("SIGTERM", () => {})
  setInterval(() => {}, 1_000)
} else {
  await runFixture(mode)
}

async function runFixture(mode) {
  const lifecycle = await createUiReviewRunLifecycle({ terminationGraceMs: Number(process.env.UI_REVIEW_TEST_GRACE_MS ?? 100) })
  lifecycle.installSignalHandlers()
  let status = 0
  try {
    const isolationRoot = process.env.UI_REVIEW_ISOLATION_ROOT ?? await lifecycle.allocateDirectory("isolation")
    const outputRoot = process.env.UI_REVIEW_OUTPUT_DIR ?? await lifecycle.allocateDirectory("output")
    await Promise.all([mkdir(isolationRoot, { recursive: true }), mkdir(outputRoot, { recursive: true })])
    await Promise.all([
      writeFile(join(isolationRoot, "isolation-survived.txt"), "isolation\n", "utf8"),
      writeFile(join(outputRoot, "output-survived.txt"), "output\n", "utf8"),
    ])
    console.log(`UI_REVIEW_FIXTURE_READY:${JSON.stringify({ root: lifecycle.root, isolationRoot, outputRoot })}`)
    if (mode === "throw") throw new Error("UI_REVIEW_FIXTURE_THROW")
    if (mode === "wait") await sleep(60_000)
    if (mode === "hung-child") {
      const pidFile = process.env.UI_REVIEW_PID_FILE
      if (!pidFile) throw new Error("UI_REVIEW_PID_FILE_MISSING")
      await mkdir(dirname(pidFile), { recursive: true })
      status = await lifecycle.run(process.execPath, [import.meta.filename, "stubborn-descendant"], {
        stdio: "ignore",
        env: { ...process.env, UI_REVIEW_PID_FILE: pidFile },
      })
    }
  } catch (error) {
    console.error(error)
    status = 1
  } finally {
    await lifecycle.shutdown()
    lifecycle.removeSignalHandlers()
  }
  process.exitCode = status
}

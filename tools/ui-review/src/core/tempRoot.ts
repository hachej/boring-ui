import { rmSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, resolve, sep } from "node:path"

/**
 * Run-scoped temporary storage for the UI review tooling.
 *
 * Every temp directory the tooling needs is created *inside* one parent directory per process.
 *
 * The run root is removed when the process finishes normally: creating it registers a `process.on
 * ("exit")` listener that removes nothing but this module's own directory, which is safe in any
 * host — a CLI, a Playwright worker, a vitest worker.
 *
 * Signal handling is *not* automatic. Cleaning up on `SIGINT`/`SIGTERM`/`SIGHUP` means re-exiting
 * the process with the signal's conventional code, which only an entrypoint that owns its process
 * may decide. Those entrypoints opt in with {@link installUiReviewTempCleanupHandlers}; importing
 * this module elsewhere never takes over a worker's shutdown behind its back.
 *
 * Set `UI_REVIEW_KEEP_TMP=1` to retain the run directory for debugging.
 */
export const UI_REVIEW_TEMP_PREFIX = "boring-ui-review-run."
export const UI_REVIEW_KEEP_TMP_ENV = "UI_REVIEW_KEEP_TMP"

const CLEANUP_SIGNALS = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 } as const

let runRoot: string | undefined
let runRootPromise: Promise<string> | undefined
let exitHandlerInstalled = false
let signalHandlersInstalled = false

export function shouldKeepUiReviewTemp(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[UI_REVIEW_KEEP_TMP_ENV] === "1"
}

/** Refuse to remove anything that is not a directory we created under the OS temp directory. */
export function assertRemovableUiReviewTempRoot(candidate: string): string {
  const path = resolve(candidate)
  const base = resolve(tmpdir())
  if (path === base || !path.startsWith(`${base}${sep}`)) throw new Error(`UI_REVIEW_TEMP_ROOT_OUTSIDE_TMPDIR:${path}`)
  if (!basename(path).startsWith(UI_REVIEW_TEMP_PREFIX)) throw new Error(`UI_REVIEW_TEMP_ROOT_UNOWNED:${path}`)
  return path
}

/** Refuse to hand out (or remove) a path that escaped the run-scoped parent. */
export function assertWithinUiReviewTempRoot(root: string, candidate: string): string {
  const resolvedRoot = resolve(root)
  const path = resolve(candidate)
  if (path === resolvedRoot || !path.startsWith(`${resolvedRoot}${sep}`)) throw new Error(`UI_REVIEW_TEMP_OUTSIDE_ROOT:${path}`)
  return path
}

/** Create (once per process) the run-scoped parent directory and arm its removal on normal exit. */
export async function uiReviewTempRoot(): Promise<string> {
  if (runRoot) return runRoot
  runRootPromise ??= mkdtemp(resolve(tmpdir(), UI_REVIEW_TEMP_PREFIX)).then((created) => {
    runRoot = created
    installExitCleanup()
    return created
  })
  return runRootPromise
}

/** Create a temp directory for this run. `prefix` keeps existing call sites readable in `lsof`/traces. */
export async function createUiReviewTempDir(prefix: string): Promise<string> {
  const root = await uiReviewTempRoot()
  return assertWithinUiReviewTempRoot(root, await mkdtemp(resolve(root, prefix)))
}

/** Idempotent: safe to call from `finally`, from `exit`, and from a signal handler in the same process. */
export function cleanupUiReviewTempRootSync(): string | undefined {
  if (!runRoot) return undefined
  if (shouldKeepUiReviewTemp()) return undefined
  const current = runRoot
  runRoot = undefined
  runRootPromise = undefined
  // `rmSync` unlinks symlinks instead of descending into them, so cleanup can never escape the run root.
  rmSync(assertRemovableUiReviewTempRoot(current), { recursive: true, force: true, maxRetries: 2 })
  return current
}

/**
 * CLI entrypoints only: also remove the run root on `SIGINT`/`SIGTERM`/`SIGHUP`, then re-exit with
 * that signal's conventional code. Idempotent, and safe to call before the run root exists.
 *
 * Call this from a script that owns its process. A Playwright or vitest worker must not — it would
 * hand this module the decision to `process.exit()` out from under the runner. Those hosts keep the
 * automatic `exit` cleanup, which is enough: they are torn down by their own runner.
 */
export function installUiReviewTempCleanupHandlers(): void {
  installExitCleanup()
  if (signalHandlersInstalled) return
  signalHandlersInstalled = true
  for (const [signal, exitCode] of Object.entries(CLEANUP_SIGNALS)) {
    process.on(signal as NodeJS.Signals, () => {
      cleanupUiReviewTempRootSync()
      process.exit(exitCode)
    })
  }
}

function installExitCleanup(): void {
  if (exitHandlerInstalled) return
  exitHandlerInstalled = true
  process.on("exit", () => { cleanupUiReviewTempRootSync() })
}

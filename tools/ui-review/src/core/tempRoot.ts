import { rmSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, resolve, sep } from "node:path"

/**
 * Run-scoped temporary storage for the UI review tooling.
 *
 * Every temp directory the tooling needs is created *inside* one parent directory per process.
 * That parent is removed when the process finishes normally (`finally` / `exit`) and when it is
 * terminated by `SIGINT`/`SIGTERM`/`SIGHUP`, so an interrupted review run cannot leak inodes.
 *
 * Set `UI_REVIEW_KEEP_TMP=1` to retain the run directory for debugging.
 */
export const UI_REVIEW_TEMP_PREFIX = "boring-ui-review-run."
export const UI_REVIEW_KEEP_TMP_ENV = "UI_REVIEW_KEEP_TMP"

const CLEANUP_SIGNALS = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 } as const

let runRoot: string | undefined
let runRootPromise: Promise<string> | undefined
let handlersInstalled = false

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

/** Create (once per process) the run-scoped parent directory and arm its cleanup handlers. */
export async function uiReviewTempRoot(): Promise<string> {
  if (runRoot) return runRoot
  runRootPromise ??= mkdtemp(resolve(tmpdir(), UI_REVIEW_TEMP_PREFIX)).then((created) => {
    runRoot = created
    installCleanupHandlers()
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

export async function cleanupUiReviewTempRoot(): Promise<string | undefined> {
  return cleanupUiReviewTempRootSync()
}

function installCleanupHandlers(): void {
  if (handlersInstalled) return
  handlersInstalled = true
  process.on("exit", () => { cleanupUiReviewTempRootSync() })
  for (const [signal, exitCode] of Object.entries(CLEANUP_SIGNALS)) {
    process.on(signal as NodeJS.Signals, () => {
      cleanupUiReviewTempRootSync()
      process.exit(exitCode)
    })
  }
}

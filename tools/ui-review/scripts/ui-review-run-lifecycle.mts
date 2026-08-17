import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process"
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, isAbsolute, join, resolve } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

export const UI_REVIEW_RUN_ROOT_PREFIX = "boring-ui-review-run."
export const UI_REVIEW_RUN_MARKER = ".boring-ui-review-owned-run-v1.json"
export const UI_REVIEW_RUN_MARKER_KIND = "boring-ui-review-owned-run"
export const UI_REVIEW_RUN_MARKER_VERSION = 1
export const UI_REVIEW_RUN_ROOT_ENV = "UI_REVIEW_OWNED_RUN_ROOT"
export const UI_REVIEW_TERMINATION_GRACE_MS = 5_000

const SIGNAL_EXIT_CODES: Partial<Record<NodeJS.Signals, number>> = { SIGINT: 130, SIGTERM: 143 }
type LifecycleState = "open" | "closing" | "closed"
type ProcessGroup = { child: ChildProcess; pid: number | undefined }
type ChildResult = { code: number | null; signal: NodeJS.Signals | null; error: Error | null }

export type UiReviewRunLifecycle = {
  root: string
  env: Record<typeof UI_REVIEW_RUN_ROOT_ENV, string>
  allocateDirectory(label: string): Promise<string>
  run(command: string, args: string[], options?: SpawnOptions): Promise<number>
  cleanup(): Promise<void>
  shutdown(): Promise<void>
  installSignalHandlers(): void
  removeSignalHandlers(): void
}

export async function createUiReviewRunLifecycle(options: {
  temporaryDirectory?: string
  terminationGraceMs?: number
} = {}): Promise<UiReviewRunLifecycle> {
  if (process.platform === "win32") throw new Error("UI_REVIEW_PROCESS_GROUPS_UNSUPPORTED:win32")
  const temporaryDirectory = await realpath(resolve(options.temporaryDirectory ?? tmpdir()))
  const root = await mkdtemp(join(temporaryDirectory, UI_REVIEW_RUN_ROOT_PREFIX))
  const marker = {
    schemaVersion: UI_REVIEW_RUN_MARKER_VERSION,
    kind: UI_REVIEW_RUN_MARKER_KIND,
    root,
    parent: temporaryDirectory,
    ownerPid: process.pid,
    createdAt: new Date().toISOString(),
  }
  await writeFile(join(root, UI_REVIEW_RUN_MARKER), `${JSON.stringify(marker, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 })

  const activeGroups = new Map<ChildProcess, ProcessGroup>()
  const terminationGraceMs = options.terminationGraceMs ?? UI_REVIEW_TERMINATION_GRACE_MS
  let state: LifecycleState = "open"
  let deletePromise: Promise<void> | undefined
  let shutdownPromise: Promise<void> | undefined
  let requestedSignal: NodeJS.Signals | undefined

  const assertOpen = () => {
    if (state !== "open") throw new Error(`UI_REVIEW_RUN_LIFECYCLE_CLOSED:${state}`)
  }

  const allocateDirectory = async (label: string) => {
    assertOpen()
    assertSafeLabel(label)
    return await mkdtemp(join(root, `${label}.`))
  }

  const run = async (command: string, args: string[], spawnOptions: SpawnOptions = {}) => {
    assertOpen()
    const child = spawn(command, args, { ...spawnOptions, detached: true })
    const group = { child, pid: child.pid }
    activeGroups.set(child, group)
    const result = await new Promise<ChildResult>((resolveExit) => {
      let settled = false
      const finish = (value: ChildResult) => {
        if (settled) return
        settled = true
        resolveExit(value)
      }
      child.once("error", (error) => finish({ code: 1, signal: null, error }))
      child.once("close", (code, signal) => finish({ code, signal, error: null }))
    })
    await terminateResidualGroup(group, terminationGraceMs)
    activeGroups.delete(child)
    return result.error ? 1 : exitStatus(result.code, result.signal)
  }

  const deleteRoot = () => {
    deletePromise ??= deleteOwnedUiReviewRunRoot(root, temporaryDirectory)
    return deletePromise
  }

  const cleanup = async () => {
    assertOpen()
    if (activeGroups.size > 0) throw new Error("UI_REVIEW_RUN_CLEANUP_ACTIVE_CHILDREN")
    state = "closing"
    await deleteRoot()
    state = "closed"
  }

  const shutdown = async () => {
    shutdownPromise ??= (async () => {
      if (state === "closed") return
      state = "closing"
      if (activeGroups.size > 0) await terminateGroups([...activeGroups.values()], terminationGraceMs)
      await deleteRoot()
      state = "closed"
    })()
    return await shutdownPromise
  }

  const signalHandlers = new Map<NodeJS.Signals, () => void>()
  const installSignalHandlers = () => {
    assertOpen()
    if (signalHandlers.size > 0) return
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      const handler = () => {
        if (requestedSignal) return
        requestedSignal = signal
        void shutdown().catch((error: unknown) => console.error(error)).finally(() => process.exit(SIGNAL_EXIT_CODES[signal]))
      }
      signalHandlers.set(signal, handler)
      process.on(signal, handler)
    }
  }
  const removeSignalHandlers = () => {
    for (const [signal, handler] of signalHandlers) process.off(signal, handler)
    signalHandlers.clear()
  }

  return {
    root,
    env: { [UI_REVIEW_RUN_ROOT_ENV]: root },
    allocateDirectory,
    run,
    cleanup,
    shutdown,
    installSignalHandlers,
    removeSignalHandlers,
  }
}

export async function allocateUiReviewRunDirectory(label: string, env: NodeJS.ProcessEnv = process.env) {
  assertSafeLabel(label)
  const { root } = await readAndValidateOwnedRoot(env[UI_REVIEW_RUN_ROOT_ENV])
  return await mkdtemp(join(root, `${label}.`))
}

export async function deleteOwnedUiReviewRunRoot(candidateRoot: string, expectedParent: string) {
  const root = resolve(candidateRoot)
  const parent = await realpath(resolve(expectedParent))
  const metadata = await lstat(root)
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("UI_REVIEW_RUN_ROOT_TYPE_INVALID")
  if (!isAbsolute(root) || dirname(root) !== parent || !basename(root).startsWith(UI_REVIEW_RUN_ROOT_PREFIX)) {
    throw new Error("UI_REVIEW_RUN_ROOT_PARENT_INVALID")
  }
  const validated = await readAndValidateOwnedRoot(root)
  if (validated.parent !== parent || validated.root !== root) throw new Error("UI_REVIEW_RUN_ROOT_OWNERSHIP_INVALID")
  await rm(root, { recursive: true, force: false })
}

async function readAndValidateOwnedRoot(candidateRoot: string | undefined) {
  if (!candidateRoot || !isAbsolute(candidateRoot)) throw new Error("UI_REVIEW_RUN_ROOT_MISSING")
  const root = resolve(candidateRoot)
  const metadata = await lstat(root)
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("UI_REVIEW_RUN_ROOT_TYPE_INVALID")
  const canonicalRoot = await realpath(root)
  if (canonicalRoot !== root || !basename(root).startsWith(UI_REVIEW_RUN_ROOT_PREFIX)) throw new Error("UI_REVIEW_RUN_ROOT_INVALID")
  let raw: unknown
  try { raw = JSON.parse(await readFile(join(root, UI_REVIEW_RUN_MARKER), "utf8")) }
  catch { throw new Error("UI_REVIEW_RUN_ROOT_MARKER_INVALID") }
  if (!isRecord(raw)
    || raw.schemaVersion !== UI_REVIEW_RUN_MARKER_VERSION
    || raw.kind !== UI_REVIEW_RUN_MARKER_KIND
    || raw.root !== root
    || raw.parent !== dirname(root)) {
    throw new Error("UI_REVIEW_RUN_ROOT_MARKER_INVALID")
  }
  return { root, parent: raw.parent as string }
}

async function terminateGroups(groups: ProcessGroup[], graceMs: number) {
  for (const group of groups) signalGroup(group, "SIGTERM")
  const survivors = await waitForGroups(groups, graceMs)
  for (const group of survivors) signalGroup(group, "SIGKILL")
  await Promise.all(groups.map(({ child }) => waitForClose(child)))
}

async function terminateResidualGroup(group: ProcessGroup, graceMs: number) {
  if (!groupExists(group)) return
  signalGroup(group, "SIGTERM")
  const [survivor] = await waitForGroups([group], graceMs)
  if (survivor) signalGroup(survivor, "SIGKILL")
}

async function waitForGroups(groups: ProcessGroup[], graceMs: number) {
  const deadline = Date.now() + graceMs
  let survivors = groups.filter(groupExists)
  while (survivors.length > 0 && Date.now() < deadline) {
    await sleep(Math.min(25, Math.max(1, deadline - Date.now())))
    survivors = survivors.filter(groupExists)
  }
  return survivors
}

function groupExists(group: ProcessGroup) {
  if (!group.pid) return false
  try {
    process.kill(-group.pid, 0)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false
    throw error
  }
}

function signalGroup(group: ProcessGroup, signal: NodeJS.Signals) {
  if (!group.pid) return
  try { process.kill(-group.pid, signal) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
  }
}

function waitForClose(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise<void>((resolveExit) => child.once("close", () => resolveExit()))
}

function exitStatus(code: number | null, signal: NodeJS.Signals | null) {
  if (code !== null) return code
  return signal ? SIGNAL_EXIT_CODES[signal] ?? 1 : 1
}

function assertSafeLabel(label: string) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(label)) throw new Error(`UI_REVIEW_RUN_LABEL_INVALID:${label}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

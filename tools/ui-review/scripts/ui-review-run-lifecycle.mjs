import { spawn } from "node:child_process"
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

const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143 }

export async function createUiReviewRunLifecycle(options = {}) {
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

  const activeGroups = new Map()
  const terminationGraceMs = options.terminationGraceMs ?? UI_REVIEW_TERMINATION_GRACE_MS
  let cleanupPromise
  let shutdownPromise
  let requestedSignal

  const allocateDirectory = async (label) => {
    assertSafeLabel(label)
    return await mkdtemp(join(root, `${label}.`))
  }

  const run = async (command, args, spawnOptions = {}) => {
    const child = spawn(command, args, {
      ...spawnOptions,
      detached: process.platform !== "win32",
    })
    const group = { child, pid: child.pid }
    activeGroups.set(child, group)
    const result = await new Promise((resolveExit) => {
      let settled = false
      const finish = (value) => {
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

  const cleanup = async () => {
    cleanupPromise ??= deleteOwnedUiReviewRunRoot(root, temporaryDirectory)
    return await cleanupPromise
  }

  const shutdown = async () => {
    shutdownPromise ??= (async () => {
      if (activeGroups.size > 0) await terminateGroups([...activeGroups.values()], "SIGTERM", terminationGraceMs)
      await cleanup()
    })()
    return await shutdownPromise
  }

  const signalHandlers = new Map()
  const installSignalHandlers = () => {
    for (const signal of Object.keys(SIGNAL_EXIT_CODES)) {
      const handler = () => {
        if (requestedSignal) return
        requestedSignal = signal
        void shutdown().catch((error) => console.error(error)).finally(() => process.exit(SIGNAL_EXIT_CODES[signal]))
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

export async function allocateUiReviewRunDirectory(label, env = process.env) {
  assertSafeLabel(label)
  const { root } = await readAndValidateOwnedRoot(env[UI_REVIEW_RUN_ROOT_ENV])
  return await mkdtemp(join(root, `${label}.`))
}

export async function deleteOwnedUiReviewRunRoot(candidateRoot, expectedParent) {
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

async function readAndValidateOwnedRoot(candidateRoot) {
  if (!candidateRoot || !isAbsolute(candidateRoot)) throw new Error("UI_REVIEW_RUN_ROOT_MISSING")
  const root = resolve(candidateRoot)
  const metadata = await lstat(root)
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("UI_REVIEW_RUN_ROOT_TYPE_INVALID")
  const canonicalRoot = await realpath(root)
  if (canonicalRoot !== root || !basename(root).startsWith(UI_REVIEW_RUN_ROOT_PREFIX)) throw new Error("UI_REVIEW_RUN_ROOT_INVALID")
  let raw
  try { raw = JSON.parse(await readFile(join(root, UI_REVIEW_RUN_MARKER), "utf8")) }
  catch { throw new Error("UI_REVIEW_RUN_ROOT_MARKER_INVALID") }
  if (raw?.schemaVersion !== UI_REVIEW_RUN_MARKER_VERSION
    || raw?.kind !== UI_REVIEW_RUN_MARKER_KIND
    || raw?.root !== root
    || raw?.parent !== dirname(root)) {
    throw new Error("UI_REVIEW_RUN_ROOT_MARKER_INVALID")
  }
  return { root, parent: raw.parent }
}

async function terminateGroups(groups, signal, graceMs) {
  for (const group of groups) signalGroup(group, signal)
  await sleep(graceMs)
  for (const group of groups) signalGroup(group, "SIGKILL")
  await Promise.all(groups.map(({ child }) => waitForClose(child)))
}

async function terminateResidualGroup(group, graceMs) {
  if (!groupExists(group)) return
  signalGroup(group, "SIGTERM")
  await sleep(graceMs)
  signalGroup(group, "SIGKILL")
}

function groupExists(group) {
  if (!group.pid) return false
  try {
    if (process.platform === "win32") return group.child.exitCode === null && group.child.signalCode === null
    process.kill(-group.pid, 0)
    return true
  } catch (error) {
    if (error?.code === "ESRCH") return false
    throw error
  }
}

function signalGroup(group, signal) {
  if (!group.pid) return
  try {
    if (process.platform === "win32") group.child.kill(signal)
    else process.kill(-group.pid, signal)
  } catch (error) {
    if (error?.code !== "ESRCH") throw error
  }
}

function waitForClose(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolveExit) => child.once("close", () => resolveExit()))
}

function exitStatus(code, signal) {
  if (code !== null) return code
  return SIGNAL_EXIT_CODES[signal] ?? 1
}

function assertSafeLabel(label) {
  if (typeof label !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(label)) throw new Error(`UI_REVIEW_RUN_LABEL_INVALID:${label}`)
}

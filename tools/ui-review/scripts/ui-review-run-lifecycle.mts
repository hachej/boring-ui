import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process"
import { lstat, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises"
import { constants as osConstants, tmpdir } from "node:os"
import { basename, dirname, isAbsolute, join, resolve } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

export const UI_REVIEW_RUN_ROOT_PREFIX = "boring-ui-review-run."
export const UI_REVIEW_RUN_MARKER = ".boring-ui-review-owned-run-v1.json"
export const UI_REVIEW_RUN_MARKER_KIND = "boring-ui-review-owned-run"
export const UI_REVIEW_RUN_MARKER_VERSION = 1
export const UI_REVIEW_RUN_ROOT_ENV = "UI_REVIEW_OWNED_RUN_ROOT"
export const UI_REVIEW_TERMINATION_GRACE_MS = 5_000

const SIGNAL_EXIT_CODES: Partial<Record<NodeJS.Signals, number>> = { SIGINT: 130, SIGTERM: 143 }
const PROCESS_SUPERVISOR = resolve(import.meta.dirname, "ui-review-process-supervisor.mts")
type LifecycleState = "open" | "closing" | "closed"
type ChildResult = { code: number | null; signal: NodeJS.Signals | null; error: string | null }
type SupervisedGroup = {
  supervisor: ChildProcess
  pid: number
  result: Promise<ChildResult>
  termination?: Promise<void>
}

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
  if (process.platform !== "linux") throw new Error(`UI_REVIEW_PROCESS_GROUPS_UNSUPPORTED:${process.platform}`)
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

  const activeGroups = new Map<ChildProcess, SupervisedGroup>()
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
    const stdioMode = spawnOptions.stdio ?? "inherit"
    if (stdioMode !== "inherit" && stdioMode !== "ignore") throw new Error("UI_REVIEW_RUN_STDIO_UNSUPPORTED")
    const supervisor = spawn(process.execPath, [PROCESS_SUPERVISOR, command, Buffer.from(JSON.stringify(args)).toString("base64url"), stdioMode], {
      cwd: spawnOptions.cwd,
      env: spawnOptions.env,
      detached: true,
      stdio: [stdioMode, stdioMode, stdioMode, "ipc"],
    })
    if (!supervisor.pid) throw new Error("UI_REVIEW_SUPERVISOR_PID_MISSING")
    const group: SupervisedGroup = {
      supervisor,
      pid: supervisor.pid,
      result: waitForSupervisedResult(supervisor),
    }
    activeGroups.set(supervisor, group)
    const result = await group.result
    await terminateSupervisedGroup(group, terminationGraceMs)
    activeGroups.delete(supervisor)
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
      await Promise.all([...activeGroups.values()].map((group) => terminateSupervisedGroup(group, terminationGraceMs)))
      await deleteRoot()
      state = "closed"
    })()
    return await shutdownPromise
  }

  const signalHandlers = new Map<NodeJS.Signals, () => void>()
  const removeSignalHandlers = () => {
    for (const [signal, handler] of signalHandlers) process.off(signal, handler)
    signalHandlers.clear()
  }
  const installSignalHandlers = () => {
    assertOpen()
    if (signalHandlers.size > 0) return
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      const handler = () => {
        if (requestedSignal) return
        requestedSignal = signal
        removeSignalHandlers()
        void shutdown().catch((error: unknown) => console.error(error)).finally(() => process.exit(SIGNAL_EXIT_CODES[signal]))
      }
      signalHandlers.set(signal, handler)
      process.on(signal, handler)
    }
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

function waitForSupervisedResult(supervisor: ChildProcess) {
  return new Promise<ChildResult>((resolveResult) => {
    let settled = false
    const finish = (result: ChildResult) => {
      if (settled) return
      settled = true
      resolveResult(result)
    }
    supervisor.on("message", (message: unknown) => {
      if (!isRecord(message) || message.type !== "result") return
      finish({
        code: typeof message.code === "number" ? message.code : null,
        signal: typeof message.signal === "string" ? message.signal as NodeJS.Signals : null,
        error: typeof message.error === "string" ? message.error : null,
      })
    })
    supervisor.once("error", (error) => finish({ code: 1, signal: null, error: error.message }))
    supervisor.once("close", (code, signal) => finish({ code: code ?? 1, signal, error: "UI_REVIEW_SUPERVISOR_EARLY_EXIT" }))
  })
}

function terminateSupervisedGroup(group: SupervisedGroup, graceMs: number) {
  group.termination ??= (async () => {
    const initialMembers = await processGroupMembers(group.pid)
    if (!initialMembers.includes(group.pid)) return
    const descendants = initialMembers.filter((pid) => pid !== group.pid)
    if (descendants.length > 0) {
      signalStableGroup(group, "SIGTERM")
      const stopped = await waitForSupervisorOnly(group.pid, graceMs)
      if (!stopped) {
        signalStableGroup(group, "SIGKILL")
        await waitForClose(group.supervisor)
        return
      }
    }
    if (group.supervisor.connected) group.supervisor.send({ type: "release" })
    await waitForClose(group.supervisor)
  })()
  return group.termination
}

async function waitForSupervisorOnly(supervisorPid: number, graceMs: number) {
  const deadline = Date.now() + graceMs
  while (Date.now() < deadline) {
    const members = await processGroupMembers(supervisorPid)
    if (members.length === 1 && members[0] === supervisorPid) return true
    if (!members.includes(supervisorPid)) return false
    await sleep(Math.min(25, Math.max(1, deadline - Date.now())))
  }
  const members = await processGroupMembers(supervisorPid)
  return members.length === 1 && members[0] === supervisorPid
}

async function processGroupMembers(groupId: number) {
  const members: number[] = []
  for (const entry of await readdir("/proc", { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue
    try {
      const stat = await readFile(`/proc/${entry.name}/stat`, "utf8")
      const match = stat.match(/^\d+ \(.*\) \S (?:\d+) (\d+) /)
      if (match && Number(match[1]) === groupId) members.push(Number(entry.name))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
  }
  return members.sort((a, b) => a - b)
}

function signalStableGroup(group: SupervisedGroup, signal: NodeJS.Signals) {
  if (group.supervisor.exitCode !== null || group.supervisor.signalCode !== null) {
    throw new Error("UI_REVIEW_SUPERVISOR_NOT_STABLE")
  }
  process.kill(-group.pid, signal)
}

function waitForClose(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise<void>((resolveExit) => child.once("close", () => resolveExit()))
}

function exitStatus(code: number | null, signal: NodeJS.Signals | null) {
  if (code !== null) return code
  if (!signal) return 1
  const signalNumber = osConstants.signals[signal]
  return signalNumber ? 128 + signalNumber : 1
}

function assertSafeLabel(label: string) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(label)) throw new Error(`UI_REVIEW_RUN_LABEL_INVALID:${label}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

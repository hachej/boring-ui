import { spawn } from "node:child_process"
import { constants } from "node:fs"
import { access, open, realpath, type FileHandle } from "node:fs/promises"
import { delimiter, isAbsolute, relative, resolve, sep } from "node:path"

export interface BeadsReadLimits {
  readonly timeoutMs: number
  readonly maxOutputBytes: number
}

export interface BeadsOperations {
  runRead(args: readonly string[], limits: BeadsReadLimits): Promise<{ stdout: string }>
  /** Idempotently release pinned runtime resources after in-flight reads finish. */
  dispose?(): Promise<void>
}

export type BeadsOperationFailureKind =
  | "binary-not-found"
  | "timeout"
  | "output-too-large"
  | "command-failed"
  | "not-found"
  | "store-not-found"
  | "store-unhealthy"
  | "runtime-unavailable"

export class BeadsOperationError extends Error {
  constructor(readonly kind: BeadsOperationFailureKind) {
    super(`Beads operation failed: ${kind}`)
    this.name = "BeadsOperationError"
  }
}

/** Minimal structural subset of Workspace authority required by this adapter. */
export interface BeadsWorkspaceAuthority {
  readonly root: string
  readonly runtimeContext: { readonly runtimeCwd: string }
  stat(relPath: string): Promise<{ kind: "file" | "dir" }>
}

const LIST_ARGS = ["list", "--all", "--json", "--no-auto-flush", "--no-auto-import", "--no-db"] as const
const SHOW_PREFIX = ["show", "--json", "--no-auto-flush", "--no-auto-import", "--no-db", "--"] as const
const BEAD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/
const REQUIRED_STORE_FILES = ["issues.jsonl", "metadata.json", "config.yaml"] as const

export function isValidBeadId(value: string): boolean {
  return value === value.normalize("NFC") && BEAD_ID_PATTERN.test(value)
}

export function isAllowedBeadsReadArgs(args: readonly string[]): boolean {
  if (args.length === 1 && args[0] === "--version") return true
  if (args.length === LIST_ARGS.length && LIST_ARGS.every((value, index) => args[index] === value)) return true
  return args.length === SHOW_PREFIX.length + 1
    && SHOW_PREFIX.every((value, index) => args[index] === value)
    && typeof args[SHOW_PREFIX.length] === "string"
    && isValidBeadId(args[SHOW_PREFIX.length]!)
}

function isInside(root: string, target: string): boolean {
  const fromRoot = relative(root, target)
  return fromRoot === "" || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot))
}

function classifiedJsonCode(output: string): BeadsOperationFailureKind | null {
  try {
    const parsed = JSON.parse(output) as { error?: { code?: unknown } }
    const code = parsed.error?.code
    if (code === "ISSUE_NOT_FOUND") return "not-found"
    if (code === "NOT_INITIALIZED") return "store-not-found"
    if (
      code === "CONFIG_ERROR"
      || code === "CORRUPT_DATABASE"
      || code === "DATABASE_CORRUPT"
      || code === "DATABASE_ERROR"
      || code === "DB_ERROR"
      || code === "SQLITE_ERROR"
      || code === "STALE_DATABASE"
      || code === "STALE_DB"
    ) return "store-unhealthy"
  } catch {
    // Non-JSON command failures remain command-failed.
  }
  return null
}

async function openPinnedExecutable(path: string, failure: BeadsOperationFailureKind): Promise<FileHandle> {
  let target: string
  try {
    target = await realpath(path)
    await access(target, constants.X_OK)
    const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    if (!(await handle.stat()).isFile()) {
      await handle.close()
      throw new Error("not a file")
    }
    return handle
  } catch {
    throw new BeadsOperationError(failure)
  }
}

async function resolvePinnedBr(): Promise<FileHandle> {
  const pathEntries = (process.env.PATH ?? "").split(delimiter).filter(Boolean)
  for (const entry of pathEntries) {
    try {
      return await openPinnedExecutable(resolve(entry, "br"), "binary-not-found")
    } catch {
      // Try the next trusted-host PATH entry.
    }
  }
  throw new BeadsOperationError("binary-not-found")
}

interface PinnedRuntime {
  sandbox: FileHandle
  br: FileHandle
}

async function openPinnedRuntime(): Promise<PinnedRuntime> {
  if (process.platform !== "linux") throw new BeadsOperationError("runtime-unavailable")
  const sandbox = await openPinnedExecutable("/usr/bin/bwrap", "runtime-unavailable")
  try {
    return { sandbox, br: await resolvePinnedBr() }
  } catch (cause) {
    await sandbox.close()
    throw cause
  }
}

interface PinnedWorkspaceSnapshot {
  issues: FileHandle
  metadata: FileHandle
  config: FileHandle
  writeLock: FileHandle
  syncLock: FileHandle
}

async function closeWorkspaceSnapshot(snapshot: Partial<PinnedWorkspaceSnapshot>): Promise<void> {
  await Promise.allSettled(Object.values(snapshot).map((handle) => handle.close()))
}

async function openPinnedWorkspace(workspace: BeadsWorkspaceAuthority): Promise<PinnedWorkspaceSnapshot> {
  let rootPath: string
  let runtimeCwd: string
  try {
    ;[rootPath, runtimeCwd] = await Promise.all([realpath(workspace.root), realpath(workspace.runtimeContext.runtimeCwd)])
  } catch {
    throw new BeadsOperationError("runtime-unavailable")
  }
  if (rootPath !== runtimeCwd || !isInside(rootPath, runtimeCwd)) throw new BeadsOperationError("runtime-unavailable")

  let root: FileHandle | undefined
  let beads: FileHandle | undefined
  const snapshot: Partial<PinnedWorkspaceSnapshot> = {}
  try {
    root = await open(rootPath, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0))
    if (!(await root.stat()).isDirectory()) throw new BeadsOperationError("runtime-unavailable")
    const authorityBeads = await workspace.stat(".beads")
    if (authorityBeads.kind !== "dir") throw new Error("not a directory")
    beads = await open(`/proc/self/fd/${root.fd}/.beads`, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0))
    if (!(await beads.stat()).isDirectory()) throw new Error("not a directory")

    for (const name of REQUIRED_STORE_FILES) {
      const authorityStat = await workspace.stat(`.beads/${name}`)
      if (authorityStat.kind !== "file") throw new Error("not a file")
      const file = await open(`/proc/self/fd/${beads.fd}/${name}`, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
      if (!(await file.stat()).isFile()) {
        await file.close()
        throw new Error("not a file")
      }
      if (name === "issues.jsonl") snapshot.issues = file
      else if (name === "metadata.json") snapshot.metadata = file
      else snapshot.config = file
    }
    snapshot.writeLock = await open("/dev/null", constants.O_RDONLY)
    snapshot.syncLock = await open("/dev/null", constants.O_RDONLY)
    await Promise.all([root.close(), beads.close()])
    root = undefined
    beads = undefined
    return snapshot as PinnedWorkspaceSnapshot
  } catch (cause) {
    await Promise.allSettled([root?.close(), beads?.close()].filter((value): value is Promise<void> => Boolean(value)))
    await closeWorkspaceSnapshot(snapshot)
    if (cause instanceof BeadsOperationError) throw cause
    throw new BeadsOperationError("store-not-found")
  }
}

const SANDBOX_PREFIX = [
  "--die-with-parent",
  "--unshare-all",
  "--new-session",
  "--cap-drop", "ALL",
  "--clearenv",
  "--setenv", "HOME", "/nonexistent",
  "--setenv", "PATH", "/usr/bin:/bin",
  "--setenv", "LC_ALL", "C",
  "--setenv", "BEADS_DIR", "/workspace/.beads",
  "--ro-bind", "/usr", "/usr",
  "--ro-bind", "/lib", "/lib",
  "--ro-bind", "/lib64", "/lib64",
  "--proc", "/proc",
  "--dev", "/dev",
  "--tmpfs", "/tmp",
  "--tmpfs", "/workspace",
  "--dir", "/workspace/.beads",
  // Snapshot only admitted Beads data into the sandbox. The source FDs are
  // opened relative to pinned root/.beads descriptors, then copied read-only.
  "--ro-bind-data", "5", "/workspace/.beads/issues.jsonl",
  "--ro-bind-data", "6", "/workspace/.beads/metadata.json",
  "--ro-bind-data", "7", "/workspace/.beads/config.yaml",
  // br 0.2.16 takes these locks even with --no-db. They are ephemeral copies.
  "--perms", "0600", "--file", "8", "/workspace/.beads/.write.lock",
  "--perms", "0600", "--file", "9", "/workspace/.beads/.sync.lock",
  "--ro-bind-fd", "4", "/br",
  "--chdir", "/workspace",
  "--", "/br",
] as const

function executeSandboxedBr(
  runtime: PinnedRuntime,
  workspace: PinnedWorkspaceSnapshot,
  args: readonly string[],
  limits: BeadsReadLimits,
): Promise<{ stdout: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let outputBytes = 0
    let forcedFailure: BeadsOperationFailureKind | undefined
    let settled = false
    const child = spawn("/proc/self/fd/3", [...SANDBOX_PREFIX, ...args], {
      env: {},
      stdio: [
        "ignore",
        "pipe",
        "pipe",
        runtime.sandbox.fd,
        runtime.br.fd,
        workspace.issues.fd,
        workspace.metadata.fd,
        workspace.config.fd,
        workspace.writeLock.fd,
        workspace.syncLock.fd,
      ],
      windowsHide: true,
    })
    const finish = (result: { stdout: string } | BeadsOperationError) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (result instanceof BeadsOperationError) rejectPromise(result)
      else resolvePromise(result)
    }
    const capture = (chunks: Buffer[]) => (chunk: Buffer) => {
      outputBytes += chunk.byteLength
      if (outputBytes > limits.maxOutputBytes) {
        forcedFailure = "output-too-large"
        child.kill("SIGKILL")
        return
      }
      chunks.push(chunk)
    }
    child.stdout!.on("data", capture(stdoutChunks))
    child.stderr!.on("data", capture(stderrChunks))
    child.on("error", () => finish(new BeadsOperationError("command-failed")))
    child.on("close", (code) => {
      if (forcedFailure) {
        finish(new BeadsOperationError(forcedFailure))
        return
      }
      const stdout = Buffer.concat(stdoutChunks).toString("utf8")
      if (code === 0) {
        finish({ stdout })
        return
      }
      const stderr = Buffer.concat(stderrChunks).toString("utf8")
      finish(new BeadsOperationError(classifiedJsonCode(stdout) ?? classifiedJsonCode(stderr) ?? "command-failed"))
    })
    const timer = setTimeout(() => {
      forcedFailure = "timeout"
      child.kill("SIGKILL")
    }, limits.timeoutMs)
    timer.unref()
  })
}

/**
 * Local adapter. The trusted host supplies Workspace authority once; callers
 * can select neither executable nor cwd, and the argv firewall permits only
 * the pinned read protocol. A pinned bubblewrap runtime receives read-only
 * copies of exactly three files opened relative to pinned Workspace/.beads
 * directory FDs; it never receives the Workspace root. The sandbox disables
 * networking and confines br's unavoidable writes to private tmpfs mounts.
 */
export function createWorkspaceBeadsOperations(workspace: BeadsWorkspaceAuthority): BeadsOperations {
  let runtimePromise: Promise<PinnedRuntime> | undefined
  let disposed = false
  let disposePromise: Promise<void> | undefined
  let activeReads = 0
  const idleWaiters: Array<() => void> = []
  const pinnedRuntime = () => {
    runtimePromise ??= openPinnedRuntime().catch((cause) => {
      runtimePromise = undefined
      throw cause
    })
    return runtimePromise
  }
  const releaseRead = () => {
    activeReads -= 1
    if (activeReads === 0) idleWaiters.splice(0).forEach((resolveIdle) => resolveIdle())
  }
  const operations: BeadsOperations = {
    async runRead(args: readonly string[], limits: BeadsReadLimits): Promise<{ stdout: string }> {
      if (disposed || !isAllowedBeadsReadArgs(args)) throw new BeadsOperationError("runtime-unavailable")
      if (!Number.isSafeInteger(limits.timeoutMs) || limits.timeoutMs < 1 || limits.timeoutMs > 120_000) {
        throw new BeadsOperationError("runtime-unavailable")
      }
      if (!Number.isSafeInteger(limits.maxOutputBytes) || limits.maxOutputBytes < 1 || limits.maxOutputBytes > 16 * 1024 * 1024) {
        throw new BeadsOperationError("runtime-unavailable")
      }
      activeReads += 1
      try {
        const snapshot = await openPinnedWorkspace(workspace)
        try {
          const runtime = await pinnedRuntime()
          return await executeSandboxedBr(runtime, snapshot, args, limits)
        } finally {
          await closeWorkspaceSnapshot(snapshot)
        }
      } finally {
        releaseRead()
      }
    },
    async dispose(): Promise<void> {
      disposePromise ??= (async () => {
        disposed = true
        if (activeReads > 0) await new Promise<void>((resolveIdle) => idleWaiters.push(resolveIdle))
        const pendingRuntime = runtimePromise
        runtimePromise = undefined
        if (!pendingRuntime) return
        try {
          const runtime = await pendingRuntime
          await Promise.allSettled([runtime.sandbox.close(), runtime.br.close()])
        } catch {
          // Failed runtime acquisition already closes partial resources.
        }
      })()
      return disposePromise
    },
  }
  return Object.freeze(operations)
}

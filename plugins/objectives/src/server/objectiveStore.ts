import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { randomUUID } from "node:crypto"
import { OBJECTIVE_ERROR_CODES } from "../shared/error-codes"
import { ObjectiveSchema, StoredObjectiveStateSchema } from "../shared/schema"
import type { CreateObjectiveInput, Objective, ObjectiveStatus, UpdateObjectiveInput } from "../shared/types"
import { assertFileNotSymlink, ensureContainedDir } from "./pathSafety"

export class ObjectiveStoreError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export interface ObjectiveLoadDiagnostic {
  /** Index into the on-disk objectives array, or -1 for a whole-file problem. */
  index: number
  reason: string
}

export interface ObjectiveStore {
  list(status?: ObjectiveStatus): Promise<Objective[]>
  get(id: string): Promise<Objective | null>
  create(input: CreateObjectiveInput): Promise<Objective>
  update(input: UpdateObjectiveInput): Promise<Objective>
  /** Records skipped on the most recent load because they failed schema validation, plus any whole-file issues (e.g. legacy migration). */
  getLoadDiagnostics(): ObjectiveLoadDiagnostic[]
}

type OnDiskState = { version: 1; revision: number; objectives: unknown[] }
type LoadedState = { revision: number; objectives: Map<string, Objective> }

/** How long to poll for the write lock before giving up (see `mutate()`). */
const LOCK_ACQUIRE_TIMEOUT_MS = 5_000
const LOCK_POLL_INTERVAL_MS = 25
/** How old an unreleased lock must be before it's treated as crash-abandoned. */
const LOCK_STALE_MS = 30_000

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface FileObjectiveStoreOptions {
  /**
   * Trust boundary root. When set, every read and write re-resolves the
   * store's directory with a realpath containment check so a workspace-
   * controlled symlink (e.g. `.boring` replaced with a symlink pointing
   * outside the workspace) cannot redirect the trusted host process to an
   * arbitrary host path.
   */
  workspaceRoot?: string
}

export class FileObjectiveStore implements ObjectiveStore {
  private readonly dir: string
  private readonly fileName: string
  private writeChain = Promise.resolve()
  private diagnostics: ObjectiveLoadDiagnostic[] = []

  constructor(
    private readonly filePath: string,
    private readonly options: FileObjectiveStoreOptions = {},
  ) {
    this.dir = dirname(filePath)
    this.fileName = basename(filePath)
  }

  async list(status?: ObjectiveStatus): Promise<Objective[]> {
    const { objectives } = await this.readState()
    const values = [...objectives.values()]
      .filter((objective) => !status || objective.status === status)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    return values.map(clone)
  }

  async get(id: string): Promise<Objective | null> {
    const { objectives } = await this.readState()
    const objective = objectives.get(id)
    return objective ? clone(objective) : null
  }

  async create(input: CreateObjectiveInput): Promise<Objective> {
    let created: Objective | undefined
    await this.mutate((objectives) => {
      if (input.clientRequestId) {
        const existing = [...objectives.values()].find((o) => o.clientRequestId === input.clientRequestId)
        if (existing) {
          created = clone(existing)
          return false
        }
      }
      const now = nowIso()
      const objective: Objective = {
        id: generateObjectiveId(),
        title: input.title,
        objective: input.objective,
        metric: input.metric,
        baseline: input.baseline,
        target: input.target,
        current: input.current ?? input.baseline,
        status: input.status ?? "active",
        constraints: input.constraints ?? [],
        evidenceRefs: input.evidenceRefs ?? [],
        ...(input.outcome !== undefined ? { outcome: input.outcome } : {}),
        ...(input.clientRequestId !== undefined ? { clientRequestId: input.clientRequestId } : {}),
        createdAt: now,
        updatedAt: now,
      }
      objectives.set(objective.id, objective)
      created = clone(objective)
      return true
    })
    return created!
  }

  async update(input: UpdateObjectiveInput): Promise<Objective> {
    let updated: Objective | undefined
    await this.mutate((objectives) => {
      const existing = objectives.get(input.id)
      if (!existing) {
        throw new ObjectiveStoreError(OBJECTIVE_ERROR_CODES.NOT_FOUND, `objective ${input.id} not found`)
      }
      const next: Objective = {
        ...existing,
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.objective !== undefined ? { objective: input.objective } : {}),
        ...(input.metric !== undefined ? { metric: input.metric } : {}),
        ...(input.baseline !== undefined ? { baseline: input.baseline } : {}),
        ...(input.target !== undefined ? { target: input.target } : {}),
        ...(input.current !== undefined ? { current: input.current } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.constraints !== undefined ? { constraints: input.constraints } : {}),
        ...(input.evidenceRefs !== undefined ? { evidenceRefs: input.evidenceRefs } : {}),
        ...(input.outcome !== undefined ? { outcome: input.outcome } : {}),
        updatedAt: nowIso(),
      }
      objectives.set(next.id, next)
      updated = clone(next)
      return true
    })
    return updated!
  }

  getLoadDiagnostics(): ObjectiveLoadDiagnostic[] {
    return [...this.diagnostics]
  }

  /**
   * Reread-before-mutate + revision CAS, serialized by an owner-token lock
   * file. This store's concurrency contract is single live writer + safe
   * restart overlap — one workspace server process owns this file — not
   * N-writer serializability. `writeChain` alone only serializes mutations
   * within *this* `FileObjectiveStore` instance; it does nothing for a
   * second instance (a restarted process whose predecessor hasn't fully
   * exited, or a second store constructed in-process) racing the same file.
   * The lock file closes that gap: it is acquired before the read-check-
   * write sequence begins, and the pre-commit revision recheck happens
   * *inside* the held lock, so two writers can never both observe a
   * matching revision and both commit — one blocks on lock acquisition
   * until the other's commit (and release) completes, then re-reads the
   * now-current revision.
   *
   * The lock file holds `{ pid, token, timestamp }`. `token` (not pid,
   * which can be reused by an unrelated process, and not mere existence,
   * which a reclaimer could recreate) is the source of truth for
   * ownership: release only removes the lock file if it still contains our
   * own token, so a holder that had its stale lock reclaimed by someone
   * else never deletes the reclaimer's replacement lock out from under it.
   * Reclamation itself is age-based (`LOCK_STALE_MS`, generous relative to
   * a local JSON-file write) and exists only for the safe-restart-overlap
   * case — a crashed process's lock must not wedge every future writer
   * forever.
   */
  private async mutate(fn: (objectives: Map<string, Objective>) => boolean | void): Promise<void> {
    const run = this.writeChain.then(async () => {
      // Resolved once, unlocked, purely to learn where the lock file lives.
      // Re-resolved (see below) once the lock is held, so this pre-lock
      // resolution is not relied on for the actual read/write. Residual
      // TOCTOU: if the .boring directory is swapped by a symlink in the
      // narrow gap between this resolve and acquireLock() below, two
      // concurrent mutations could in principle key their locks off
      // different resolved directories and fail to serialize against each
      // other for that one race. Closing that fully would require locking
      // on something that predates any possible swap (e.g. an already-open
      // directory handle), which this plain JSON-file store does not
      // attempt — documented here rather than silently assumed away.
      const preLockPath = await this.resolveFilePath()
      const lockPath = `${preLockPath}.lock`
      const token = randomUUID()

      if (!(await this.acquireLock(lockPath, token))) {
        throw new ObjectiveStoreError(
          OBJECTIVE_ERROR_CODES.LOCK_TIMEOUT,
          `timed out waiting for the objective store write lock at ${lockPath}`,
        )
      }
      try {
        // Re-resolve now that the lock is held: this re-runs both the
        // directory containment check and the final-file symlink check
        // against the current filesystem state, narrowing (not
        // eliminating — see above) the gap between "path verified safe"
        // and "path actually read/written" to the inside of the lock.
        const filePath = await this.resolveFilePath()
        const before = await this.readOnDiskAt(filePath)
        const draft = new Map(before.objectives)
        const shouldWrite = fn(draft) !== false
        if (!shouldWrite) return

        // Recheck happens inside the lock: no other writer can advance the
        // revision between this read and the commit below.
        const recheck = await this.readOnDiskAt(filePath)
        if (recheck.revision !== before.revision) {
          throw new ObjectiveStoreError(
            OBJECTIVE_ERROR_CODES.REVISION_CONFLICT,
            `objective store was modified concurrently (expected revision ${before.revision}, found ${recheck.revision}); retry`,
          )
        }

        const nextState: OnDiskState = {
          version: 1,
          revision: before.revision + 1,
          objectives: [...draft.values()],
        }
        await this.commit(filePath, nextState)
      } finally {
        await this.releaseLock(lockPath, token)
      }
    })
    this.writeChain = run.catch(() => undefined)
    return run
  }

  private async acquireLock(lockPath: string, token: string): Promise<boolean> {
    const deadline = Date.now() + LOCK_ACQUIRE_TIMEOUT_MS
    for (;;) {
      try {
        const handle = await open(lockPath, "wx")
        try {
          await handle.writeFile(JSON.stringify({ pid: process.pid, token, timestamp: Date.now() }), "utf8")
        } finally {
          await handle.close()
        }
        return true
      } catch (error) {
        if ((error as { code?: string }).code !== "EEXIST") throw error
        if (await this.reclaimIfStale(lockPath)) continue
        if (Date.now() >= deadline) return false
        await delay(LOCK_POLL_INTERVAL_MS)
      }
    }
  }

  /**
   * Reclaim a lock only if it has clearly outlived any real write
   * (`LOCK_STALE_MS`) — this is the "safe restart overlap" escape hatch for
   * a holder that crashed without releasing its lock, not a general
   * fairness mechanism. A live holder never legitimately holds this long
   * for a local JSON-file write.
   */
  private async reclaimIfStale(lockPath: string): Promise<boolean> {
    try {
      const raw = await readFile(lockPath, "utf8")
      const info = JSON.parse(raw) as Partial<{ timestamp: number }>
      if (typeof info.timestamp === "number" && Date.now() - info.timestamp > LOCK_STALE_MS) {
        await rm(lockPath, { force: true })
        return true
      }
    } catch {
      // Lock file disappeared or is unreadable mid-race; the next
      // acquire attempt re-checks from scratch rather than assuming
      // either outcome.
    }
    return false
  }

  /** Delete the lock file only if it still holds our own token. */
  private async releaseLock(lockPath: string, token: string): Promise<void> {
    try {
      const raw = await readFile(lockPath, "utf8")
      const info = JSON.parse(raw) as Partial<{ token: string }>
      if (info.token !== token) return
      await rm(lockPath, { force: true })
    } catch {
      // Already gone.
    }
  }

  private async readState(): Promise<LoadedState> {
    const filePath = await this.resolveFilePath()
    return this.readOnDiskAt(filePath)
  }

  private async resolveFilePath(): Promise<string> {
    const dir = this.options.workspaceRoot
      ? await ensureContainedDir(this.options.workspaceRoot, this.dir)
      : await this.ensurePlainDir()
    const filePath = join(dir, this.fileName)
    // ensureContainedDir only verifies the directory; the store file itself
    // is one path segment deeper and could independently be replaced with a
    // symlink escaping the workspace. Checked unconditionally (not gated on
    // workspaceRoot) as defense in depth for the plain-dir case too.
    await assertFileNotSymlink(filePath)
    return filePath
  }

  private async ensurePlainDir(): Promise<string> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 })
    return this.dir
  }

  private async readOnDiskAt(filePath: string): Promise<LoadedState> {
    let raw: string
    try {
      raw = await readFile(filePath, "utf8")
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") throw error
      this.diagnostics = []
      return { revision: 0, objectives: new Map() }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      this.diagnostics = [{ index: -1, reason: "objective store file is not valid JSON; starting from an empty store" }]
      return { revision: 0, objectives: new Map() }
    }

    return this.parseOnDisk(parsed)
  }

  private parseOnDisk(parsed: unknown): LoadedState {
    const diagnostics: ObjectiveLoadDiagnostic[] = []
    const { revision, rawObjectives } = normalizeOnDiskShape(parsed, diagnostics)

    const objectives = new Map<string, Objective>()
    rawObjectives.forEach((rawObjective, index) => {
      const result = ObjectiveSchema.safeParse(rawObjective)
      if (!result.success) {
        diagnostics.push({ index, reason: result.error.issues[0]?.message ?? "invalid objective record" })
        return
      }
      objectives.set(result.data.id, result.data as Objective)
    })

    this.diagnostics = diagnostics
    return { revision, objectives }
  }

  private async commit(filePath: string, state: OnDiskState): Promise<void> {
    const dir = dirname(filePath)
    const tmp = join(dir, `.${randomUUID()}.tmp`)
    await writeFile(tmp, JSON.stringify(state, null, 2), "utf8")
    await rename(tmp, filePath)
  }
}

function normalizeOnDiskShape(
  parsed: unknown,
  diagnostics: ObjectiveLoadDiagnostic[],
): { revision: number; rawObjectives: unknown[] } {
  const versioned = StoredObjectiveStateSchema.safeParse(parsed)
  if (versioned.success) {
    return { revision: versioned.data.revision, rawObjectives: versioned.data.objectives }
  }

  // Legacy shape: `{ objectives: Record<string, Objective> }` with no version/revision field.
  // Object.entries only enumerates own enumerable properties, so this is safe even against a
  // literal "__proto__" key (JSON.parse defines it as a plain own property, not a prototype link).
  if (isPlainObject(parsed) && isPlainObject(parsed.objectives)) {
    const legacyRecord = parsed.objectives as Record<string, unknown>
    const rawObjectives = Object.entries(legacyRecord).map(([, value]) => value)
    diagnostics.push({ index: -1, reason: "migrated legacy unversioned objective store file" })
    return { revision: 0, rawObjectives }
  }

  diagnostics.push({ index: -1, reason: "unrecognized objective store file shape; starting from an empty store" })
  return { revision: 0, rawObjectives: [] }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function generateObjectiveId(): string {
  return `obj-${randomUUID()}`
}

function nowIso(): string {
  return new Date().toISOString()
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

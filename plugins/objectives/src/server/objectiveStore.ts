import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
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
   * Reread-before-mutate + revision CAS: every mutation loads the current
   * on-disk state fresh (never a cached copy), applies `fn` to a draft, and
   * — immediately before committing — re-reads the file to confirm no other
   * writer advanced the revision in the meantime. A mismatch means another
   * writer committed first; this mutation refuses to clobber it and fails
   * loudly instead (last-writer-loses with an error, not a silent
   * overwrite). Persistence happens via a cloned draft written to disk
   * first; there is no in-memory cache for `list`/`get` to observe ahead of
   * a successful commit, so a failed write leaves nothing observable.
   */
  private async mutate(fn: (objectives: Map<string, Objective>) => boolean | void): Promise<void> {
    const run = this.writeChain.then(async () => {
      const filePath = await this.resolveFilePath()
      const before = await this.readOnDiskAt(filePath)
      const draft = new Map(before.objectives)
      const shouldWrite = fn(draft) !== false
      if (!shouldWrite) return

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
    })
    this.writeChain = run.catch(() => undefined)
    return run
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

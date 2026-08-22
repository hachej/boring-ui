import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"
import { OBJECTIVE_ERROR_CODES } from "../shared/error-codes"
import type { CreateObjectiveInput, Objective, ObjectiveStatus, UpdateObjectiveInput } from "../shared/types"

export class ObjectiveStoreError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export type ObjectiveStoreChange = {
  objectiveId: string
  reason: "create" | "update"
}

export type ObjectiveStoreListener = (change: ObjectiveStoreChange) => void

export interface ObjectiveStore {
  list(status?: ObjectiveStatus): Promise<Objective[]>
  get(id: string): Promise<Objective | null>
  create(input: CreateObjectiveInput): Promise<Objective>
  update(input: UpdateObjectiveInput): Promise<Objective>
  subscribe(listener: ObjectiveStoreListener): () => void
}

type StoredObjectiveState = {
  objectives: Record<string, Objective>
}

const EMPTY_STATE: StoredObjectiveState = { objectives: {} }

export class FileObjectiveStore implements ObjectiveStore {
  private state: StoredObjectiveState | null = null
  private loadInFlight: Promise<StoredObjectiveState> | null = null
  private writeChain = Promise.resolve()
  private readonly listeners = new Set<ObjectiveStoreListener>()

  constructor(private readonly filePath: string) {}

  async list(status?: ObjectiveStatus): Promise<Objective[]> {
    const state = await this.load()
    const objectives = Object.values(state.objectives)
      .filter((objective) => !status || objective.status === status)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    return objectives.map(clone)
  }

  async get(id: string): Promise<Objective | null> {
    const state = await this.load()
    const objective = state.objectives[id]
    return objective ? clone(objective) : null
  }

  async create(input: CreateObjectiveInput): Promise<Objective> {
    let created: Objective | undefined
    await this.mutate(async (state) => {
      const now = nowIso()
      const objective: Objective = {
        id: `obj_${randomUUID()}`,
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
        createdAt: now,
        updatedAt: now,
      }
      state.objectives[objective.id] = objective
      created = clone(objective)
      this.emit({ objectiveId: objective.id, reason: "create" })
    })
    return created!
  }

  async update(input: UpdateObjectiveInput): Promise<Objective> {
    let updated: Objective | undefined
    await this.mutate(async (state) => {
      const existing = state.objectives[input.id]
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
      state.objectives[next.id] = next
      updated = clone(next)
      this.emit({ objectiveId: next.id, reason: "update" })
    })
    return updated!
  }

  subscribe(listener: ObjectiveStoreListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private async mutate(fn: (state: StoredObjectiveState) => Promise<void> | void): Promise<void> {
    const run = this.writeChain.then(async () => {
      const state = await this.load()
      await fn(state)
      await this.save(state)
    })
    this.writeChain = run.catch(() => undefined)
    return run
  }

  private async load(): Promise<StoredObjectiveState> {
    if (this.state) return this.state
    if (!this.loadInFlight) {
      this.loadInFlight = (async () => {
        try {
          const raw = await readFile(this.filePath, "utf8")
          this.state = { ...clone(EMPTY_STATE), ...JSON.parse(raw) }
        } catch (error) {
          if ((error as { code?: string }).code !== "ENOENT") throw error
          this.state = clone(EMPTY_STATE)
        }
        return this.state as StoredObjectiveState
      })().finally(() => {
        this.loadInFlight = null
      })
    }
    return this.loadInFlight
  }

  private async save(state: StoredObjectiveState): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const tmp = join(dirname(this.filePath), `.${randomUUID()}.tmp`)
    await writeFile(tmp, JSON.stringify(state, null, 2), "utf8")
    await rename(tmp, this.filePath)
  }

  private emit(change: ObjectiveStoreChange): void {
    for (const listener of this.listeners) {
      try {
        const result = listener(change) as unknown
        if (isPromiseLike(result)) result.catch(() => undefined)
      } catch {
        // Store mutations must not be rolled back because an observer failed.
      }
    }
  }
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return !!value && typeof value === "object" && "catch" in value && typeof value.catch === "function"
}

function nowIso(): string {
  return new Date().toISOString()
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

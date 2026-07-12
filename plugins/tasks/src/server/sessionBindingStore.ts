import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { BoringTaskSessionBinding } from "../shared"

export interface TaskSessionBindingCreateInput {
  workspaceId: string
  adapterId: string
  taskId: string
  sessionId: string
  title?: string
}

export interface TaskSessionBindingListInput {
  workspaceId: string
  adapterId: string
  taskId: string
}

export interface TaskSessionBindingDeleteInput {
  workspaceId: string
  bindingId: string
}

export interface TaskSessionBindingStore {
  listBindings(input: TaskSessionBindingListInput): Promise<BoringTaskSessionBinding[]>
  createBinding(input: TaskSessionBindingCreateInput): Promise<BoringTaskSessionBinding>
  deleteBinding(input: TaskSessionBindingDeleteInput): Promise<void>
}

export class TaskSessionBindingStoreError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = "TaskSessionBindingStoreError"
  }
}

export function taskSessionBindingNotFound(id: string): TaskSessionBindingStoreError {
  return new TaskSessionBindingStoreError(404, "TASK_SESSION_BINDING_NOT_FOUND", `Task session binding not found: ${id}`)
}

type StoredTaskSessionBindingState = {
  bindings: Record<string, BoringTaskSessionBinding>
}

type AtomicWriter = (path: string, content: string) => Promise<void>

export interface FileTaskSessionBindingStoreOptions {
  writer?: AtomicWriter
  clock?: () => Date
}

const EMPTY_STATE: StoredTaskSessionBindingState = { bindings: {} }

export class FileTaskSessionBindingStore implements TaskSessionBindingStore {
  private state: StoredTaskSessionBindingState | null = null
  private loadInFlight: Promise<StoredTaskSessionBindingState> | null = null
  private writeChain = Promise.resolve()
  private readonly writer: AtomicWriter
  private readonly clock: () => Date

  constructor(
    private readonly rootDir: string,
    options: FileTaskSessionBindingStoreOptions = {},
  ) {
    this.writer = options.writer ?? writeAtomic
    this.clock = options.clock ?? (() => new Date())
  }

  async listBindings(input: TaskSessionBindingListInput): Promise<BoringTaskSessionBinding[]> {
    const state = await this.load()
    return Object.values(state.bindings)
      .filter((binding) => binding.workspaceId === input.workspaceId && binding.adapterId === input.adapterId && binding.taskId === input.taskId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(clone)
  }

  async createBinding(input: TaskSessionBindingCreateInput): Promise<BoringTaskSessionBinding> {
    let binding: BoringTaskSessionBinding | undefined
    await this.mutate((state) => {
      const existing = Object.values(state.bindings).find((candidate) => sameTuple(candidate, input))
      if (existing) {
        binding = existing
        return
      }
      binding = {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        adapterId: input.adapterId,
        taskId: input.taskId,
        sessionId: input.sessionId,
        ...(input.title ? { title: input.title } : {}),
        createdAt: this.clock().toISOString(),
      }
      state.bindings[binding.id] = clone(binding)
    })
    return clone(requireValue(binding))
  }

  async deleteBinding(input: TaskSessionBindingDeleteInput): Promise<void> {
    await this.mutate((state) => {
      const binding = state.bindings[input.bindingId]
      if (!binding || binding.workspaceId !== input.workspaceId) throw taskSessionBindingNotFound(input.bindingId)
      delete state.bindings[input.bindingId]
    })
  }

  private statePath(): string {
    return join(this.rootDir, "session-links.json")
  }

  private async mutate(fn: (state: StoredTaskSessionBindingState) => Promise<void> | void): Promise<void> {
    const run = this.writeChain.then(async () => {
      const state = clone(await this.load())
      await fn(state)
      await this.writer(this.statePath(), `${JSON.stringify(state, null, 2)}\n`)
      this.state = state
    })
    this.writeChain = run.catch(() => undefined)
    return run
  }

  private async load(): Promise<StoredTaskSessionBindingState> {
    if (this.state) return this.state
    if (!this.loadInFlight) {
      this.loadInFlight = (async () => {
        try {
          const raw = await readFile(this.statePath(), "utf8")
          const parsed = JSON.parse(raw) as Partial<StoredTaskSessionBindingState>
          this.state = {
            bindings: parsed.bindings && typeof parsed.bindings === "object" ? parsed.bindings : {},
          }
        } catch (error) {
          if ((error as { code?: string }).code !== "ENOENT") throw error
          this.state = clone(EMPTY_STATE)
        }
        return this.state
      })().finally(() => {
        this.loadInFlight = null
      })
    }
    return this.loadInFlight
  }
}

function sameTuple(binding: BoringTaskSessionBinding, input: TaskSessionBindingCreateInput): boolean {
  return binding.workspaceId === input.workspaceId
    && binding.adapterId === input.adapterId
    && binding.taskId === input.taskId
    && binding.sessionId === input.sessionId
}

async function writeAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = join(dirname(path), `.${randomUUID()}.tmp`)
  await writeFile(tmp, content, "utf8")
  await rename(tmp, path)
}

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected task session binding store mutation to produce a value")
  return value
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

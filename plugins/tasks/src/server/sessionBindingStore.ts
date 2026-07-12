import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import lockfile from "proper-lockfile"
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

type StoredTaskSessionBindingState = { bindings: Record<string, BoringTaskSessionBinding> }
type AtomicWriter = (path: string, content: string) => Promise<void>

export interface FileTaskSessionBindingStoreOptions {
  writer?: AtomicWriter
  clock?: () => Date
}

const EMPTY_STATE: StoredTaskSessionBindingState = { bindings: {} }
const mutationQueues = new Map<string, Promise<void>>()

export class FileTaskSessionBindingStore implements TaskSessionBindingStore {
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
    const state = await this.readState()
    return Object.values(state.bindings)
      .filter((binding) => binding.workspaceId === input.workspaceId && binding.adapterId === input.adapterId && binding.taskId === input.taskId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(clone)
  }

  async createBinding(input: TaskSessionBindingCreateInput): Promise<BoringTaskSessionBinding> {
    return await this.mutate((state) => {
      const existing = Object.values(state.bindings).find((candidate) => sameTuple(candidate, input))
      if (existing) return clone(existing)
      const binding: BoringTaskSessionBinding = {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        adapterId: input.adapterId,
        taskId: input.taskId,
        sessionId: input.sessionId,
        ...(input.title ? { title: input.title } : {}),
        createdAt: this.clock().toISOString(),
      }
      state.bindings[binding.id] = clone(binding)
      return binding
    })
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

  private async mutate<T>(operation: (state: StoredTaskSessionBindingState) => T): Promise<T> {
    return await withMutationLock(this.rootDir, async () => {
      // Always re-read after obtaining the filesystem lock. A different process
      // may have committed a binding since this store last read the file.
      const state = await this.readState()
      const result = operation(state)
      await this.writer(this.statePath(), `${JSON.stringify(state, null, 2)}\n`)
      return result === undefined ? result : clone(result)
    })
  }

  private async readState(): Promise<StoredTaskSessionBindingState> {
    try {
      const raw = await readFile(this.statePath(), "utf8")
      const parsed = JSON.parse(raw) as Partial<StoredTaskSessionBindingState>
      return {
        bindings: parsed.bindings && typeof parsed.bindings === "object" ? clone(parsed.bindings) : {},
      }
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") throw error
      return clone(EMPTY_STATE)
    }
  }
}

async function withMutationLock<T>(rootDir: string, operation: () => Promise<T>): Promise<T> {
  const previous = mutationQueues.get(rootDir) ?? Promise.resolve()
  let releaseQueue!: () => void
  const current = new Promise<void>((resolve) => { releaseQueue = resolve })
  const queued = previous.then(() => current)
  mutationQueues.set(rootDir, queued)
  await previous
  let releaseFilesystemLock: (() => Promise<void>) | undefined
  try {
    await mkdir(rootDir, { recursive: true, mode: 0o700 })
    releaseFilesystemLock = await lockfile.lock(rootDir, {
      lockfilePath: join(rootDir, "session-links.lock"),
      realpath: false,
      stale: 30_000,
      update: 5_000,
      retries: { retries: 100, minTimeout: 25, maxTimeout: 100 },
    })
    return await operation()
  } finally {
    await releaseFilesystemLock?.().catch(() => {})
    releaseQueue()
    if (mutationQueues.get(rootDir) === queued) mutationQueues.delete(rootDir)
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

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

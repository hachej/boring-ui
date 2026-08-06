import { TASK_ERROR_CODES } from "../shared"
import { randomUUID } from "node:crypto"
import type { BoringTaskSessionLink } from "../shared"

export interface TaskSessionLinkWorkspace {
  readonly root: string
  readFile(path: string): Promise<string>
  writeFile(path: string, data: string): Promise<void>
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
  rename(from: string, to: string): Promise<void>
  /** Best-effort temp cleanup. Full Workspace implementations provide this. */
  unlink?(path: string): Promise<void>
}

export interface TaskSessionLinkSnapshot {
  adapterId: string
  taskId: string
  links: BoringTaskSessionLink[]
}

export interface TaskSessionLinkStore {
  list(adapterId: string, taskId: string): Promise<BoringTaskSessionLink[]>
  listBySessionIds(sessionIds: readonly string[]): Promise<Map<string, BoringTaskSessionLink[]>>
  link(input: { adapterId: string; taskId: string; agentTypeId: string; sessionId: string }): Promise<BoringTaskSessionLink>
  unlink(linkId: string, expectedAgentTypeId?: string): Promise<BoringTaskSessionLink>
}

export interface AtomicTaskSessionLinkStore extends TaskSessionLinkStore {
  snapshotLinks(): Promise<TaskSessionLinkSnapshot[]>
  linkWithSnapshot(input: { adapterId: string; taskId: string; agentTypeId: string; sessionId: string }): Promise<{ link: BoringTaskSessionLink; links: BoringTaskSessionLink[]; created: boolean }>
  unlinkWithSnapshot(linkId: string, expectedAgentTypeId?: string): Promise<{ link: BoringTaskSessionLink; links: BoringTaskSessionLink[] }>
}

const STORE_PATH = ".pi/tasks/session-links.json"
const STORE_DIR = ".pi/tasks"
const MAX_ID_BYTES = 512
const MAX_CREATED_AT_BYTES = 64
const MAX_LINKS = 10_000
const MAX_STORE_BYTES = 4 * 1024 * 1024
const encoder = new TextEncoder()

interface StoredLinks { version: 1; links: BoringTaskSessionLink[] }

export type TaskSessionLinkStoreErrorCode =
  | typeof TASK_ERROR_CODES.SESSION_INVALID_BODY
  | typeof TASK_ERROR_CODES.SESSION_LINK_MISSING
  | typeof TASK_ERROR_CODES.SESSION_LINK_STORE_INVALID
  | typeof TASK_ERROR_CODES.SESSION_LINK_STORE_ERROR

export class TaskSessionLinkStoreError extends Error {
  constructor(readonly code: TaskSessionLinkStoreErrorCode, message: string) {
    super(message)
    this.name = "TaskSessionLinkStoreError"
  }
}

function isMissing(error: unknown): boolean {
  return (error as { code?: unknown })?.code === TASK_ERROR_CODES.WORKSPACE_FILE_MISSING
}

function validateId(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized || encoder.encode(normalized).byteLength > MAX_ID_BYTES) {
    throw new TaskSessionLinkStoreError(
      TASK_ERROR_CODES.SESSION_INVALID_BODY,
      `${label} must be a non-empty string of at most ${MAX_ID_BYTES} UTF-8 bytes.`,
    )
  }
  return normalized
}

function validateStoredLink(value: unknown): value is BoringTaskSessionLink {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const link = value as Record<string, unknown>
  const keys = ["id", "adapterId", "taskId", "agentTypeId", "sessionId", "createdAt"] as const
  if (Object.keys(link).length !== keys.length || !keys.every((key) => typeof link[key] === "string" && (link[key] as string).length > 0)) return false
  return ["id", "adapterId", "taskId", "agentTypeId", "sessionId"].every((key) => encoder.encode(link[key] as string).byteLength <= MAX_ID_BYTES)
    && encoder.encode(link.createdAt as string).byteLength <= MAX_CREATED_AT_BYTES
    && !Number.isNaN(Date.parse(link.createdAt as string))
}

function parseStore(raw: string): StoredLinks {
  try {
    if (encoder.encode(raw).byteLength > MAX_STORE_BYTES) throw new Error()
    const value = JSON.parse(raw) as Partial<StoredLinks>
    if (value.version !== 1 || !Array.isArray(value.links) || value.links.length > MAX_LINKS || !value.links.every(validateStoredLink)) throw new Error()
    return value as StoredLinks
  } catch {
    throw new TaskSessionLinkStoreError(TASK_ERROR_CODES.SESSION_LINK_STORE_INVALID, "Task session link store is invalid.")
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function compareLinks(left: BoringTaskSessionLink, right: BoringTaskSessionLink): number {
  return compareText(left.adapterId, right.adapterId)
    || compareText(left.taskId, right.taskId)
    || compareText(left.createdAt, right.createdAt)
    || compareText(left.agentTypeId, right.agentTypeId)
    || compareText(left.sessionId, right.sessionId)
    || compareText(left.id, right.id)
}

interface WorkspaceWriterQueue { pending: Promise<unknown> }
const writerQueuesByWorkspaceRoot = new Map<string, WorkspaceWriterQueue>()

function writerQueueFor(workspaceRoot: string): WorkspaceWriterQueue {
  const existing = writerQueuesByWorkspaceRoot.get(workspaceRoot)
  if (existing) return existing
  const queue = { pending: Promise.resolve() }
  writerQueuesByWorkspaceRoot.set(workspaceRoot, queue)
  return queue
}

/** Lease-local Workspace proxies share one capability-free writer queue by stable root identity. */
export function taskSessionLinkStoreForWorkspace(workspace: TaskSessionLinkWorkspace): FileTaskSessionLinkStore {
  return new FileTaskSessionLinkStore(workspace)
}

export class FileTaskSessionLinkStore implements AtomicTaskSessionLinkStore {
  constructor(private readonly workspace: TaskSessionLinkWorkspace) {}

  private async awaitPendingWrites(): Promise<void> {
    const queue = writerQueueFor(this.workspace.root)
    const pending = queue.pending
    await pending.catch(() => {})
    if (writerQueuesByWorkspaceRoot.get(this.workspace.root) === queue && queue.pending === pending) {
      writerQueuesByWorkspaceRoot.delete(this.workspace.root)
    }
  }

  async list(adapterId: string, taskId: string): Promise<BoringTaskSessionLink[]> {
    const normalizedAdapterId = validateId(adapterId, "adapterId")
    const normalizedTaskId = validateId(taskId, "taskId")
    await this.awaitPendingWrites()
    const store = await this.read()
    return store.links
      .filter((link) => link.adapterId === normalizedAdapterId && link.taskId === normalizedTaskId)
      .sort(compareLinks)
  }

  async listBySessionIds(sessionIds: readonly string[]): Promise<Map<string, BoringTaskSessionLink[]>> {
    const normalizedIds = sessionIds.map((sessionId) => validateId(sessionId, "sessionId"))
    await this.awaitPendingWrites()
    const store = await this.read()
    const requested = new Set(normalizedIds)
    const grouped = new Map(normalizedIds.map((sessionId) => [sessionId, [] as BoringTaskSessionLink[]]))
    for (const link of [...store.links].sort(compareLinks)) {
      if (requested.has(link.sessionId)) grouped.get(link.sessionId)?.push(link)
    }
    return grouped
  }

  async snapshotLinks(): Promise<TaskSessionLinkSnapshot[]> {
    await this.awaitPendingWrites()
    const store = await this.read()
    const snapshots = new Map<string, TaskSessionLinkSnapshot>()
    for (const link of [...store.links].sort(compareLinks)) {
      const key = JSON.stringify([link.adapterId, link.taskId])
      const current = snapshots.get(key)
      if (current) current.links.push(link)
      else snapshots.set(key, { adapterId: link.adapterId, taskId: link.taskId, links: [link] })
    }
    return [...snapshots.values()].sort((left, right) => (
      compareText(left.adapterId, right.adapterId) || compareText(left.taskId, right.taskId)
    ))
  }

  async link(input: { adapterId: string; taskId: string; agentTypeId: string; sessionId: string }): Promise<BoringTaskSessionLink> {
    return (await this.linkWithSnapshot(input)).link
  }

  async linkWithSnapshot(input: { adapterId: string; taskId: string; agentTypeId: string; sessionId: string }): Promise<{ link: BoringTaskSessionLink; links: BoringTaskSessionLink[]; created: boolean }> {
    const normalized = {
      adapterId: validateId(input.adapterId, "adapterId"),
      taskId: validateId(input.taskId, "taskId"),
      agentTypeId: validateId(input.agentTypeId, "agentTypeId"),
      sessionId: validateId(input.sessionId, "sessionId"),
    }
    return await this.mutate(async (store) => {
      const taskLinks = () => store.links.filter((link) => link.adapterId === normalized.adapterId && link.taskId === normalized.taskId)
      const existing = taskLinks().find((link) => link.agentTypeId === normalized.agentTypeId && link.sessionId === normalized.sessionId)
      if (existing) return { link: existing, links: taskLinks().sort(compareLinks), created: false }
      if (store.links.length >= MAX_LINKS) {
        throw new TaskSessionLinkStoreError(TASK_ERROR_CODES.SESSION_LINK_STORE_ERROR, "Task session link store is at capacity.")
      }
      const link: BoringTaskSessionLink = { id: randomUUID(), ...normalized, createdAt: new Date().toISOString() }
      store.links.push(link)
      await this.write(store)
      return { link, links: taskLinks().sort(compareLinks), created: true }
    })
  }

  async unlink(linkId: string, expectedAgentTypeId?: string): Promise<BoringTaskSessionLink> {
    return (await this.unlinkWithSnapshot(linkId, expectedAgentTypeId)).link
  }

  async unlinkWithSnapshot(linkId: string, expectedAgentTypeId?: string): Promise<{ link: BoringTaskSessionLink; links: BoringTaskSessionLink[] }> {
    const normalizedLinkId = validateId(linkId, "linkId")
    const normalizedExpectedAgentTypeId = expectedAgentTypeId === undefined ? undefined : validateId(expectedAgentTypeId, "agentTypeId")
    return await this.mutate(async (store) => {
      const index = store.links.findIndex((link) => link.id === normalizedLinkId && (normalizedExpectedAgentTypeId === undefined || link.agentTypeId === normalizedExpectedAgentTypeId))
      if (index < 0) throw new TaskSessionLinkStoreError(TASK_ERROR_CODES.SESSION_LINK_MISSING, "Task session link was not found.")
      const [link] = store.links.splice(index, 1)
      await this.write(store)
      const links = store.links
        .filter((candidate) => candidate.adapterId === link!.adapterId && candidate.taskId === link!.taskId)
        .sort(compareLinks)
      return { link: link!, links }
    })
  }

  private mutate<T>(operation: (store: StoredLinks) => Promise<T>): Promise<T> {
    const queue = writerQueueFor(this.workspace.root)
    const result = queue.pending.then(async () => operation(await this.read()))
    const settled = result.then(() => undefined, () => undefined)
    queue.pending = settled
    void settled.then(() => {
      if (writerQueuesByWorkspaceRoot.get(this.workspace.root) === queue && queue.pending === settled) {
        writerQueuesByWorkspaceRoot.delete(this.workspace.root)
      }
    })
    return result
  }

  private async read(): Promise<StoredLinks> {
    let raw: string
    try {
      raw = await this.workspace.readFile(STORE_PATH)
    } catch (error) {
      if (isMissing(error)) return { version: 1, links: [] }
      throw new TaskSessionLinkStoreError(TASK_ERROR_CODES.SESSION_LINK_STORE_ERROR, "Task session link store could not be read.")
    }
    return parseStore(raw)
  }

  private async write(store: StoredLinks): Promise<void> {
    const serialized = `${JSON.stringify({ ...store, links: [...store.links].sort(compareLinks) }, null, 2)}\n`
    if (encoder.encode(serialized).byteLength > MAX_STORE_BYTES) {
      throw new TaskSessionLinkStoreError(TASK_ERROR_CODES.SESSION_LINK_STORE_ERROR, "Task session link store is at capacity.")
    }
    const temporary = `${STORE_PATH}.tmp-${randomUUID()}`
    try {
      await this.workspace.mkdir(STORE_DIR, { recursive: true })
      await this.workspace.writeFile(temporary, serialized)
      await this.workspace.rename(temporary, STORE_PATH)
    } catch (error) {
      if (this.workspace.unlink) await this.workspace.unlink(temporary).catch(() => {})
      if (error instanceof TaskSessionLinkStoreError) throw error
      throw new TaskSessionLinkStoreError(TASK_ERROR_CODES.SESSION_LINK_STORE_ERROR, "Task session link store could not be written.")
    }
  }
}

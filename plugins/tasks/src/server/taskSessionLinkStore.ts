import { TASK_ERROR_CODES } from "../shared"
import { randomUUID } from "node:crypto"
import type { BoringTaskSessionLink } from "../shared"

export interface TaskSessionLinkWorkspace {
  readFile(path: string): Promise<string>
  writeFile(path: string, data: string): Promise<void>
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
  rename(from: string, to: string): Promise<void>
  /** Best-effort temp cleanup. Full Workspace implementations provide this. */
  unlink?(path: string): Promise<void>
}

export interface TaskSessionLinkStore {
  list(adapterId: string, taskId: string): Promise<BoringTaskSessionLink[]>
  listBySessionIds(sessionIds: readonly string[]): Promise<Map<string, BoringTaskSessionLink[]>>
  link(input: { adapterId: string; taskId: string; sessionId: string }): Promise<BoringTaskSessionLink>
  unlink(linkId: string): Promise<BoringTaskSessionLink>
}

const STORE_PATH = ".pi/tasks/session-links.json"
const STORE_DIR = ".pi/tasks"
const MAX_ID_BYTES = 512
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
  const keys = ["id", "adapterId", "taskId", "sessionId", "createdAt"] as const
  if (Object.keys(link).length !== keys.length || !keys.every((key) => typeof link[key] === "string" && (link[key] as string).length > 0)) return false
  return ["id", "adapterId", "taskId", "sessionId"].every((key) => encoder.encode(link[key] as string).byteLength <= MAX_ID_BYTES)
    && !Number.isNaN(Date.parse(link.createdAt as string))
}

function parseStore(raw: string): StoredLinks {
  try {
    const value = JSON.parse(raw) as Partial<StoredLinks>
    if (value.version !== 1 || !Array.isArray(value.links) || !value.links.every(validateStoredLink)) throw new Error()
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
    || compareText(left.sessionId, right.sessionId)
    || compareText(left.id, right.id)
}

export class FileTaskSessionLinkStore implements TaskSessionLinkStore {
  private pending: Promise<unknown> = Promise.resolve()

  constructor(private readonly workspace: TaskSessionLinkWorkspace) {}

  async list(adapterId: string, taskId: string): Promise<BoringTaskSessionLink[]> {
    const normalizedAdapterId = validateId(adapterId, "adapterId")
    const normalizedTaskId = validateId(taskId, "taskId")
    await this.pending.catch(() => {})
    const store = await this.read()
    return store.links
      .filter((link) => link.adapterId === normalizedAdapterId && link.taskId === normalizedTaskId)
      .sort(compareLinks)
  }

  async listBySessionIds(sessionIds: readonly string[]): Promise<Map<string, BoringTaskSessionLink[]>> {
    const normalizedIds = sessionIds.map((sessionId) => validateId(sessionId, "sessionId"))
    await this.pending.catch(() => {})
    const store = await this.read()
    const requested = new Set(normalizedIds)
    const grouped = new Map(normalizedIds.map((sessionId) => [sessionId, [] as BoringTaskSessionLink[]]))
    for (const link of [...store.links].sort(compareLinks)) {
      if (requested.has(link.sessionId)) grouped.get(link.sessionId)?.push(link)
    }
    return grouped
  }

  async link(input: { adapterId: string; taskId: string; sessionId: string }): Promise<BoringTaskSessionLink> {
    const normalized = {
      adapterId: validateId(input.adapterId, "adapterId"),
      taskId: validateId(input.taskId, "taskId"),
      sessionId: validateId(input.sessionId, "sessionId"),
    }
    return await this.mutate(async (store) => {
      const existing = store.links.find((link) => link.adapterId === normalized.adapterId && link.taskId === normalized.taskId && link.sessionId === normalized.sessionId)
      if (existing) return existing
      const link: BoringTaskSessionLink = { id: randomUUID(), ...normalized, createdAt: new Date().toISOString() }
      store.links.push(link)
      await this.write(store)
      return link
    })
  }

  async unlink(linkId: string): Promise<BoringTaskSessionLink> {
    const normalizedLinkId = validateId(linkId, "linkId")
    return await this.mutate(async (store) => {
      const index = store.links.findIndex((link) => link.id === normalizedLinkId)
      if (index < 0) throw new TaskSessionLinkStoreError(TASK_ERROR_CODES.SESSION_LINK_MISSING, "Task session link was not found.")
      const [removed] = store.links.splice(index, 1)
      await this.write(store)
      return removed!
    })
  }

  private mutate<T>(operation: (store: StoredLinks) => Promise<T>): Promise<T> {
    const result = this.pending.then(async () => operation(await this.read()))
    this.pending = result.then(() => undefined, () => undefined)
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
    const temporary = `${STORE_PATH}.tmp-${randomUUID()}`
    try {
      await this.workspace.mkdir(STORE_DIR, { recursive: true })
      await this.workspace.writeFile(temporary, `${JSON.stringify({ ...store, links: [...store.links].sort(compareLinks) }, null, 2)}\n`)
      await this.workspace.rename(temporary, STORE_PATH)
    } catch (error) {
      if (this.workspace.unlink) await this.workspace.unlink(temporary).catch(() => {})
      if (error instanceof TaskSessionLinkStoreError) throw error
      throw new TaskSessionLinkStoreError(TASK_ERROR_CODES.SESSION_LINK_STORE_ERROR, "Task session link store could not be written.")
    }
  }
}

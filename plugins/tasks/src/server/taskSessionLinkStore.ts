import { randomUUID } from "node:crypto"
import type { BoringTaskSessionLink } from "../shared"

export interface TaskSessionLinkWorkspace {
  readFile(path: string): Promise<string>
  writeFile(path: string, data: string): Promise<void>
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
  rename(from: string, to: string): Promise<void>
}

const STORE_PATH = ".pi/tasks/session-links.json"
const STORE_DIR = ".pi/tasks"

interface StoredLinks { version: 1; links: BoringTaskSessionLink[] }

export class TaskSessionLinkStoreError extends Error {
  constructor(readonly code: "TASK_SESSION_LINK_MISSING" | "TASK_SESSION_LINK_STORE_INVALID", message: string) {
    super(message)
  }
}

function isMissing(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown }
  return candidate?.code === "ENOENT" || (typeof candidate?.message === "string" && /not found|no such file/i.test(candidate.message))
}

function parseStore(raw: string): StoredLinks {
  try {
    const value = JSON.parse(raw) as Partial<StoredLinks>
    if (value.version !== 1 || !Array.isArray(value.links)) throw new Error()
    for (const link of value.links) {
      if (!link || typeof link.id !== "string" || typeof link.adapterId !== "string" || typeof link.taskId !== "string" || typeof link.sessionId !== "string" || typeof link.createdAt !== "string") throw new Error()
    }
    return value as StoredLinks
  } catch {
    throw new TaskSessionLinkStoreError("TASK_SESSION_LINK_STORE_INVALID", "Task session link store is invalid.")
  }
}

export class FileTaskSessionLinkStore {
  private pending: Promise<unknown> = Promise.resolve()

  constructor(private readonly workspace: TaskSessionLinkWorkspace) {}

  async list(adapterId: string, taskId: string): Promise<BoringTaskSessionLink[]> {
    await this.pending.catch(() => {})
    const store = await this.read()
    return store.links.filter((link) => link.adapterId === adapterId && link.taskId === taskId)
  }

  link(input: { adapterId: string; taskId: string; sessionId: string }): Promise<BoringTaskSessionLink> {
    return this.mutate(async (store) => {
      const existing = store.links.find((link) => link.adapterId === input.adapterId && link.taskId === input.taskId && link.sessionId === input.sessionId)
      if (existing) return existing
      const link: BoringTaskSessionLink = { id: randomUUID(), ...input, createdAt: new Date().toISOString() }
      store.links.push(link)
      await this.write(store)
      return link
    })
  }

  unlink(linkId: string): Promise<BoringTaskSessionLink> {
    return this.mutate(async (store) => {
      const index = store.links.findIndex((link) => link.id === linkId)
      if (index < 0) throw new TaskSessionLinkStoreError("TASK_SESSION_LINK_MISSING", "Task session link was not found.")
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
    try {
      return parseStore(await this.workspace.readFile(STORE_PATH))
    } catch (error) {
      if (isMissing(error)) return { version: 1, links: [] }
      throw error
    }
  }

  private async write(store: StoredLinks): Promise<void> {
    await this.workspace.mkdir(STORE_DIR, { recursive: true })
    const temporary = `${STORE_PATH}.tmp-${randomUUID()}`
    await this.workspace.writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`)
    await this.workspace.rename(temporary, STORE_PATH)
  }
}

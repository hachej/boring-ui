import { TASK_ERROR_CODES, type BoringTaskSessionLink } from "../shared"
import { describe, expect, it } from "vitest"
import { FileTaskSessionLinkStore, TaskSessionLinkStoreError, taskSessionLinkStoreForWorkspace, type TaskSessionLinkWorkspace } from "./taskSessionLinkStore"

class MemoryWorkspace implements TaskSessionLinkWorkspace {
  readonly root = "/workspace"
  readonly writes: string[] = []
  readonly unlinks: string[] = []
  reads = 0
  readError?: Error
  failRename = false

  constructor(readonly files = new Map<string, string>()) {}

  async readFile(path: string) {
    this.reads += 1
    if (this.readError) throw this.readError
    const value = this.files.get(path)
    if (value === undefined) throw Object.assign(new Error("not found"), { code: TASK_ERROR_CODES.WORKSPACE_FILE_MISSING })
    return value
  }

  async writeFile(path: string, data: string) {
    this.writes.push(path)
    this.files.set(path, data)
  }

  async mkdir() {}

  async rename(from: string, to: string) {
    if (this.failRename) throw new Error("rename failed")
    const value = this.files.get(from)
    if (value === undefined) throw Object.assign(new Error("not found"), { code: TASK_ERROR_CODES.WORKSPACE_FILE_MISSING })
    this.files.set(to, value)
    this.files.delete(from)
  }

  async unlink(path: string) {
    this.unlinks.push(path)
    this.files.delete(path)
  }
}

describe("FileTaskSessionLinkStore", () => {
  it("stores opaque links idempotently and isolates adapter/task pairs", async () => {
    const workspace = new MemoryWorkspace()
    const store = new FileTaskSessionLinkStore(workspace)

    const firstReceipt = await store.link({ agentTypeId: "alpha", adapterId: "github", taskId: "776", sessionId: "native-a" })
    const duplicate = await store.link({ agentTypeId: "alpha", adapterId: "github", taskId: "776", sessionId: "native-a" })
    const first = firstReceipt.link
    await store.link({ agentTypeId: "alpha", adapterId: "github", taskId: "other", sessionId: "native-b" })
    await store.link({ agentTypeId: "alpha", adapterId: "beads", taskId: "776", sessionId: "native-c" })

    expect(firstReceipt).toMatchObject({ changed: true, snapshot: { adapterId: "github", taskId: "776", links: [first] } })
    expect(duplicate).toEqual({ ...firstReceipt, changed: false })
    expect(await store.list("github", "776")).toEqual([first])
    // The link id must be opaque — never derived from the adapter/task pair.
    // Asserting the UUID shape says that deterministically; a substring check
    // against a random UUID flakes whenever the task id happens to appear in it.
    expect(first.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(workspace.files.has(".pi/tasks/session-links.json")).toBe(true)
    expect(workspace.writes.every((path) => path.startsWith(".pi/tasks/session-links.json.tmp-"))).toBe(true)
  })

  it("reverse-resolves several sessions with one deterministic store scan", async () => {
    const workspace = new MemoryWorkspace()
    const store = new FileTaskSessionLinkStore(workspace)
    await store.link({ agentTypeId: "alpha", adapterId: "zeta", taskId: "2", sessionId: "native-a" })
    await store.link({ agentTypeId: "alpha", adapterId: "alpha", taskId: "9", sessionId: "native-a" })
    await store.link({ agentTypeId: "alpha", adapterId: "alpha", taskId: "8", sessionId: "native-b" })
    workspace.reads = 0

    const grouped = await store.listBySessionIds(["native-a", "missing"])
    expect(workspace.reads).toBe(1)
    expect(grouped.get("native-a")?.map((link) => `${link.adapterId}/${link.taskId}`)).toEqual(["alpha/9", "zeta/2"])
    expect(grouped.get("missing")).toEqual([])
  })

  it("builds one deterministic linked-session snapshot with one store read", async () => {
    const workspace = new MemoryWorkspace()
    const store = new FileTaskSessionLinkStore(workspace)
    await store.link({ agentTypeId: "alpha", adapterId: "zeta", taskId: "2", sessionId: "native-a" })
    await store.link({ agentTypeId: "alpha", adapterId: "alpha", taskId: "9", sessionId: "native-b" })
    await store.link({ agentTypeId: "alpha", adapterId: "alpha", taskId: "9", sessionId: "native-c" })
    workspace.reads = 0

    const snapshot = await store.snapshotLinks()

    expect(workspace.reads).toBe(1)
    expect(snapshot.map((task) => ({
      adapterId: task.adapterId,
      taskId: task.taskId,
      sessionIds: task.links.map((link) => link.sessionId),
    }))).toEqual([
      { adapterId: "alpha", taskId: "9", sessionIds: ["native-b", "native-c"] },
      { adapterId: "zeta", taskId: "2", sessionIds: ["native-a"] },
    ])
  })

  it("shares one writer queue across lease-local Workspace wrappers with the same stable root", async () => {
    const firstWorkspace = new MemoryWorkspace()
    const secondWorkspace = new MemoryWorkspace(firstWorkspace.files)
    const stores = [taskSessionLinkStoreForWorkspace(firstWorkspace), taskSessionLinkStoreForWorkspace(secondWorkspace)]
    expect(stores[0]).not.toBe(stores[1])
    await Promise.all(Array.from({ length: 12 }, (_, index) => stores[index % stores.length]!.link({
      adapterId: "github",
      taskId: "776",
      agentTypeId: "alpha",
      sessionId: `native-${index}`,
    })))
    expect(await stores[0]!.list("github", "776")).toHaveLength(12)
  })

  it("unlinks stale bindings without consulting a session", async () => {
    const store = new FileTaskSessionLinkStore(new MemoryWorkspace())
    const link = (await store.link({ agentTypeId: "alpha", adapterId: "github", taskId: "776", sessionId: "now-missing" })).link
    await expect(store.unlink(link.id)).resolves.toEqual({ link, changed: true, snapshot: { adapterId: "github", taskId: "776", links: [] } })
    await expect(store.unlink(link.id)).rejects.toMatchObject({ code: TASK_ERROR_CODES.SESSION_LINK_MISSING } satisfies Partial<TaskSessionLinkStoreError>)
  })

  it("atomically rejects unlinking a link owned by another Agent", async () => {
    const store = new FileTaskSessionLinkStore(new MemoryWorkspace())
    const link = (await store.link({ agentTypeId: "beta", adapterId: "github", taskId: "776", sessionId: "foreign" })).link

    await expect(store.unlink(link.id, "alpha")).rejects.toMatchObject({ code: TASK_ERROR_CODES.SESSION_LINK_MISSING })
    await expect(store.list("github", "776")).resolves.toEqual([link])
  })

  it("rejects a mutation before it can persist an unreadable oversized store", async () => {
    const workspace = new MemoryWorkspace()
    const maxBytes = 4 * 1024 * 1024
    const encoder = new TextEncoder()
    const linksOfLength = (length: number): BoringTaskSessionLink[] => Array.from({ length }, (_, index) => ({
      id: String(index).padEnd(512, "i"),
      adapterId: "a".repeat(512),
      taskId: "t".repeat(512),
      agentTypeId: "g".repeat(512),
      sessionId: String(index).padEnd(512, "s"),
      createdAt: "2026-08-06T00:00:00.000Z",
    }))
    const serializedSize = (length: number) => encoder.encode(`${JSON.stringify({ version: 1, links: linksOfLength(length) }, null, 2)}\n`).byteLength
    let low = 0
    let high = 10_000
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if (serializedSize(middle) <= maxBytes) low = middle
      else high = middle - 1
    }
    const links = linksOfLength(low)
    workspace.files.set(".pi/tasks/session-links.json", `${JSON.stringify({ version: 1, links }, null, 2)}\n`)
    const store = new FileTaskSessionLinkStore(workspace)

    await expect(store.link({
      adapterId: "z".repeat(512),
      taskId: "z".repeat(512),
      agentTypeId: "z".repeat(512),
      sessionId: "z".repeat(512),
    })).rejects.toMatchObject({ code: TASK_ERROR_CODES.SESSION_LINK_STORE_ERROR })
    await expect(store.list("a".repeat(512), "t".repeat(512))).resolves.toHaveLength(links.length)
  })

  it("persists deterministic link ordering", async () => {
    const workspace = new MemoryWorkspace()
    const store = new FileTaskSessionLinkStore(workspace)
    await store.link({ agentTypeId: "alpha", adapterId: "zeta", taskId: "2", sessionId: "native-z" })
    await store.link({ agentTypeId: "alpha", adapterId: "alpha", taskId: "9", sessionId: "native-a" })

    const persisted = JSON.parse(workspace.files.get(".pi/tasks/session-links.json")!) as { links: Array<{ agentTypeId: "alpha", adapterId: string }> }
    expect(persisted.links.map((link) => link.adapterId)).toEqual(["alpha", "zeta"])
  })

  it("rejects malformed state and distinguishes typed missing from read failures", async () => {
    const malformed = new MemoryWorkspace()
    malformed.files.set(".pi/tasks/session-links.json", "{}")
    await expect(new FileTaskSessionLinkStore(malformed).list("github", "776"))
      .rejects.toMatchObject({ code: TASK_ERROR_CODES.SESSION_LINK_STORE_INVALID } satisfies Partial<TaskSessionLinkStoreError>)

    const failed = new MemoryWorkspace()
    failed.readError = new Error("repository not found while offline")
    await expect(new FileTaskSessionLinkStore(failed).list("github", "776"))
      .rejects.toMatchObject({ code: TASK_ERROR_CODES.SESSION_LINK_STORE_ERROR } satisfies Partial<TaskSessionLinkStoreError>)
  })

  it("rejects empty and oversized identifiers before workspace access", async () => {
    const workspace = new MemoryWorkspace()
    const store = new FileTaskSessionLinkStore(workspace)
    await expect(store.list(" ", "776")).rejects.toMatchObject({ code: TASK_ERROR_CODES.SESSION_INVALID_BODY })
    await expect(store.link({ agentTypeId: "alpha", adapterId: "github", taskId: "776", sessionId: "é".repeat(257) }))
      .rejects.toMatchObject({ code: TASK_ERROR_CODES.SESSION_INVALID_BODY })
    expect(workspace.writes).toEqual([])
  })

  it("best-effort removes a failed temporary write and returns a stable error", async () => {
    const workspace = new MemoryWorkspace()
    workspace.failRename = true
    await expect(new FileTaskSessionLinkStore(workspace).link({ agentTypeId: "alpha", adapterId: "github", taskId: "776", sessionId: "native" }))
      .rejects.toMatchObject({ code: TASK_ERROR_CODES.SESSION_LINK_STORE_ERROR })
    expect(workspace.unlinks).toHaveLength(1)
    expect(workspace.unlinks[0]).toMatch(/session-links\.json\.tmp-/)
    expect([...workspace.files.keys()]).toEqual([])
  })
})

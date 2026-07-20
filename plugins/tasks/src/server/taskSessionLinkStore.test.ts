import { TASK_ERROR_CODES } from "../shared"
import { describe, expect, it } from "vitest"
import { FileTaskSessionLinkStore, TaskSessionLinkStoreError, type TaskSessionLinkWorkspace } from "./taskSessionLinkStore"

class MemoryWorkspace implements TaskSessionLinkWorkspace {
  readonly files = new Map<string, string>()
  readonly writes: string[] = []
  readonly unlinks: string[] = []
  reads = 0
  readError?: Error
  failRename = false

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

    const first = await store.link({ adapterId: "github", taskId: "776", sessionId: "native-a" })
    const duplicate = await store.link({ adapterId: "github", taskId: "776", sessionId: "native-a" })
    await store.link({ adapterId: "github", taskId: "other", sessionId: "native-b" })
    await store.link({ adapterId: "beads", taskId: "776", sessionId: "native-c" })

    expect(duplicate).toEqual(first)
    expect(await store.list("github", "776")).toEqual([first])
    expect(first.id).not.toContain("776")
    expect(workspace.files.has(".pi/tasks/session-links.json")).toBe(true)
    expect(workspace.writes.every((path) => path.startsWith(".pi/tasks/session-links.json.tmp-"))).toBe(true)
  })

  it("reverse-resolves several sessions with one deterministic store scan", async () => {
    const workspace = new MemoryWorkspace()
    const store = new FileTaskSessionLinkStore(workspace)
    await store.link({ adapterId: "zeta", taskId: "2", sessionId: "native-a" })
    await store.link({ adapterId: "alpha", taskId: "9", sessionId: "native-a" })
    await store.link({ adapterId: "alpha", taskId: "8", sessionId: "native-b" })
    workspace.reads = 0

    const grouped = await store.listBySessionIds(["native-a", "missing"])
    expect(workspace.reads).toBe(1)
    expect(grouped.get("native-a")?.map((link) => `${link.adapterId}/${link.taskId}`)).toEqual(["alpha/9", "zeta/2"])
    expect(grouped.get("missing")).toEqual([])
  })

  it("serializes concurrent writes without losing links", async () => {
    const store = new FileTaskSessionLinkStore(new MemoryWorkspace())
    await Promise.all(Array.from({ length: 12 }, (_, index) => store.link({
      adapterId: "github",
      taskId: "776",
      sessionId: `native-${index}`,
    })))
    expect(await store.list("github", "776")).toHaveLength(12)
  })

  it("unlinks stale bindings without consulting a session", async () => {
    const store = new FileTaskSessionLinkStore(new MemoryWorkspace())
    const link = await store.link({ adapterId: "github", taskId: "776", sessionId: "now-missing" })
    await expect(store.unlink(link.id)).resolves.toEqual(link)
    await expect(store.unlink(link.id)).rejects.toMatchObject({ code: TASK_ERROR_CODES.SESSION_LINK_MISSING } satisfies Partial<TaskSessionLinkStoreError>)
  })

  it("persists deterministic link ordering", async () => {
    const workspace = new MemoryWorkspace()
    const store = new FileTaskSessionLinkStore(workspace)
    await store.link({ adapterId: "zeta", taskId: "2", sessionId: "native-z" })
    await store.link({ adapterId: "alpha", taskId: "9", sessionId: "native-a" })

    const persisted = JSON.parse(workspace.files.get(".pi/tasks/session-links.json")!) as { links: Array<{ adapterId: string }> }
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
    await expect(store.link({ adapterId: "github", taskId: "776", sessionId: "é".repeat(257) }))
      .rejects.toMatchObject({ code: TASK_ERROR_CODES.SESSION_INVALID_BODY })
    expect(workspace.writes).toEqual([])
  })

  it("best-effort removes a failed temporary write and returns a stable error", async () => {
    const workspace = new MemoryWorkspace()
    workspace.failRename = true
    await expect(new FileTaskSessionLinkStore(workspace).link({ adapterId: "github", taskId: "776", sessionId: "native" }))
      .rejects.toMatchObject({ code: TASK_ERROR_CODES.SESSION_LINK_STORE_ERROR })
    expect(workspace.unlinks).toHaveLength(1)
    expect(workspace.unlinks[0]).toMatch(/session-links\.json\.tmp-/)
    expect([...workspace.files.keys()]).toEqual([])
  })
})

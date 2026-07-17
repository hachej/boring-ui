import { describe, expect, it } from "vitest"
import { FileTaskSessionLinkStore, TaskSessionLinkStoreError, type TaskSessionLinkWorkspace } from "./taskSessionLinkStore"

class MemoryWorkspace implements TaskSessionLinkWorkspace {
  readonly files = new Map<string, string>()
  readonly writes: string[] = []

  async readFile(path: string) {
    const value = this.files.get(path)
    if (value === undefined) throw Object.assign(new Error("not found"), { code: "ENOENT" })
    return value
  }

  async writeFile(path: string, data: string) {
    this.writes.push(path)
    this.files.set(path, data)
  }

  async mkdir() {}

  async rename(from: string, to: string) {
    const value = this.files.get(from)
    if (value === undefined) throw Object.assign(new Error("not found"), { code: "ENOENT" })
    this.files.set(to, value)
    this.files.delete(from)
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
    await expect(store.unlink(link.id)).rejects.toMatchObject({ code: "TASK_SESSION_LINK_MISSING" } satisfies Partial<TaskSessionLinkStoreError>)
  })

  it("rejects malformed persisted state", async () => {
    const workspace = new MemoryWorkspace()
    workspace.files.set(".pi/tasks/session-links.json", "{}")
    await expect(new FileTaskSessionLinkStore(workspace).list("github", "776"))
      .rejects.toMatchObject({ code: "TASK_SESSION_LINK_STORE_INVALID" } satisfies Partial<TaskSessionLinkStoreError>)
  })
})

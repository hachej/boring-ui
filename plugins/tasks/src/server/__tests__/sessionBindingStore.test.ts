import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { FileTaskSessionBindingStore, type TaskSessionBindingStore } from "../sessionBindingStore"

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "boring-task-session-bindings-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function runBindingStoreConformance(createStore: () => TaskSessionBindingStore) {
  it("creates idempotent unique workspace/adapter/task/session bindings and lists newest first", async () => {
    const store = createStore()
    const first = await store.createBinding({ workspaceId: "workspace-a", adapterId: "github", taskId: "1", sessionId: "pi-1", title: "One" })
    const duplicate = await store.createBinding({ workspaceId: "workspace-a", adapterId: "github", taskId: "1", sessionId: "pi-1", title: "Changed" })
    const second = await store.createBinding({ workspaceId: "workspace-a", adapterId: "github", taskId: "1", sessionId: "pi-2", title: "Two" })
    await store.createBinding({ workspaceId: "workspace-b", adapterId: "github", taskId: "1", sessionId: "pi-1" })
    await store.createBinding({ workspaceId: "workspace-a", adapterId: "github", taskId: "2", sessionId: "pi-1" })

    expect(duplicate).toEqual(first)
    await expect(store.listBindings({ workspaceId: "workspace-a", adapterId: "github", taskId: "1" })).resolves.toEqual([second, first])
  })

  it("serializes concurrent links for the same tuple", async () => {
    const store = createStore()
    const created = await Promise.all(Array.from({ length: 10 }, () => store.createBinding({
      workspaceId: "workspace-a",
      adapterId: "github",
      taskId: "1",
      sessionId: "pi-1",
      title: "One",
    })))

    expect(new Set(created.map((binding) => binding.id)).size).toBe(1)
    await expect(store.listBindings({ workspaceId: "workspace-a", adapterId: "github", taskId: "1" })).resolves.toHaveLength(1)
  })

  it("handles concurrent link and unlink deterministically", async () => {
    const store = createStore()
    const existing = await store.createBinding({ workspaceId: "workspace-a", adapterId: "github", taskId: "1", sessionId: "pi-1" })

    await Promise.all([
      store.deleteBinding({ workspaceId: "workspace-a", bindingId: existing.id }),
      store.createBinding({ workspaceId: "workspace-a", adapterId: "github", taskId: "1", sessionId: "pi-2" }),
    ])

    await expect(store.listBindings({ workspaceId: "workspace-a", adapterId: "github", taskId: "1" })).resolves.toEqual([
      expect.objectContaining({ sessionId: "pi-2" }),
    ])
  })
}

describe("FileTaskSessionBindingStore", () => {
  runBindingStoreConformance(() => new FileTaskSessionBindingStore(dir))

  it("serializes two independent store instances against the same file", async () => {
    const first = new FileTaskSessionBindingStore(dir)
    const second = new FileTaskSessionBindingStore(dir)
    const [a, b, duplicate] = await Promise.all([
      first.createBinding({ workspaceId: "workspace-a", adapterId: "github", taskId: "1", sessionId: "pi-1" }),
      second.createBinding({ workspaceId: "workspace-a", adapterId: "github", taskId: "1", sessionId: "pi-2" }),
      second.createBinding({ workspaceId: "workspace-a", adapterId: "github", taskId: "1", sessionId: "pi-1" }),
    ])

    const reloaded = new FileTaskSessionBindingStore(dir)
    const bindings = await reloaded.listBindings({ workspaceId: "workspace-a", adapterId: "github", taskId: "1" })
    expect(bindings.map((binding) => binding.sessionId).sort()).toEqual(["pi-1", "pi-2"])
    expect(duplicate.id).toBe(a.id)
    expect(b.id).not.toBe(a.id)
  })

  it("persists bindings across process restart in the .pi/tasks layout", async () => {
    const store = new FileTaskSessionBindingStore(dir)
    const binding = await store.createBinding({ workspaceId: "workspace-a", adapterId: "github", taskId: "1", sessionId: "pi-1", title: "One" })

    const reloaded = new FileTaskSessionBindingStore(dir)
    await expect(reloaded.listBindings({ workspaceId: "workspace-a", adapterId: "github", taskId: "1" })).resolves.toEqual([binding])

    const raw = JSON.parse(await readFile(join(dir, "session-links.json"), "utf8"))
    expect(raw.bindings[binding.id]).toMatchObject({ workspaceId: "workspace-a", adapterId: "github", taskId: "1", sessionId: "pi-1" })
  })

  it("does not mutate live cache when an atomic metadata write fails", async () => {
    const store = new FileTaskSessionBindingStore(dir, {
      writer: async () => { throw new Error("injected write failure") },
    })

    await expect(store.createBinding({ workspaceId: "workspace-a", adapterId: "github", taskId: "1", sessionId: "pi-1" })).rejects.toThrow("injected write failure")
    await expect(store.listBindings({ workspaceId: "workspace-a", adapterId: "github", taskId: "1" })).resolves.toEqual([])
  })
})

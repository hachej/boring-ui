import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { FileTaskSessionBindingStore } from "../sessionBindingStore"
import { runTaskSessionBindingStoreConformance } from "./sessionBindingStore.conformance"

let dir: string
let clockMs = 0

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "boring-task-session-bindings-"))
  clockMs = 0
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function createFileStore(): FileTaskSessionBindingStore {
  return new FileTaskSessionBindingStore(dir, {
    clock: () => new Date(Date.UTC(2026, 6, 1, 0, 0, 0, clockMs++)),
  })
}

describe("FileTaskSessionBindingStore", () => {
  runTaskSessionBindingStoreConformance({
    name: "FileTaskSessionBindingStore",
    createStore: createFileStore,
    createReopenedStore: createFileStore,
  })

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

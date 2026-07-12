import { describe, expect, it } from "vitest"
import type { BoringTaskSessionBinding } from "../../shared"

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

export interface TaskSessionBindingStoreContract {
  listBindings(input: TaskSessionBindingListInput): Promise<BoringTaskSessionBinding[]>
  createBinding(input: TaskSessionBindingCreateInput): Promise<BoringTaskSessionBinding>
  deleteBinding(input: TaskSessionBindingDeleteInput): Promise<void>
}

export function runTaskSessionBindingStoreConformance(options: {
  name: string
  createStore(): TaskSessionBindingStoreContract
  createReopenedStore?: () => TaskSessionBindingStoreContract
}): void {
  describe(`${options.name} binding-store conformance`, () => {
    it("creates idempotent unique workspace/adapter/task/session bindings and lists newest first", async () => {
      const store = options.createStore()
      const first = await store.createBinding({ workspaceId: "workspace-a", adapterId: "github", taskId: "1", sessionId: "pi-1", title: "One" })
      const duplicate = await store.createBinding({ workspaceId: "workspace-a", adapterId: "github", taskId: "1", sessionId: "pi-1", title: "Changed" })
      const second = await store.createBinding({ workspaceId: "workspace-a", adapterId: "github", taskId: "1", sessionId: "pi-2", title: "Two" })
      await store.createBinding({ workspaceId: "workspace-b", adapterId: "github", taskId: "1", sessionId: "pi-1" })
      await store.createBinding({ workspaceId: "workspace-a", adapterId: "github", taskId: "2", sessionId: "pi-1" })

      expect(duplicate).toEqual(first)
      await expect(store.listBindings({ workspaceId: "workspace-a", adapterId: "github", taskId: "1" })).resolves.toEqual([second, first])
      await expect(store.listBindings({ workspaceId: "workspace-b", adapterId: "github", taskId: "1" })).resolves.toEqual([
        expect.objectContaining({ workspaceId: "workspace-b", sessionId: "pi-1" }),
      ])
      await expect(store.listBindings({ workspaceId: "workspace-a", adapterId: "github", taskId: "2" })).resolves.toEqual([
        expect.objectContaining({ workspaceId: "workspace-a", taskId: "2", sessionId: "pi-1" }),
      ])
    })

    it("serializes concurrent links for the same tuple", async () => {
      const store = options.createStore()
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
      const store = options.createStore()
      const existing = await store.createBinding({ workspaceId: "workspace-a", adapterId: "github", taskId: "1", sessionId: "pi-1" })

      await Promise.all([
        store.deleteBinding({ workspaceId: "workspace-a", bindingId: existing.id }),
        store.createBinding({ workspaceId: "workspace-a", adapterId: "github", taskId: "1", sessionId: "pi-2" }),
      ])

      await expect(store.listBindings({ workspaceId: "workspace-a", adapterId: "github", taskId: "1" })).resolves.toEqual([
        expect.objectContaining({ sessionId: "pi-2" }),
      ])
    })

    it("unlinks only inside the requested workspace", async () => {
      const store = options.createStore()
      const binding = await store.createBinding({ workspaceId: "workspace-a", adapterId: "github", taskId: "1", sessionId: "pi-1" })

      await expect(store.deleteBinding({ workspaceId: "workspace-b", bindingId: binding.id })).rejects.toMatchObject({
        status: 404,
        code: "TASK_SESSION_BINDING_NOT_FOUND",
      })
      await expect(store.listBindings({ workspaceId: "workspace-a", adapterId: "github", taskId: "1" })).resolves.toEqual([binding])

      await store.deleteBinding({ workspaceId: "workspace-a", bindingId: binding.id })
      await expect(store.listBindings({ workspaceId: "workspace-a", adapterId: "github", taskId: "1" })).resolves.toEqual([])
    })

    const createReopenedStore = options.createReopenedStore
    if (createReopenedStore) {
      it("persists bindings through a reopened store instance", async () => {
        const store = options.createStore()
        const binding = await store.createBinding({ workspaceId: "workspace-a", adapterId: "github", taskId: "614", sessionId: "pi-a", title: "Hosted A" })
        await store.createBinding({ workspaceId: "workspace-b", adapterId: "github", taskId: "614", sessionId: "pi-b", title: "Hosted B" })

        const reopened = createReopenedStore()
        await expect(reopened.listBindings({ workspaceId: "workspace-a", adapterId: "github", taskId: "614" })).resolves.toEqual([binding])
        await expect(reopened.listBindings({ workspaceId: "workspace-b", adapterId: "github", taskId: "614" })).resolves.toEqual([
          expect.objectContaining({ workspaceId: "workspace-b", sessionId: "pi-b" }),
        ])
      })
    }
  })
}

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createWorkspaceAgentServer} from "../../../../../packages/workspace/src/app/server/createWorkspaceAgentServer"
import { createTasksServerPlugin } from "../index"
import { FileTaskSessionBindingStore } from "../sessionBindingStore"

let workspaceRoot: string | undefined

afterEach(async () => {
  if (workspaceRoot) await rm(workspaceRoot, { recursive: true, force: true })
  workspaceRoot = undefined
})

describe("Tasks session port host composition", () => {
  it("uses the composed Pi service and host workspace resolver, never a forged request scope", async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "tasks-session-port-composed-"))
    const store = new FileTaskSessionBindingStore(join(workspaceRoot, ".pi", "tasks"))
    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "direct",
      logger: false,
      provisionWorkspace: false,
      externalPlugins: false,
      getWorkspaceId: async () => "workspace-a",
      plugins: [createTasksServerPlugin({ workspaceRoot, sessionBindingStore: store, sources: [] })],
    })
    try {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/agent/pi-chat/sessions",
        headers: { "x-boring-workspace-id": "workspace-b" },
        payload: { title: "Composed session" },
      })
      expect(created.statusCode).toBe(201)
      const sessionId = created.json().id as string
      expect(sessionId).toBeTruthy()

      const linked = await app.inject({
        method: "POST",
        url: "/api/boring-tasks/sessions/link?workspaceId=workspace-b",
        headers: { "x-boring-workspace-id": "workspace-b" },
        payload: { workspaceId: "workspace-b", adapterId: "github", taskId: "612", sessionId },
      })
      expect(linked.statusCode).toBe(200)
      expect(linked.json().link).toMatchObject({ workspaceId: "workspace-a", sessionId, title: "Composed session" })

      const foreign = await store.createBinding({ workspaceId: "workspace-b", adapterId: "github", taskId: "612", sessionId: "foreign" })
      const listed = await app.inject({
        method: "POST",
        url: "/api/boring-tasks/sessions/list?workspaceId=workspace-b",
        headers: { "x-boring-workspace-id": "workspace-b" },
        payload: { workspaceId: "workspace-b", adapterId: "github", taskId: "612" },
      })
      expect(listed.statusCode).toBe(200)
      expect(listed.json().links).toEqual([expect.objectContaining({ workspaceId: "workspace-a", sessionId })])

      const search = await app.inject({ method: "POST", url: "/api/boring-tasks/sessions/search", payload: { query: "Composed" } })
      expect(search.statusCode).toBe(200)
      expect(search.json().sessions).toEqual(expect.arrayContaining([expect.objectContaining({ id: sessionId, title: "Composed session" })]))

      const forgedUnlink = await app.inject({
        method: "POST",
        url: "/api/boring-tasks/sessions/unlink",
        headers: { "x-boring-workspace-id": "workspace-b" },
        payload: { bindingId: foreign.id },
      })
      expect(forgedUnlink.statusCode).toBe(404)
      await expect(store.listBindings({ workspaceId: "workspace-b", adapterId: "github", taskId: "612" })).resolves.toEqual([foreign])
    } finally {
      await app.close()
    }
  }, 30_000)
})

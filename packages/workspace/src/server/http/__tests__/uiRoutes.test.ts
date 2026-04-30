import Fastify from "fastify"
import { describe, expect, test } from "vitest"
import { uiRoutes } from "../uiRoutes"
import { createInMemoryBridge } from "../../ui-bridge/createInMemoryBridge"
import type { UiBridge } from "../../../shared/ui-bridge"

describe("uiRoutes", () => {
  test("getBridge scopes UI state by request", async () => {
    const app = Fastify({ logger: false })
    const bridges = new Map<string, UiBridge>()
    const getBridge = (workspaceId: string): UiBridge => {
      let bridge = bridges.get(workspaceId)
      if (!bridge) {
        bridge = createInMemoryBridge()
        bridges.set(workspaceId, bridge)
      }
      return bridge
    }

    await app.register(uiRoutes, {
      getBridge: (request) => {
        const query = request.query as Record<string, string | undefined>
        return getBridge(query.workspaceId ?? "default")
      },
    })
    await app.ready()

    const putA = await app.inject({
      method: "PUT",
      url: "/api/v1/ui/state?workspaceId=a",
      payload: { state: { activeFile: "a.ts" }, causedBy: "user" },
    })
    expect(putA.statusCode).toBe(204)

    const putB = await app.inject({
      method: "PUT",
      url: "/api/v1/ui/state?workspaceId=b",
      payload: { state: { activeFile: "b.ts" }, causedBy: "user" },
    })
    expect(putB.statusCode).toBe(204)

    const stateA = await app.inject({
      method: "GET",
      url: "/api/v1/ui/state?workspaceId=a",
    })
    const stateB = await app.inject({
      method: "GET",
      url: "/api/v1/ui/state?workspaceId=b",
    })

    expect(stateA.json()).toEqual({ activeFile: "a.ts" })
    expect(stateB.json()).toEqual({ activeFile: "b.ts" })

    await app.close()
  })
})

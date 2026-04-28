import { createRequire } from "node:module"
import { describe, expect, it } from "vitest"
import { buildServer } from "../index"

const require = createRequire(import.meta.url)

describe("buildServer", () => {
  it("exposes workspace + agent server entries to CJS-style resolvers", () => {
    expect(() => require.resolve("@boring/workspace/server")).not.toThrow()
    expect(() => require.resolve("@boring/agent/server")).not.toThrow()
  })

  it("boots with workspace UI bridge routes wired", async () => {
    const { app } = await buildServer({
      logger: false,
      workspaceRoot: process.cwd(),
    })

    try {
      const state = await app.inject({
        method: "GET",
        url: "/api/v1/ui/state",
      })
      expect(state.statusCode).toBe(200)
      expect(state.json()).toEqual({})

      const post = await app.inject({
        method: "POST",
        url: "/api/v1/ui/commands",
        payload: {
          kind: "openFile",
          params: { path: "smoke.ts" },
        },
      })
      expect(post.statusCode).toBe(200)
      expect(post.json()).toMatchObject({
        status: "ok",
      })

      const drain = await app.inject({
        method: "GET",
        url: "/api/v1/ui/commands/next?poll=true",
      })
      expect(drain.statusCode).toBe(200)
      expect(drain.json()).toEqual([
        {
          v: 1,
          seq: 1,
          kind: "openFile",
          params: { path: "smoke.ts" },
        },
      ])
    } finally {
      await app.close()
    }
  })
})

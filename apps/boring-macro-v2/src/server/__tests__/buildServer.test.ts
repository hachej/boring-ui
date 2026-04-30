import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
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
    const workspaceRoot = await mkdtemp(join(tmpdir(), "boring-macro-workspace-"))
    const { app } = await buildServer({
      logger: false,
      workspaceRoot,
    })

    const seededSkill = await readFile(
      join(workspaceRoot, ".agents", "skills", "macro-transform", "SKILL.md"),
      "utf8",
    )
    const deckSkill = await readFile(
      join(workspaceRoot, ".agents", "skills", "macro-deck", "SKILL.md"),
      "utf8",
    )
    expect(seededSkill).toContain("name: macro-transform")
    expect(deckSkill).toContain("name: macro-deck")
    await expect(
      readFile(join(workspaceRoot, ".pi", "skills", "macro-transform", "SKILL.md"), "utf8"),
    ).rejects.toThrow()

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
  }, 60_000)
})

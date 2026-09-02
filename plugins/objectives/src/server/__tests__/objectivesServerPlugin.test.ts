// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createObjectivesServerPlugin } from "../objectivesServerPlugin"
import { FileObjectiveStore } from "../objectiveStore"

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "objectives-plugin-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe("createObjectivesServerPlugin", () => {
  it("throws when neither workspaceRoot nor store is provided", () => {
    expect(() => createObjectivesServerPlugin({})).toThrow(/requires workspaceRoot/)
  })

  it("registers four agent tools and four bridge ops", () => {
    const plugin = createObjectivesServerPlugin({ workspaceRoot: dir })
    expect(plugin.id).toBe("objectives")
    expect(plugin.agentTools?.map((tool) => tool.name).sort()).toEqual([
      "create_objective",
      "get_objective",
      "list_objectives",
      "update_objective",
    ])
    expect(plugin.workspaceBridgeHandlers?.map((entry) => entry.definition.op).sort()).toEqual([
      "objective.v1.create",
      "objective.v1.get",
      "objective.v1.list",
      "objective.v1.update",
    ])
  })

  it("persists objectives created through the tool at the durable .boring path", async () => {
    const plugin = createObjectivesServerPlugin({ workspaceRoot: dir })
    const createTool = plugin.agentTools!.find((tool) => tool.name === "create_objective")!
    await createTool.execute({
      title: "Ship v2",
      objective: "Ship the v2 rewrite to production",
      metric: "weekly active users",
      baseline: 100,
      target: 500,
    }, { abortSignal: new AbortController().signal, toolCallId: "call-1" })

    const reopened = new FileObjectiveStore(join(dir, ".boring", "objectives.json"))
    await expect(reopened.list()).resolves.toHaveLength(1)
  })
})

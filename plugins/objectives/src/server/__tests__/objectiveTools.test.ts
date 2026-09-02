// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { ToolExecContext } from "@hachej/boring-workspace"
import { createObjectiveTools } from "../objectiveTools"
import { FileObjectiveStore } from "../objectiveStore"

let dir: string
let store: FileObjectiveStore
let tools: ReturnType<typeof createObjectiveTools>

const ctx: ToolExecContext = { abortSignal: new AbortController().signal, toolCallId: "call-1" }

function tool(name: string) {
  const found = tools.find((t) => t.name === name)
  if (!found) throw new Error(`missing tool ${name}`)
  return found
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "objectives-tools-"))
  store = new FileObjectiveStore(join(dir, "objectives.json"))
  tools = createObjectiveTools({ store })
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe("objective agent tools", () => {
  it("exposes list_objectives, get_objective, create_objective, update_objective", () => {
    expect(tools.map((t) => t.name).sort()).toEqual([
      "create_objective",
      "get_objective",
      "list_objectives",
      "update_objective",
    ])
  })

  it("creates, gets, lists, and updates an objective end to end", async () => {
    const createResult = await tool("create_objective").execute({
      title: "Ship v2",
      objective: "Ship the v2 rewrite to production",
      metric: "weekly active users",
      baseline: 100,
      target: 500,
    }, ctx)
    expect(createResult.isError).toBeFalsy()
    const created = (createResult.details as { objective: { id: string } }).objective
    expect(created).toMatchObject({ title: "Ship v2", status: "active", current: 100 })

    const getResult = await tool("get_objective").execute({ id: created.id }, ctx)
    expect(getResult.isError).toBeFalsy()
    expect((getResult.details as { objective: unknown }).objective).toMatchObject({ id: created.id })

    const listResult = await tool("list_objectives").execute({}, ctx)
    expect(listResult.isError).toBeFalsy()
    expect((listResult.details as { objectives: unknown[] }).objectives).toHaveLength(1)

    const updateResult = await tool("update_objective").execute({ id: created.id, current: 300, status: "achieved" }, ctx)
    expect(updateResult.isError).toBeFalsy()
    expect((updateResult.details as { objective: { current: number; status: string } }).objective).toMatchObject({
      current: 300,
      status: "achieved",
    })
  })

  it("rejects invalid create input with an error result, not a thrown exception", async () => {
    const result = await tool("create_objective").execute({ title: "Missing fields" }, ctx)
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toMatch(/Invalid create_objective input/)
  })

  it("returns an error result for get_objective on an unknown id", async () => {
    const result = await tool("get_objective").execute({ id: "missing" }, ctx)
    expect(result.isError).toBe(true)
  })

  it("returns an error result for update_objective on an unknown id", async () => {
    const result = await tool("update_objective").execute({ id: "missing", current: 1 }, ctx)
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toMatch(/update_objective failed/)
  })
})

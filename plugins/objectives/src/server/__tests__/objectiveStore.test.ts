// @vitest-environment node

import { mkdtemp, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OBJECTIVE_ERROR_CODES } from "../../shared/error-codes"
import type { CreateObjectiveInput } from "../../shared/types"
import { FileObjectiveStore } from "../objectiveStore"

let dir: string
let store: FileObjectiveStore

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "objectives-store-"))
  store = new FileObjectiveStore(join(dir, "objectives.json"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function input(overrides: Partial<CreateObjectiveInput> = {}): CreateObjectiveInput {
  return {
    title: "Ship v2",
    objective: "Ship the v2 rewrite to production",
    metric: "weekly active users",
    baseline: 100,
    target: 500,
    ...overrides,
  }
}

describe("FileObjectiveStore", () => {
  it("creates an objective with defaults and reloads it from disk", async () => {
    const created = await store.create(input())
    expect(created).toMatchObject({
      title: "Ship v2",
      status: "active",
      current: 100,
      constraints: [],
      evidenceRefs: [],
    })
    expect(created.id).toMatch(/^obj_/)
    expect(created.createdAt).toBe(created.updatedAt)

    const reloaded = new FileObjectiveStore(join(dir, "objectives.json"))
    await expect(reloaded.get(created.id)).resolves.toMatchObject({ id: created.id, title: "Ship v2" })
  })

  it("shares one initial load across concurrent first read/write callers", async () => {
    const initialRead = store.list()
    const [, created] = await Promise.all([initialRead, store.create(input())])
    await expect(store.list()).resolves.toHaveLength(1)
    const raw = JSON.parse(await readFile(join(dir, "objectives.json"), "utf8"))
    expect(raw.objectives[created.id]).toMatchObject({ title: "Ship v2" })
  })

  it("lists objectives filtered by status and sorted by createdAt", async () => {
    const a = await store.create(input({ title: "A" }))
    await new Promise((resolve) => setTimeout(resolve, 2))
    const b = await store.create(input({ title: "B", status: "paused" }))

    await expect(store.list()).resolves.toMatchObject([{ id: a.id }, { id: b.id }])
    await expect(store.list("paused")).resolves.toMatchObject([{ id: b.id }])
    await expect(store.list("achieved")).resolves.toEqual([])
  })

  it("updates fields, bumps updatedAt, and preserves unspecified fields", async () => {
    const created = await store.create(input())
    await new Promise((resolve) => setTimeout(resolve, 2))
    const updated = await store.update({ id: created.id, current: 250, status: "achieved", outcome: "Hit target early" })
    expect(updated).toMatchObject({
      id: created.id,
      title: created.title,
      current: 250,
      status: "achieved",
      outcome: "Hit target early",
    })
    expect(updated.updatedAt).not.toBe(created.updatedAt)
    expect(updated.createdAt).toBe(created.createdAt)

    const reloaded = new FileObjectiveStore(join(dir, "objectives.json"))
    await expect(reloaded.get(created.id)).resolves.toMatchObject({ current: 250, status: "achieved" })
  })

  it("rejects updates for an unknown objective", async () => {
    await expect(store.update({ id: "missing", current: 1 })).rejects.toMatchObject({
      code: OBJECTIVE_ERROR_CODES.NOT_FOUND,
    })
  })

  it("returns null for an unknown objective on get", async () => {
    await expect(store.get("missing")).resolves.toBeNull()
  })

  it("emits changes for mutations", async () => {
    const listener = vi.fn()
    store.subscribe(listener)
    const created = await store.create(input())
    await store.update({ id: created.id, current: 200 })
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ reason: "create", objectiveId: created.id }))
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ reason: "update", objectiveId: created.id }))
  })

  it("does not let listener failures roll back mutations", async () => {
    store.subscribe(() => { throw new Error("listener failed") })
    store.subscribe((() => Promise.reject(new Error("async listener failed"))) as never)
    await expect(store.create(input())).resolves.toMatchObject({ title: "Ship v2" })
  })
})

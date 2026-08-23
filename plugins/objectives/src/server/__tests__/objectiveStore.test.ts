// @vitest-environment node

import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OBJECTIVE_ERROR_CODES } from "../../shared/error-codes"
import type { CreateObjectiveInput } from "../../shared/types"
import { FileObjectiveStore } from "../objectiveStore"
import { WorkspacePathEscapeError } from "../pathSafety"

// Node's ESM module namespace is non-configurable, so `vi.spyOn` on the raw
// `node:fs/promises` exports fails ("Cannot redefine property"). Route the
// module through `vi.mock` with `importOriginal` instead so `readFile` and
// `writeFile` become real mockable functions while every other export
// (mkdir, rename, symlink, ...) stays the genuine implementation. Every
// import of `readFile`/`writeFile` in this file (direct or via the store)
// resolves to the same mocked function.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>()
  return {
    ...actual,
    readFile: vi.fn(actual.readFile),
    writeFile: vi.fn(actual.writeFile),
  }
})

let dir: string
let store: FileObjectiveStore

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "objectives-store-"))
  store = new FileObjectiveStore(join(dir, "objectives.json"))
})

afterEach(async () => {
  vi.restoreAllMocks()
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
    expect(created.id).toMatch(/^obj-/)
    expect(created.createdAt).toBe(created.updatedAt)

    const reloaded = new FileObjectiveStore(join(dir, "objectives.json"))
    await expect(reloaded.get(created.id)).resolves.toMatchObject({ id: created.id, title: "Ship v2" })
  })

  it("persists a versioned, revisioned on-disk shape", async () => {
    const created = await store.create(input())
    const raw = JSON.parse(await readFile(join(dir, "objectives.json"), "utf8"))
    expect(raw).toMatchObject({ version: 1, revision: 1 })
    expect(raw.objectives).toEqual([expect.objectContaining({ id: created.id, title: "Ship v2" })])
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

  describe("commit-then-observe durability", () => {
    it("leaves observable state unchanged when the write fails", async () => {
      await store.create(input({ title: "Existing" }))

      vi.mocked(writeFile).mockRejectedValueOnce(new Error("disk full"))
      await expect(store.create(input({ title: "Should not persist" }))).rejects.toThrow("disk full")

      const titles = (await store.list()).map((o) => o.title)
      expect(titles).toEqual(["Existing"])

      const raw = JSON.parse(await readFile(join(dir, "objectives.json"), "utf8"))
      expect(raw.objectives).toHaveLength(1)
    })

    it("leaves observable state unchanged when an update's write fails", async () => {
      const created = await store.create(input())

      vi.mocked(writeFile).mockRejectedValueOnce(new Error("disk full"))
      await expect(store.update({ id: created.id, current: 999 })).rejects.toThrow("disk full")

      await expect(store.get(created.id)).resolves.toMatchObject({ current: 100 })
    })
  })

  describe("single-writer revision safety", () => {
    it("refuses to clobber a newer revision committed by another store instance", async () => {
      const path = join(dir, "objectives.json")
      const storeA = new FileObjectiveStore(path)
      const storeB = new FileObjectiveStore(path)
      const seeded = await storeA.create(input({ title: "Seed" }))

      let readCount = 0
      const mockedReadFile = vi.mocked(readFile)
      const defaultImpl = mockedReadFile.getMockImplementation()!
      mockedReadFile.mockImplementation(async (...args: Parameters<typeof readFile>) => {
        readCount += 1
        // storeB.update performs two reads: an initial load, then a
        // pre-commit recheck. Let storeA fully commit a concurrent update
        // in between those two reads, so storeB's recheck observes a
        // revision it didn't start from.
        if (readCount === 2) {
          await storeA.update({ id: seeded.id, current: 500 })
        }
        return defaultImpl(...args)
      })

      await expect(storeB.update({ id: seeded.id, current: 1 })).rejects.toMatchObject({
        code: OBJECTIVE_ERROR_CODES.REVISION_CONFLICT,
      })
      mockedReadFile.mockImplementation(defaultImpl)

      // storeA's concurrent update won; storeB's was correctly refused, not silently lost.
      await expect(storeA.get(seeded.id)).resolves.toMatchObject({ current: 500 })
    })
  })

  describe("path containment", () => {
    it("rejects a symlinked .boring directory that escapes the workspace root", async () => {
      const workspaceRoot = await mkdtemp(join(tmpdir(), "objectives-workspace-"))
      const outsideDir = await mkdtemp(join(tmpdir(), "objectives-outside-"))
      await symlink(outsideDir, join(workspaceRoot, ".boring"))

      const escapee = new FileObjectiveStore(join(workspaceRoot, ".boring", "objectives.json"), { workspaceRoot })
      await expect(escapee.create(input())).rejects.toBeInstanceOf(WorkspacePathEscapeError)

      await rm(workspaceRoot, { recursive: true, force: true })
      await rm(outsideDir, { recursive: true, force: true })
    })

    it("allows a plain .boring directory inside the workspace root", async () => {
      const workspaceRoot = await mkdtemp(join(tmpdir(), "objectives-workspace-"))
      const contained = new FileObjectiveStore(join(workspaceRoot, ".boring", "objectives.json"), { workspaceRoot })
      await expect(contained.create(input())).resolves.toMatchObject({ title: "Ship v2" })
      await rm(workspaceRoot, { recursive: true, force: true })
    })

    it("rejects objectives.json itself being a symlink, even when its directory is contained", async () => {
      const workspaceRoot = await mkdtemp(join(tmpdir(), "objectives-workspace-"))
      const outsideFile = join(await mkdtemp(join(tmpdir(), "objectives-outside-")), "secret.json")
      await writeFile(outsideFile, JSON.stringify({ version: 1, revision: 0, objectives: [] }), "utf8")
      await mkdir(join(workspaceRoot, ".boring"), { recursive: true })
      await symlink(outsideFile, join(workspaceRoot, ".boring", "objectives.json"))

      const escapee = new FileObjectiveStore(join(workspaceRoot, ".boring", "objectives.json"), { workspaceRoot })
      await expect(escapee.create(input())).rejects.toBeInstanceOf(WorkspacePathEscapeError)
      await expect(escapee.list()).rejects.toBeInstanceOf(WorkspacePathEscapeError)

      await rm(workspaceRoot, { recursive: true, force: true })
    })
  })

  describe("load validation and migration", () => {
    const canonicalId = "obj-11111111-1111-4111-8111-111111111111"

    it("skips a corrupt record and reports it via diagnostics instead of crashing", async () => {
      await mkdir(dir, { recursive: true })
      await writeFile(
        join(dir, "objectives.json"),
        JSON.stringify({
          version: 1,
          revision: 1,
          objectives: [
            { id: canonicalId, title: "Good", objective: "Do a thing", metric: "m", baseline: 0, target: 1, current: 0, status: "active", constraints: [], evidenceRefs: [], createdAt: "x", updatedAt: "x" },
            { id: "obj-bad", title: "Bad" },
          ],
        }),
        "utf8",
      )
      const objectives = await store.list()
      expect(objectives.map((o) => o.id)).toEqual([canonicalId])
      const diagnostics = store.getLoadDiagnostics()
      expect(diagnostics).toHaveLength(1)
      expect(diagnostics[0]).toMatchObject({ index: 1 })
    })

    it("rejects a __proto__ id as an invalid canonical id and does not pollute Object.prototype", async () => {
      await mkdir(dir, { recursive: true })
      await writeFile(
        join(dir, "objectives.json"),
        JSON.stringify({
          version: 1,
          revision: 1,
          objectives: [
            { id: "__proto__", title: "Evil", objective: "Do a thing", metric: "m", baseline: 0, target: 1, current: 0, status: "active", constraints: [], evidenceRefs: [], createdAt: "x", updatedAt: "x" },
          ],
        }),
        "utf8",
      )
      const objectives = await store.list()
      expect(objectives).toHaveLength(0)
      expect(store.getLoadDiagnostics()).toHaveLength(1)
      expect(({} as Record<string, unknown>).title).toBeUndefined()
    })

    it("migrates a legacy unversioned { objectives: Record } file, skipping records with a pre-canonical id", async () => {
      // There are no production objectives.json files yet, so a legacy
      // record whose id predates the obj-<uuid> format has no data-loss
      // consequence today: it is skipped with a load diagnostic rather than
      // trusted, exactly like any other schema-invalid record.
      await mkdir(dir, { recursive: true })
      await writeFile(
        join(dir, "objectives.json"),
        JSON.stringify({
          objectives: {
            "obj-legacy": { id: "obj-legacy", title: "Legacy", objective: "Do a thing", metric: "m", baseline: 0, target: 1, current: 0, status: "active", constraints: [], evidenceRefs: [], createdAt: "x", updatedAt: "x" },
          },
        }),
        "utf8",
      )
      await expect(store.list()).resolves.toEqual([])
      const diagnostics = store.getLoadDiagnostics()
      expect(diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ index: -1, reason: expect.stringContaining("migrated legacy") }),
          expect.objectContaining({ index: 0 }),
        ]),
      )

      // The next write upgrades the on-disk file to the versioned shape,
      // even though the legacy record itself was dropped.
      await store.create(input({ title: "Fresh" }))
      const raw = JSON.parse(await readFile(join(dir, "objectives.json"), "utf8"))
      expect(raw).toMatchObject({ version: 1, revision: 1 })
      expect(raw.objectives).toHaveLength(1)
    })
  })

  describe("size and idempotency", () => {
    it("dedupes a retried create by clientRequestId instead of duplicating", async () => {
      const first = await store.create(input({ clientRequestId: "retry-1" }))
      const second = await store.create(input({ clientRequestId: "retry-1" }))
      expect(second.id).toBe(first.id)
      await expect(store.list()).resolves.toHaveLength(1)
    })

    it("creates distinct objectives for distinct clientRequestIds", async () => {
      const first = await store.create(input({ clientRequestId: "a" }))
      const second = await store.create(input({ clientRequestId: "b" }))
      expect(first.id).not.toBe(second.id)
      await expect(store.list()).resolves.toHaveLength(2)
    })
  })
})

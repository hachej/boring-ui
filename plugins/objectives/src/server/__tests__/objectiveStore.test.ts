// @vitest-environment node

import { mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises"
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

  describe("single-writer lock: mutual exclusion and safe restart overlap", () => {
    it("blocks a second writer while the first holds the lock, then commits exactly once after release", async () => {
      const path = join(dir, "objectives.json")
      const storeA = new FileObjectiveStore(path)
      const storeB = new FileObjectiveStore(path)
      const seeded = await storeA.create(input({ title: "Seed" }))

      const lockPath = `${path}.lock`
      // Simulate a concurrent writer (e.g. the predecessor process during a
      // restart-overlap window) holding the lock mid-commit.
      await writeFile(lockPath, JSON.stringify({ pid: 999_999, token: "external-writer", timestamp: Date.now() }), "utf8")

      const updatePromise = storeB.update({ id: seeded.id, current: 42 })

      // storeB's entire read-check-write sequence is gated behind the
      // lock, so while the external lock stands, it must not have
      // reached the recheck/commit — the revision on disk stays put.
      await new Promise((resolve) => setTimeout(resolve, 80))
      const midRaw = JSON.parse(await readFile(path, "utf8"))
      expect(midRaw.revision).toBe(1)

      // Release the external lock ("writer A" finishes); storeB should now
      // acquire it, recheck the (unchanged) revision inside the lock, and
      // commit exactly once — not double-commit, not lose the update.
      await rm(lockPath, { force: true })
      await expect(updatePromise).resolves.toMatchObject({ current: 42 })

      const finalRaw = JSON.parse(await readFile(path, "utf8"))
      expect(finalRaw.revision).toBe(2)
    })

    it("serializes two genuinely concurrent store instances so neither commit is lost", async () => {
      const path = join(dir, "objectives.json")
      const storeA = new FileObjectiveStore(path)
      const storeB = new FileObjectiveStore(path)
      const seeded = await storeA.create(input({ title: "Seed" }))

      await Promise.all([
        storeA.update({ id: seeded.id, current: 10 }),
        storeB.update({ id: seeded.id, current: 20 }),
      ])

      // Both updates committed (in some order) — the lock serialized them
      // instead of one instance's recheck racing the other's rename.
      const raw = JSON.parse(await readFile(path, "utf8"))
      expect(raw.revision).toBe(3) // 1 create + 2 serialized updates
    })

    it("times out with a clear error rather than hanging forever behind an unreleasable lock", async () => {
      const path = join(dir, "objectives.json")
      const store2 = new FileObjectiveStore(path)
      const seeded = await store2.create(input({ title: "Seed" }))

      const lockPath = `${path}.lock`
      // A lock that is neither stale nor ever released (no crash to
      // detect) must still bound how long a caller waits.
      await writeFile(lockPath, JSON.stringify({ pid: 999_999, token: "wedged", timestamp: Date.now() }), "utf8")

      await expect(store2.update({ id: seeded.id, current: 1 })).rejects.toMatchObject({
        code: OBJECTIVE_ERROR_CODES.LOCK_TIMEOUT,
      })

      await rm(lockPath, { force: true })
    }, 10_000)
  })

  describe("stale lock reclamation: malformed metadata, atomic replace, and containment", () => {
    it("reclaims an empty lock file once it has aged past the stale threshold (finding: malformed lock never stale)", async () => {
      const path = join(dir, "objectives.json")
      const s = new FileObjectiveStore(path)
      const created = await s.create(input({ title: "Seed" }))
      const lockPath = `${path}.lock`

      // Simulates a crash mid-write: the lock file exists but its content
      // never made it past `open(..., "wx")` before the process died --
      // empty, so its metadata is unparseable JSON.
      await writeFile(lockPath, "", "utf8")
      const old = new Date(Date.now() - 40_000)
      await utimes(lockPath, old, old)

      // Must not be permanently unreclaimable: falls back to the lock
      // file's own mtime, which is well past LOCK_STALE_MS.
      await expect(s.update({ id: created.id, current: 7 })).resolves.toMatchObject({ current: 7 })
    })

    it("waits on a fresh empty lock file rather than stealing it (finding: malformed lock never stale)", async () => {
      const path = join(dir, "objectives.json")
      const s = new FileObjectiveStore(path)
      const seeded = await s.create(input({ title: "Seed" }))
      const lockPath = `${path}.lock`

      // Empty (unparseable) but freshly written -- e.g. another writer is
      // mid-`writeFile` on its own lock right now. mtime is "now", well
      // under the stale threshold, so this must be waited on, not treated
      // as a crash-abandoned lock.
      await writeFile(lockPath, "", "utf8")

      await expect(s.update({ id: seeded.id, current: 1 })).rejects.toMatchObject({
        code: OBJECTIVE_ERROR_CODES.LOCK_TIMEOUT,
      })

      await rm(lockPath, { force: true })
    }, 10_000)

    it("reclaims by atomically replacing lock content, so a resumed stale holder aborts instead of deleting the reclaimer's lock (finding: reclaim/release race)", async () => {
      const path = join(dir, "objectives.json")
      const s = new FileObjectiveStore(path)
      await s.create(input({ title: "Seed" }))
      const lockPath = `${path}.lock`

      // A crashed holder's stale lock.
      await writeFile(
        lockPath,
        JSON.stringify({ pid: 999_999, token: "dead-holder", timestamp: Date.now() - 60_000 }),
        "utf8",
      )

      type PrivateLockOps = {
        reclaimIfStale(lockPath: string, token: string): Promise<boolean>
        releaseLock(lockPath: string, token: string): Promise<void>
      }
      const ops = s as unknown as PrivateLockOps

      // A reclaimer takes over via atomic replace (temp file + rename),
      // never unlink+create.
      await expect(ops.reclaimIfStale(lockPath, "new-holder")).resolves.toBe(true)
      const afterReclaim = JSON.parse(await readFile(lockPath, "utf8"))
      expect(afterReclaim.token).toBe("new-holder")

      // The old (crashed) holder now "wakes up" and tries to release the
      // lock using its own stale token. It must fail its token re-verify
      // and leave the reclaimer's lock intact -- never unlink it out from
      // under the new holder.
      await ops.releaseLock(lockPath, "dead-holder")
      const stillIntact = JSON.parse(await readFile(lockPath, "utf8"))
      expect(stillIntact.token).toBe("new-holder")

      await rm(lockPath, { force: true })
    })

    it("rejects a symlinked lock path instead of following it (finding: lock path never symlink-checked)", async () => {
      const path = join(dir, "objectives.json")
      const s = new FileObjectiveStore(path)
      const created = await s.create(input({ title: "Seed" }))
      const lockPath = `${path}.lock`
      const outsideDir = await mkdtemp(join(tmpdir(), "objectives-lock-outside-"))
      const outsideFile = join(outsideDir, "hostile-lock.json")
      await writeFile(outsideFile, JSON.stringify({ pid: 1, token: "x", timestamp: Date.now() - 60_000 }), "utf8")
      await symlink(outsideFile, lockPath)

      await expect(s.update({ id: created.id, current: 5 })).rejects.toBeInstanceOf(WorkspacePathEscapeError)

      await rm(lockPath, { force: true })
      await rm(outsideDir, { recursive: true, force: true })
    })

    it("still honors the acquisition deadline even when the lock is stale and reclaimable (finding: reclamation bypasses deadline)", async () => {
      const path = join(dir, "objectives.json")
      const s = new FileObjectiveStore(path)
      const created = await s.create(input({ title: "Seed" }))
      const lockPath = `${path}.lock`
      await writeFile(
        lockPath,
        JSON.stringify({ pid: 999_999, token: "ancient", timestamp: Date.now() - 60_000 }),
        "utf8",
      )

      // The lock is genuinely stale and reclaimable, but the deadline has
      // already elapsed by the time acquireLock's loop re-checks it: the
      // first Date.now() call computes the real deadline, every call
      // after that reports far beyond it. Reclamation must not get a free
      // pass around the acquisition timeout.
      const realNow = Date.now.bind(Date)
      let calls = 0
      const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => {
        calls += 1
        return calls === 1 ? realNow() : realNow() + 60_000
      })

      await expect(s.update({ id: created.id, current: 1 })).rejects.toMatchObject({
        code: OBJECTIVE_ERROR_CODES.LOCK_TIMEOUT,
      })

      nowSpy.mockRestore()
      await rm(lockPath, { force: true })
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

    it("rejects an update whose merge with the existing record would exceed the aggregate cap, leaving the record unchanged and readable", async () => {
      const created = await store.create(input())

      // Each update payload here is, on its own, comfortably under the
      // 24 KiB aggregate cap (so UpdateObjectiveInputSchema's own
      // aggregate check on the *input* passes both times) — but merging
      // the second onto what the first already committed is not.
      const constraints = Array.from({ length: 50 }, () => "c".repeat(400))
      await store.update({ id: created.id, constraints })

      const evidenceRefs = Array.from({ length: 15 }, () => "e".repeat(300))
      await expect(store.update({ id: created.id, evidenceRefs })).rejects.toMatchObject({
        code: OBJECTIVE_ERROR_CODES.TOO_LARGE,
      })

      // The record stays exactly as the last successful update left it —
      // not partially written, not corrupted, still readable via get/list.
      const reread = await store.get(created.id)
      expect(reread?.constraints).toHaveLength(50)
      expect(reread?.evidenceRefs).toEqual([])
      await expect(store.list()).resolves.toHaveLength(1)
    })
  })
})

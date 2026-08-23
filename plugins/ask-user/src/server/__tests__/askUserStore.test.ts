// @vitest-environment node

import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ASK_USER_ERROR_CODES } from "../../shared/error-codes"
import type { AskUserQuestion } from "../../shared/types"
import { FileAskUserStore } from "../askUserStore"

let dir: string
let store: FileAskUserStore

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ask-user-store-"))
  store = new FileAskUserStore(join(dir, "ask-user.json"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function question(overrides: Partial<AskUserQuestion> = {}): AskUserQuestion {
  const now = new Date(0).toISOString()
  return {
    questionId: "q1",
    sessionId: "s1",
    ownerPrincipalId: "anonymous",
    status: "ready",
    title: "Question",
    context: "Context",
    schema: { wireVersion: 1, fields: [{ type: "text", name: "a", label: "A" }] },
    artifacts: [],
    answerToken: "token",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe("FileAskUserStore", () => {
  it("creates and reloads a pending question", async () => {
    await store.createPending(question())
    await expect(store.getPending("s1")).resolves.toMatchObject({ questionId: "q1", status: "ready" })

    const reloaded = new FileAskUserStore(join(dir, "ask-user.json"))
    await expect(reloaded.getByQuestionId("q1")).resolves.toMatchObject({ questionId: "q1", sessionId: "s1" })
    await expect(reloaded.getPending("s1")).resolves.toMatchObject({ questionId: "q1", sessionId: "s1", status: "ready" })
  })

  it("shares one initial load across concurrent first read/write callers", async () => {
    const initialRead = store.listPending()
    await Promise.all([
      initialRead,
      store.createPending(question()),
    ])
    await store.appendTranscriptEvent({ type: "created", question: question(), at: new Date(0).toISOString() })

    await expect(store.getPending("s1")).resolves.toMatchObject({ questionId: "q1", status: "ready" })
    const raw = JSON.parse(await readFile(join(dir, "ask-user.json"), "utf8"))
    expect(raw.questions.q1).toMatchObject({ sessionId: "s1", status: "ready" })
    expect(raw.transcriptsBySession.s1).toHaveLength(1)
  })

  it("enforces one pending question per session and persists multiple pending sessions", async () => {
    await store.createPending(question())
    await expect(store.createPending(question({ questionId: "q2" }))).rejects.toMatchObject({
      code: ASK_USER_ERROR_CODES.PENDING_EXISTS,
    })
    await expect(store.createPending(question({ questionId: "q3", sessionId: "s2" }))).resolves.toBeUndefined()

    await expect(store.getPending("s1")).resolves.toMatchObject({ questionId: "q1" })
    await expect(store.getPending("s2")).resolves.toMatchObject({ questionId: "q3" })
    const reloaded = new FileAskUserStore(join(dir, "ask-user.json"))
    await expect(reloaded.getPending("s1")).resolves.toMatchObject({ questionId: "q1" })
    await expect(reloaded.getPending("s2")).resolves.toMatchObject({ questionId: "q3" })
  })

  it("rejects answers that do not match the question/session", async () => {
    await store.createPending(question())
    await expect(store.answer("q1", { questionId: "other", sessionId: "s1", values: {}, submittedAt: new Date().toISOString() })).rejects.toMatchObject({
      code: ASK_USER_ERROR_CODES.SESSION_MISMATCH,
    })
    await expect(store.answer("q1", { questionId: "q1", sessionId: "other", values: {}, submittedAt: new Date().toISOString() })).rejects.toMatchObject({
      code: ASK_USER_ERROR_CODES.SESSION_MISMATCH,
    })
  })

  it("answers, cancels, and abandons with terminal state guards", async () => {
    await store.createPending(question())
    await store.answer("q1", { questionId: "q1", sessionId: "s1", values: { a: "ok" }, submittedAt: new Date().toISOString() })
    await expect(store.getPending("s1")).resolves.toBeNull()
    await expect(store.cancel("q1")).rejects.toMatchObject({ code: ASK_USER_ERROR_CODES.ALREADY_ANSWERED })

    await store.createPending(question({ questionId: "q2" }))
    await store.cancel("q2")
    await expect(store.answer("q2", { questionId: "q2", sessionId: "s1", values: {}, submittedAt: new Date().toISOString() })).rejects.toMatchObject({
      code: ASK_USER_ERROR_CODES.ALREADY_CANCELLED,
    })

    await store.createPending(question({ questionId: "q3" }))
    await store.markAbandoned("q3")
    await expect(store.getByQuestionId("q3")).resolves.toMatchObject({ status: "abandoned" })
  })

  it("restores abandoned questions to ready and persists the restore", async () => {
    await store.createPending(question())
    await store.markAbandoned("q1")
    await store.restoreAbandoned("q1")
    await expect(store.getPending("s1")).resolves.toMatchObject({ questionId: "q1", status: "ready" })

    const reloaded = new FileAskUserStore(join(dir, "ask-user.json"))
    await expect(reloaded.getPending("s1")).resolves.toMatchObject({ questionId: "q1", status: "ready" })

    // Restoring a live pending question is a no-op; restoring an answered or
    // cancelled question is rejected.
    await store.restoreAbandoned("q1")
    await store.answer("q1", { questionId: "q1", sessionId: "s1", values: { a: "ok" }, submittedAt: new Date().toISOString() })
    await expect(store.restoreAbandoned("q1")).rejects.toMatchObject({ code: ASK_USER_ERROR_CODES.ANSWER_INVALID })

    await store.createPending(question({ questionId: "q4" }))
    await store.cancel("q4")
    await expect(store.restoreAbandoned("q4")).rejects.toMatchObject({ code: ASK_USER_ERROR_CODES.ANSWER_INVALID })

    // One pending question per session is preserved across restores.
    await store.createPending(question({ questionId: "q5", sessionId: "s2" }))
    await store.markAbandoned("q5")
    await store.createPending(question({ questionId: "q6", sessionId: "s2" }))
    await expect(store.restoreAbandoned("q5")).rejects.toMatchObject({ code: ASK_USER_ERROR_CODES.PENDING_EXISTS })
  })

  it("builds a decision record from question + answer, snapshotting riskTier and resolvedBy", async () => {
    await store.createPending(question({ riskTier: "consequential" }))
    await expect(store.getAnswer("q1")).resolves.toBeNull()
    await expect(store.getDecisionRecord("q1")).resolves.toBeNull()

    const submittedAt = new Date("2026-08-22T00:00:00.000Z").toISOString()
    await store.answer("q1", {
      questionId: "q1",
      sessionId: "s1",
      values: { a: "approved" },
      submittedAt,
      riskTier: "consequential",
      resolvedBy: "user:owner",
    })

    await expect(store.getAnswer("q1")).resolves.toMatchObject({
      questionId: "q1",
      values: { a: "approved" },
      riskTier: "consequential",
      resolvedBy: "user:owner",
    })
    await expect(store.getDecisionRecord("q1")).resolves.toEqual({
      questionId: "q1",
      sessionId: "s1",
      title: "Question",
      values: { a: "approved" },
      riskTier: "consequential",
      resolvedAt: submittedAt,
      resolvedBy: "user:owner",
    })
  })

  it("still parses and serves pre-decision-record answers persisted before #1348 follow-up", async () => {
    // Simulate a store file written by an older version: no riskTier/resolvedBy
    // on the question or the answer.
    const filePath = join(dir, "ask-user.json")
    await mkdir(dir, { recursive: true })
    const legacyState = {
      questions: {
        q1: {
          questionId: "q1",
          sessionId: "s1",
          ownerPrincipalId: "anonymous",
          status: "answered",
          title: "Legacy question",
          artifacts: [],
          answerToken: "token",
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        },
      },
      pendingBySession: {},
      answers: {
        q1: {
          questionId: "q1",
          sessionId: "s1",
          values: { a: "ok" },
          submittedAt: new Date(0).toISOString(),
        },
      },
      transcriptsBySession: {},
    }
    await writeFile(filePath, JSON.stringify(legacyState, null, 2), "utf8")

    const legacyStore = new FileAskUserStore(filePath)
    const legacyQuestion = await legacyStore.getByQuestionId("q1")
    expect(legacyQuestion).toMatchObject({ questionId: "q1", status: "answered" })
    expect(legacyQuestion?.riskTier).toBeUndefined()
    const legacyAnswer = await legacyStore.getAnswer("q1")
    expect(legacyAnswer).toMatchObject({ questionId: "q1", values: { a: "ok" } })
    expect(legacyAnswer?.riskTier).toBeUndefined()
    expect(legacyAnswer?.resolvedBy).toBeUndefined()
    await expect(legacyStore.getDecisionRecord("q1")).resolves.toEqual({
      questionId: "q1",
      sessionId: "s1",
      title: "Legacy question",
      values: { a: "ok" },
      riskTier: undefined,
      resolvedAt: new Date(0).toISOString(),
      resolvedBy: undefined,
    })
  })

  it("emits changes for mutations", async () => {
    const listener = vi.fn()
    store.subscribe(listener)
    await store.createPending(question())
    await store.clearPending("s1")
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ reason: "create", questionId: "q1" }))
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ reason: "clear", questionId: "q1" }))
  })

  it("does not let listener failures roll back mutations", async () => {
    store.subscribe(() => { throw new Error("listener failed") })
    store.subscribe((() => Promise.reject(new Error("async listener failed"))) as never)
    await expect(store.createPending(question())).resolves.toBeUndefined()
    await expect(store.getPending("s1")).resolves.toMatchObject({ questionId: "q1" })
  })

  it("rejects an answer submitted after the persisted expiresAt (finding 1)", async () => {
    let clock = new Date("2026-08-22T00:00:00.000Z")
    const clockedStore = new FileAskUserStore(join(dir, "ask-user.json"), { now: () => clock })
    await clockedStore.createPending(question({ expiresAt: new Date("2026-08-22T00:10:00.000Z").toISOString() }))

    // Still within the window: answer succeeds.
    clock = new Date("2026-08-22T00:09:59.000Z")
    const before = new FileAskUserStore(join(dir, "ask-user2.json"), { now: () => clock })
    await before.createPending(question({ questionId: "q-ok", expiresAt: new Date("2026-08-22T00:10:00.000Z").toISOString() }))
    await expect(before.answer("q-ok", { questionId: "q-ok", sessionId: "s1", values: {}, submittedAt: clock.toISOString() })).resolves.toBeUndefined()

    // Past the window: answer is rejected, question stays ready.
    clock = new Date("2026-08-22T00:10:01.000Z")
    await expect(clockedStore.answer("q1", { questionId: "q1", sessionId: "s1", values: {}, submittedAt: clock.toISOString() })).rejects.toMatchObject({
      code: ASK_USER_ERROR_CODES.QUESTION_EXPIRED,
    })
    await expect(clockedStore.getByQuestionId("q1")).resolves.toMatchObject({ status: "ready" })
  })

  it("a stale writer cannot overwrite an answered record with cancellation (finding 3)", async () => {
    const filePath = join(dir, "ask-user.json")
    const storeA = new FileAskUserStore(filePath)
    const storeB = new FileAskUserStore(filePath)

    await storeA.createPending(question())
    // Both processes load the question as still `ready` before either mutates.
    await expect(storeA.getByQuestionId("q1")).resolves.toMatchObject({ status: "ready" })
    await expect(storeB.getByQuestionId("q1")).resolves.toMatchObject({ status: "ready" })

    // storeB (e.g. the new process after a restart) answers first.
    await storeB.answer("q1", { questionId: "q1", sessionId: "s1", values: { a: "final" }, submittedAt: new Date().toISOString() })

    // storeA is the stale writer (e.g. a timeout firing in the old process).
    // It must reread the current file, see "answered", and refuse to
    // overwrite it with "cancelled" rather than blindly persisting its own
    // stale in-memory view.
    await expect(storeA.cancel("q1")).rejects.toMatchObject({ code: ASK_USER_ERROR_CODES.ALREADY_ANSWERED })

    // The answer survives, from either store's point of view.
    await expect(storeA.getByQuestionId("q1")).resolves.toMatchObject({ status: "answered" })
    await expect(storeB.getByQuestionId("q1")).resolves.toMatchObject({ status: "answered" })
    const reloaded = new FileAskUserStore(filePath)
    await expect(reloaded.getByQuestionId("q1")).resolves.toMatchObject({ status: "answered" })
    await expect(reloaded.getAnswer("q1")).resolves.toMatchObject({ values: { a: "final" } })
  })

  it("bumps the on-disk revision on every mutation and survives concurrent writers via CAS retry", async () => {
    const filePath = join(dir, "ask-user.json")
    const storeA = new FileAskUserStore(filePath)
    const storeB = new FileAskUserStore(filePath)

    await storeA.createPending(question({ questionId: "qa", sessionId: "sa" }))
    // storeB's writeChain has never read this file; issuing a mutation forces
    // a fresh read + CAS write rather than trusting any stale cache.
    await storeB.createPending(question({ questionId: "qb", sessionId: "sb" }))

    await Promise.all([
      storeA.appendTranscriptEvent({ type: "abandoned", questionId: "qa", sessionId: "sa", at: new Date(1).toISOString() }),
      storeB.appendTranscriptEvent({ type: "abandoned", questionId: "qb", sessionId: "sb", at: new Date(2).toISOString() }),
    ])

    const raw = JSON.parse(await readFile(filePath, "utf8"))
    expect(raw.revision).toBeGreaterThanOrEqual(4)
    expect(raw.transcriptsBySession.sa).toHaveLength(1)
    expect(raw.transcriptsBySession.sb).toHaveLength(1)
  })

  it("skips a corrupt record on load and surfaces it via diagnostics instead of crashing (finding 5)", async () => {
    const filePath = join(dir, "ask-user.json")
    const corruptState = {
      version: 1,
      revision: 3,
      questions: {
        q1: question({ questionId: "q1" }),
        // Missing required fields entirely — corrupt/hand-edited record.
        broken: { questionId: "broken" },
      },
      pendingBySession: { s1: "q1" },
      answers: {},
      transcriptsBySession: {},
    }
    await mkdir(dir, { recursive: true })
    await writeFile(filePath, JSON.stringify(corruptState, null, 2), "utf8")

    const diagnostics: Array<{ type: string; kind?: string; id?: string }> = []
    const loaded = new FileAskUserStore(filePath, { onDiagnostic: (event) => diagnostics.push(event) })

    // The valid record still loads and is usable.
    await expect(loaded.getByQuestionId("q1")).resolves.toMatchObject({ status: "ready" })
    await expect(loaded.getPending("s1")).resolves.toMatchObject({ questionId: "q1" })
    // The corrupt record is skipped, not thrown.
    await expect(loaded.getByQuestionId("broken")).resolves.toBeNull()

    expect(diagnostics).toContainEqual(expect.objectContaining({ type: "invalid-record", kind: "question", id: "broken" }))
  })

  it("skips a legacy record with an invalid riskTier instead of crashing (finding 5)", async () => {
    const filePath = join(dir, "ask-user.json")
    const legacyState = {
      // No version/revision: pre-versioning legacy shape.
      questions: {
        q1: question({ questionId: "q1" }),
        q2: question({ questionId: "q2", sessionId: "s2", riskTier: "not-a-real-tier" as never }),
      },
      pendingBySession: { s1: "q1", s2: "q2" },
      answers: {},
      transcriptsBySession: {},
    }
    await mkdir(dir, { recursive: true })
    await writeFile(filePath, JSON.stringify(legacyState, null, 2), "utf8")

    const diagnostics: Array<{ type: string; kind?: string; id?: string }> = []
    const loaded = new FileAskUserStore(filePath, { onDiagnostic: (event) => diagnostics.push(event) })

    await expect(loaded.getByQuestionId("q1")).resolves.toMatchObject({ status: "ready" })
    await expect(loaded.getByQuestionId("q2")).resolves.toBeNull()
    await expect(loaded.getPending("s2")).resolves.toBeNull()
    expect(diagnostics).toContainEqual(expect.objectContaining({ type: "invalid-record", kind: "question", id: "q2" }))
  })

  it("migrates a pre-versioning legacy file (no version/revision) and can still write to it", async () => {
    const filePath = join(dir, "ask-user.json")
    const legacyState = {
      questions: { q1: question({ questionId: "q1" }) },
      pendingBySession: { s1: "q1" },
      answers: {},
      transcriptsBySession: {},
    }
    await mkdir(dir, { recursive: true })
    await writeFile(filePath, JSON.stringify(legacyState, null, 2), "utf8")

    const migrated = new FileAskUserStore(filePath)
    await migrated.answer("q1", { questionId: "q1", sessionId: "s1", values: { a: "ok" }, submittedAt: new Date().toISOString() })

    const raw = JSON.parse(await readFile(filePath, "utf8"))
    expect(raw.version).toBe(1)
    expect(typeof raw.revision).toBe("number")
    expect(raw.questions.q1.status).toBe("answered")
  })

  it("a paused lock holder that resumes after stale-lock reclamation fails safely without destroying the reclaimer's write (finding: stale-lock reclamation)", async () => {
    const filePath = join(dir, "ask-user.json")
    let clock = new Date("2026-08-22T00:00:00.000Z")
    const storeA = new FileAskUserStore(filePath, { now: () => clock, lockStaleMs: 1_000 })
    const storeB = new FileAskUserStore(filePath, { now: () => clock, lockStaleMs: 1_000 })
    const lockPath = `${filePath}.lock`

    await storeA.createPending(question({ questionId: "qa", sessionId: "sa" }))

    // storeA "acquires" the write lock (as tryPersist would, right before
    // its critical section) and then pauses -- GC, slow disk, a suspended
    // process -- for longer than lockStaleMs.
    const tokenA: string | null = await (storeA as unknown as { acquireOrReclaimLock(p: string): Promise<string | null> }).acquireOrReclaimLock(lockPath)
    expect(tokenA).toBeTruthy()
    clock = new Date(clock.getTime() + 2_000)

    // storeB (e.g. a fresh process after a restart) reclaims the now-stale
    // lock through the real public write path and commits its own mutation.
    await storeB.createPending(question({ questionId: "qb", sessionId: "sb" }))
    await expect(storeB.getByQuestionId("qb")).resolves.toMatchObject({ status: "ready" })

    // storeA resumes. Its token no longer matches what's on disk (storeB
    // reclaimed and already released it back to "no lock file"), so it must
    // detect the mismatch instead of blindly deleting whatever is there.
    const ownsLock = (storeA as unknown as { ownsLock(p: string, t: string): Promise<boolean> }).ownsLock.bind(storeA)
    await expect(ownsLock(lockPath, tokenA as string)).resolves.toBe(false)
    const releaseLockIfOwned = (storeA as unknown as { releaseLockIfOwned(p: string, t: string): Promise<void> }).releaseLockIfOwned.bind(storeA)
    await expect(releaseLockIfOwned(lockPath, tokenA as string)).resolves.toBeUndefined()

    // No data loss: storeB's committed write and storeA's own earlier write
    // both survive on disk.
    const raw = JSON.parse(await readFile(filePath, "utf8"))
    expect(raw.questions.qa).toBeTruthy()
    expect(raw.questions.qb).toBeTruthy()

    // storeA can still make further progress -- it is not permanently wedged
    // by having lost its paused lock; it simply rereads fresh state.
    await expect(storeA.cancel("qa")).resolves.toBeUndefined()
    await expect(storeA.getByQuestionId("qa")).resolves.toMatchObject({ status: "cancelled" })
  })

  it("reclaiming a stale lock never leaves a window with no lock file for a real committing writer to race past both mutations", async () => {
    const filePath = join(dir, "ask-user.json")
    let clock = new Date("2026-08-22T00:00:00.000Z")
    const store = new FileAskUserStore(filePath, { now: () => clock, lockStaleMs: 10 })
    await store.createPending(question({ questionId: "q1" }))

    // Seed a dead lock (simulating a crashed writer) that is already stale.
    const lockPath = `${filePath}.lock`
    await writeFile(lockPath, JSON.stringify({ token: "dead", pid: 999_999, acquiredAtMs: clock.getTime() - 1_000 }), "utf8")

    // A real mutation must still succeed by reclaiming the dead lock.
    await expect(store.answer("q1", { questionId: "q1", sessionId: "s1", values: { a: "ok" }, submittedAt: new Date().toISOString() })).resolves.toBeUndefined()
    await expect(store.getByQuestionId("q1")).resolves.toMatchObject({ status: "answered" })
  })

  it("reclaims an empty/malformed lock file that is stale by mtime instead of deadlocking forever (finding 1)", async () => {
    const filePath = join(dir, "ask-user.json")
    const store = new FileAskUserStore(filePath, { lockStaleMs: 50 })
    await store.createPending(question({ questionId: "q1" }))

    // Simulate a crash mid-write: the lock file exists but never finished
    // writing its content (empty), so it carries no parseable acquiredAtMs
    // for `readLockOwner` to compare against `lockStaleMs`.
    const lockPath = `${filePath}.lock`
    await writeFile(lockPath, "", "utf8")
    // Backdate its mtime past lockStaleMs so the fallback staleness check
    // (which cannot rely on a missing acquiredAtMs) judges it stale.
    const old = new Date(Date.now() - 1_000)
    await utimes(lockPath, old, old)

    // A real mutation must reclaim the malformed-but-stale lock rather than
    // being permanently blocked by a lock nobody will ever come back to
    // release.
    await expect(store.cancel("q1")).resolves.toBeUndefined()
    await expect(store.getByQuestionId("q1")).resolves.toMatchObject({ status: "cancelled" })
  })

  it("does not reclaim a malformed lock file that is still fresh by mtime -- it waits/retries instead (finding 1)", async () => {
    const filePath = join(dir, "ask-user.json")
    const store = new FileAskUserStore(filePath, { lockStaleMs: 60_000 })
    await store.createPending(question({ questionId: "q1" }))

    const lockPath = `${filePath}.lock`
    // A malformed lock with a fresh mtime (the default: "now") could still
    // be an active writer mid-write; it must not be reclaimed.
    await writeFile(lockPath, "", "utf8")

    const attempt = store.cancel("q1")
    // Give the CAS retry loop a chance to observe the fresh malformed lock
    // and back off (never reclaiming it), then release it the way the real
    // (slow) writer eventually would, letting the attempt complete normally.
    await new Promise((resolve) => setTimeout(resolve, 30))
    await expect(store.getByQuestionId("q1")).resolves.toMatchObject({ status: "ready" })
    await rm(lockPath, { force: true })
    await expect(attempt).resolves.toBeUndefined()
    await expect(store.getByQuestionId("q1")).resolves.toMatchObject({ status: "cancelled" })
  })

  it("notifies listeners only after a successful commit, using the committed state (finding: notify-after-commit)", async () => {
    const filePath = join(dir, "ask-user.json")
    const observing = new FileAskUserStore(filePath)
    const listener = vi.fn(async () => {
      // At the moment the listener fires, the mutation must already be
      // durable on disk -- not merely queued in an in-memory draft.
      const raw = JSON.parse(await readFile(filePath, "utf8"))
      expect(raw.questions.q1?.status).toBe("ready")
    })
    observing.subscribe(listener)

    await observing.createPending(question({ questionId: "q1" }))
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ reason: "create", questionId: "q1" }))
  })

  it("does not notify listeners for a mutation attempt that failed to persist (finding: notify-after-commit)", async () => {
    const filePath = join(dir, "ask-user.json")
    const store = new FileAskUserStore(filePath)
    await store.createPending(question({ questionId: "q1" }))

    const listener = vi.fn()
    store.subscribe(listener)

    // A write attempt that raises a business-rule error (not a CAS
    // conflict) never reaches tryPersist and must not notify.
    await expect(store.createPending(question({ questionId: "q2" }))).rejects.toMatchObject({
      code: ASK_USER_ERROR_CODES.PENDING_EXISTS,
    })
    expect(listener).not.toHaveBeenCalled()

    // Force every persist attempt to fail (simulating an injected write
    // failure) and confirm the retry loop's exhaustion never emits either.
    const alwaysFailingStore = new FileAskUserStore(filePath)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const spy = vi.spyOn(alwaysFailingStore as any, "tryPersist").mockResolvedValue(false)
    alwaysFailingStore.subscribe(listener)

    await expect(alwaysFailingStore.cancel("q1")).rejects.toMatchObject({ code: ASK_USER_ERROR_CODES.WRITE_CONFLICT })
    expect(listener).not.toHaveBeenCalled()

    spy.mockRestore()
  })

  it("honors the envelope version: refuses to load (and therefore rewrite) a file from a newer version (finding: envelope version)", async () => {
    const filePath = join(dir, "ask-user.json")
    await mkdir(dir, { recursive: true })
    await writeFile(filePath, JSON.stringify({ version: 2, revision: 5, questions: {}, pendingBySession: {}, answers: {}, transcriptsBySession: {} }, null, 2), "utf8")

    const diagnostics: Array<{ type: string; issues?: string }> = []
    const store = new FileAskUserStore(filePath, { onDiagnostic: (event) => diagnostics.push(event) })

    await expect(store.getByQuestionId("anything")).rejects.toMatchObject({ code: ASK_USER_ERROR_CODES.UNSUPPORTED_STORE_VERSION })
    expect(diagnostics).toContainEqual(expect.objectContaining({ type: "invalid-state" }))

    // The refusal is read-only: the file on disk is untouched (never
    // downgraded/rewritten as version 1).
    const raw = JSON.parse(await readFile(filePath, "utf8"))
    expect(raw.version).toBe(2)
  })

  it("recovers a question with an invalid persisted expiresAt as already-expired instead of dropping the record (finding: expiry validation)", async () => {
    const filePath = join(dir, "ask-user.json")
    const state = {
      version: 1,
      revision: 1,
      questions: {
        q1: { ...question({ questionId: "q1" }), expiresAt: "not-a-real-date" },
      },
      pendingBySession: { s1: "q1" },
      answers: {},
      transcriptsBySession: {},
    }
    await mkdir(dir, { recursive: true })
    await writeFile(filePath, JSON.stringify(state, null, 2), "utf8")

    const diagnostics: Array<{ type: string; kind?: string; id?: string; issues?: string }> = []
    const store = new FileAskUserStore(filePath, { onDiagnostic: (event) => diagnostics.push(event) })

    // The record is not dropped: it still loads.
    const loaded = await store.getByQuestionId("q1")
    expect(loaded).toMatchObject({ questionId: "q1", status: "ready" })
    expect(loaded?.expiresAt).toBeTruthy()
    expect(new Date(loaded!.expiresAt!).getTime()).toBeLessThan(Date.now())
    expect(diagnostics).toContainEqual(expect.objectContaining({ type: "invalid-record", kind: "question", id: "q1" }))

    // Fail closed: answering it is rejected as expired.
    await expect(store.answer("q1", { questionId: "q1", sessionId: "s1", values: {}, submittedAt: new Date().toISOString() })).rejects.toMatchObject({
      code: ASK_USER_ERROR_CODES.QUESTION_EXPIRED,
    })
  })

  it("listResolved returns only terminal-state questions, for startup transcript reconciliation", async () => {
    await store.createPending(question({ questionId: "q1" }))
    await store.createPending(question({ questionId: "q2", sessionId: "s2" }))
    await store.answer("q1", { questionId: "q1", sessionId: "s1", values: {}, submittedAt: new Date().toISOString() })
    await store.cancel("q2")
    await store.createPending(question({ questionId: "q3", sessionId: "s3" }))

    const resolved = await store.listResolved()
    expect(resolved.map((q) => q.questionId).sort()).toEqual(["q1", "q2"])
  })

  it("appends, lists, filters, and persists transcript events", async () => {
    await store.createPending(question())
    await store.appendTranscriptEvent({ type: "created", question: question(), at: new Date(0).toISOString() })
    await store.appendTranscriptEvent({ type: "abandoned", questionId: "other", sessionId: "s1", at: new Date(2).toISOString() })

    await expect(store.listTranscriptEvents("s1")).resolves.toHaveLength(2)
    await expect(store.getTranscriptEventsForQuestion("q1")).resolves.toHaveLength(1)

    const raw = JSON.parse(await readFile(join(dir, "ask-user.json"), "utf8"))
    expect(raw.transcriptsBySession.s1).toHaveLength(2)
  })
})

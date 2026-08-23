import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"
import type { ZodError } from "zod"
import { ASK_USER_ERROR_CODES } from "../shared/error-codes"
import { AskUserAnswerSchema, AskUserQuestionSchema, AskUserTranscriptEventSchema } from "../shared/schema"
import type {
  AskUserAnswer,
  AskUserDecisionRecord,
  AskUserQuestion,
  AskUserTranscriptEvent,
} from "../shared/types"

/**
 * Emitted when `FileAskUserStore` skips a record on load instead of
 * crashing (finding 5): a corrupt or hand-edited store file loses only the
 * invalid record, and the caller is told so via `onDiagnostic` rather than
 * the failure being silent.
 */
export type AskUserStoreDiagnosticEvent =
  | { type: "invalid-record"; kind: "question" | "answer" | "transcriptEvent"; id: string; issues: string }
  | { type: "invalid-state"; issues: string }

export type AskUserStoreDiagnosticListener = (event: AskUserStoreDiagnosticEvent) => void

export class AskUserStoreError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export type AskUserStoreChange = {
  sessionId: string
  questionId?: string
  reason: "create" | "answer" | "cancel" | "abandon" | "clear" | "transcript" | "restore"
}

export type AskUserStoreListener = (change: AskUserStoreChange) => void

export interface AskUserStore {
  getPending(sessionId: string): Promise<AskUserQuestion | null>
  listPending(): Promise<AskUserQuestion[]>
  getByQuestionId(questionId: string): Promise<AskUserQuestion | null>
  createPending(question: AskUserQuestion): Promise<void>
  answer(questionId: string, answer: AskUserAnswer): Promise<void>
  /** The persisted answer for a resolved question, if any. */
  getAnswer(questionId: string): Promise<AskUserAnswer | null>
  /**
   * Thin durable decision record (#1348 follow-up): question + answer merged
   * into the {riskTier, decision snapshot, resolvedAt, resolvedBy} shape.
   * Returns null until the question is answered.
   */
  getDecisionRecord(questionId: string): Promise<AskUserDecisionRecord | null>
  /**
   * All questions in a terminal state (answered/cancelled/abandoned), used
   * for startup reconciliation against the transcript audit log (finding:
   * state transition and transcript-event writes are separate durable
   * writes, so a crash between them can leave a question resolved with no
   * matching audit event).
   */
  listResolved(): Promise<AskUserQuestion[]>
  cancel(questionId: string): Promise<void>
  /**
   * Compare-and-set transition: abandons a `ready` question and returns
   * whether this call performed the transition. Returns `false` (no-op,
   * no error) when the question is no longer `ready` — e.g. it was
   * concurrently answered or cancelled — so callers never append an
   * "abandoned" audit event for a question that actually resolved another
   * way.
   */
  markAbandoned(questionId: string): Promise<boolean>
  /**
   * Flips an abandoned question back to `ready` (#1348 recovery).
   * Compare-and-set: returns whether this call performed the transition.
   * Returns `false` when the question is already `ready` (no-op); throws
   * for any other non-`abandoned` status, which is operator error rather
   * than a benign race.
   */
  restoreAbandoned(questionId: string): Promise<boolean>
  clearPending(sessionId: string): Promise<void>
  appendTranscriptEvent(event: AskUserTranscriptEvent): Promise<void>
  /**
   * Atomic check-and-append for reconciliation (finding: a caller doing its
   * own read-then-append outside the store's lock races concurrent
   * reconciliation runs into appending duplicate synthetic events). Runs
   * `hasMatchingEvent` against this question's transcript events, and
   * `buildEvent` (only if it returns `false`) to produce the event to
   * append, all inside one mutation attempt under the store's write lock/CAS
   * -- so two concurrent callers can never both observe "missing" and both
   * append. Returns whether an event was appended.
   */
  appendTranscriptEventIfMissing(
    questionId: string,
    hasMatchingEvent: (events: AskUserTranscriptEvent[]) => boolean,
    buildEvent: () => AskUserTranscriptEvent,
  ): Promise<boolean>
  listTranscriptEvents(sessionId: string): Promise<AskUserTranscriptEvent[]>
  getTranscriptEventsForQuestion(questionId: string): Promise<AskUserTranscriptEvent[]>
  subscribe(listener: AskUserStoreListener): () => void
}

export const STORED_ASK_USER_STATE_VERSION = 1 as const

/**
 * On-disk envelope. `revision` is a monotonically increasing counter bumped
 * on every successful write, used as an optimistic-concurrency token
 * (finding 3): a writer rereads the file immediately before renaming its
 * candidate into place and aborts (retrying against the fresh state) if the
 * on-disk revision moved since it started, so a stale process can never
 * blindly clobber a record another process already mutated.
 */
export type StoredAskUserState = {
  version: number
  revision: number
  questions: Record<string, AskUserQuestion>
  pendingBySession: Record<string, string>
  answers: Record<string, AskUserAnswer>
  transcriptsBySession: Record<string, AskUserTranscriptEvent[]>
}

function emptyState(): StoredAskUserState {
  return {
    version: STORED_ASK_USER_STATE_VERSION,
    revision: 0,
    questions: {},
    pendingBySession: {},
    answers: {},
    transcriptsBySession: {},
  }
}

const MAX_WRITE_ATTEMPTS = 25
const DEFAULT_LOCK_STALE_MS = 15_000

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** The outcome of one in-memory mutation attempt, before it is known to have persisted. */
type MutationOutcome<T> = { result: T; change?: AskUserStoreChange }

type LockOwner = { token: string; acquiredAtMs: number }

export class FileAskUserStore implements AskUserStore {
  private state: StoredAskUserState | null = null
  private loadInFlight: Promise<StoredAskUserState> | null = null
  private writeChain = Promise.resolve()
  private readonly listeners = new Set<AskUserStoreListener>()
  private readonly now: () => Date
  private readonly onDiagnostic?: AskUserStoreDiagnosticListener
  private readonly lockStaleMs: number

  constructor(
    private readonly filePath: string,
    options: { now?: () => Date; onDiagnostic?: AskUserStoreDiagnosticListener; lockStaleMs?: number } = {},
  ) {
    this.now = options.now ?? (() => new Date())
    this.onDiagnostic = options.onDiagnostic
    this.lockStaleMs = options.lockStaleMs ?? DEFAULT_LOCK_STALE_MS
  }

  async getPending(sessionId: string): Promise<AskUserQuestion | null> {
    const state = await this.load()
    const questionId = state.pendingBySession[sessionId]
    if (!questionId) return null
    const question = state.questions[questionId]
    if (!question || !isPending(question)) return null
    return clone(question)
  }

  async listPending(): Promise<AskUserQuestion[]> {
    const state = await this.load()
    return Object.values(state.pendingBySession)
      .map((questionId) => state.questions[questionId])
      .filter(isPending)
      .map((question) => clone(question))
  }

  async getByQuestionId(questionId: string): Promise<AskUserQuestion | null> {
    const state = await this.load()
    return state.questions[questionId] ? clone(state.questions[questionId]) : null
  }

  async getAnswer(questionId: string): Promise<AskUserAnswer | null> {
    const state = await this.load()
    return state.answers[questionId] ? clone(state.answers[questionId]) : null
  }

  async getDecisionRecord(questionId: string): Promise<AskUserDecisionRecord | null> {
    const state = await this.load()
    const question = state.questions[questionId]
    const answer = state.answers[questionId]
    if (!question || !answer) return null
    return buildDecisionRecord(question, answer)
  }

  async listResolved(): Promise<AskUserQuestion[]> {
    const state = await this.load()
    return Object.values(state.questions)
      .filter((question) => question.status !== "ready")
      .map((question) => clone(question))
  }

  async createPending(question: AskUserQuestion): Promise<void> {
    await this.mutate(async (state) => {
      const existing = state.pendingBySession[question.sessionId]
      if (existing && isPending(state.questions[existing])) {
        throw new AskUserStoreError(ASK_USER_ERROR_CODES.PENDING_EXISTS, "a pending question already exists for this session")
      }
      state.questions[question.questionId] = clone(question)
      if (isPending(question)) state.pendingBySession[question.sessionId] = question.questionId
      return { result: undefined, change: { sessionId: question.sessionId, questionId: question.questionId, reason: "create" } }
    })
  }

  async answer(questionId: string, answer: AskUserAnswer): Promise<void> {
    await this.mutate(async (state) => {
      const question = requireQuestion(state, questionId)
      if (answer.questionId !== questionId || answer.sessionId !== question.sessionId) {
        throw new AskUserStoreError(ASK_USER_ERROR_CODES.SESSION_MISMATCH, "answer does not match question/session")
      }
      if (question.status === "cancelled") throw new AskUserStoreError(ASK_USER_ERROR_CODES.ALREADY_CANCELLED, "question already cancelled")
      if (question.status === "answered") throw new AskUserStoreError(ASK_USER_ERROR_CODES.ALREADY_ANSWERED, "question already answered")
      if (question.status !== "ready") throw new AskUserStoreError(ASK_USER_ERROR_CODES.ANSWER_INVALID, "question is not ready")
      if (question.expiresAt && this.now().getTime() >= new Date(question.expiresAt).getTime()) {
        throw new AskUserStoreError(ASK_USER_ERROR_CODES.QUESTION_EXPIRED, "question has expired")
      }
      question.status = "answered"
      question.updatedAt = nowIso()
      state.answers[questionId] = clone(answer)
      delete state.pendingBySession[question.sessionId]
      return { result: undefined, change: { sessionId: question.sessionId, questionId, reason: "answer" } }
    })
  }

  async cancel(questionId: string): Promise<void> {
    await this.mutate(async (state) => {
      const question = requireQuestion(state, questionId)
      if (question.status === "answered") throw new AskUserStoreError(ASK_USER_ERROR_CODES.ALREADY_ANSWERED, "question already answered")
      if (question.status === "cancelled") throw new AskUserStoreError(ASK_USER_ERROR_CODES.ALREADY_CANCELLED, "question already cancelled")
      if (!isPending(question)) throw new AskUserStoreError(ASK_USER_ERROR_CODES.QUESTION_NOT_FOUND, "question is not pending")
      question.status = "cancelled"
      question.updatedAt = nowIso()
      delete state.pendingBySession[question.sessionId]
      return { result: undefined, change: { sessionId: question.sessionId, questionId, reason: "cancel" } }
    })
  }

  async markAbandoned(questionId: string): Promise<boolean> {
    return this.mutate(async (state) => {
      const question = requireQuestion(state, questionId)
      if (!isPending(question)) return { result: false }
      question.status = "abandoned"
      question.updatedAt = nowIso()
      delete state.pendingBySession[question.sessionId]
      return { result: true, change: { sessionId: question.sessionId, questionId, reason: "abandon" } }
    })
  }

  async restoreAbandoned(questionId: string): Promise<boolean> {
    return this.mutate(async (state) => {
      const question = requireQuestion(state, questionId)
      if (question.status === "ready") return { result: false }
      if (question.status !== "abandoned") {
        throw new AskUserStoreError(ASK_USER_ERROR_CODES.ANSWER_INVALID, `question ${questionId} is not abandoned`)
      }
      const existing = state.pendingBySession[question.sessionId]
      if (existing && existing !== questionId && isPending(state.questions[existing])) {
        throw new AskUserStoreError(ASK_USER_ERROR_CODES.PENDING_EXISTS, "a pending question already exists for this session")
      }
      question.status = "ready"
      question.updatedAt = nowIso()
      state.pendingBySession[question.sessionId] = questionId
      return { result: true, change: { sessionId: question.sessionId, questionId, reason: "restore" } }
    })
  }

  async clearPending(sessionId: string): Promise<void> {
    await this.mutate(async (state) => {
      const questionId = state.pendingBySession[sessionId]
      if (!questionId) return { result: undefined }
      delete state.pendingBySession[sessionId]
      return { result: undefined, change: { sessionId, questionId, reason: "clear" } }
    })
  }

  async appendTranscriptEvent(event: AskUserTranscriptEvent): Promise<void> {
    await this.mutate(async (state) => {
      const sessionId = transcriptSessionId(event)
      state.transcriptsBySession[sessionId] = [...(state.transcriptsBySession[sessionId] ?? []), clone(event)]
      return { result: undefined, change: { sessionId, questionId: transcriptQuestionId(event), reason: "transcript" } }
    })
  }

  async appendTranscriptEventIfMissing(
    questionId: string,
    hasMatchingEvent: (events: AskUserTranscriptEvent[]) => boolean,
    buildEvent: () => AskUserTranscriptEvent,
  ): Promise<boolean> {
    return this.mutate(async (state) => {
      const events = Object.values(state.transcriptsBySession)
        .flat()
        .filter((event) => transcriptQuestionId(event) === questionId)
      if (hasMatchingEvent(events)) return { result: false }
      const event = buildEvent()
      const sessionId = transcriptSessionId(event)
      state.transcriptsBySession[sessionId] = [...(state.transcriptsBySession[sessionId] ?? []), clone(event)]
      return { result: true, change: { sessionId, questionId: transcriptQuestionId(event), reason: "transcript" } }
    })
  }

  async listTranscriptEvents(sessionId: string): Promise<AskUserTranscriptEvent[]> {
    const state = await this.load()
    return clone(state.transcriptsBySession[sessionId] ?? [])
  }

  async getTranscriptEventsForQuestion(questionId: string): Promise<AskUserTranscriptEvent[]> {
    const state = await this.load()
    const events = Object.values(state.transcriptsBySession).flat().filter((event) => transcriptQuestionId(event) === questionId)
    return clone(events)
  }

  subscribe(listener: AskUserStoreListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private async mutate<T>(fn: (state: StoredAskUserState) => Promise<MutationOutcome<T>> | MutationOutcome<T>): Promise<T> {
    const run = this.writeChain.then(() => this.mutateWithRetry(fn))
    this.writeChain = run.then(() => undefined, () => undefined)
    return run
  }

  /**
   * All mutations are serialized within this instance via `writeChain`
   * (unchanged), but that alone does not protect against a second
   * `FileAskUserStore` instance backed by the same file — e.g. a stale
   * process that has not yet noticed a restart. `mutateWithRetry` rereads
   * the file fresh (never the in-memory cache) at the start of every
   * attempt, so a stale writer immediately observes any transition another
   * process already committed and its own guard clauses (already
   * answered/cancelled/etc.) reject the mutation, rather than clobbering a
   * record based on stale cached state (finding 3).
   *
   * Change notifications are emitted here, exactly once, only for the
   * attempt that actually persisted (finding: notify-after-commit). `fn`
   * returns its change descriptor instead of calling `emit` itself, so a
   * failed CAS attempt -- including one whose `fn` ran to completion before
   * losing the race -- can never produce a listener notification, and a
   * listener is never told about state that only exists in an in-memory
   * draft that was thrown away.
   */
  private async mutateWithRetry<T>(fn: (state: StoredAskUserState) => Promise<MutationOutcome<T>> | MutationOutcome<T>): Promise<T> {
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
      const onDisk = await this.readFresh()
      const draft = clone(onDisk)
      const outcome = await fn(draft)
      draft.revision = onDisk.revision + 1
      const persisted = await this.tryPersist(draft, onDisk.revision)
      if (persisted) {
        this.state = draft
        if (outcome.change) this.emit(outcome.change)
        return outcome.result
      }
      // Another writer (a second FileAskUserStore instance backed by the
      // same file, e.g. a stale process) committed between our read and our
      // write attempt, or is currently holding the write lock. Back off
      // briefly and retry against the now-current on-disk state. Nothing
      // was emitted for this attempt.
      await delay(Math.min(2 ** attempt, 20))
    }
    throw new AskUserStoreError(
      ASK_USER_ERROR_CODES.WRITE_CONFLICT,
      `gave up writing ${this.filePath} after ${MAX_WRITE_ATTEMPTS} conflicting concurrent writes`,
    )
  }

  /** Reads for getters may serve the in-memory cache; the first read populates it. */
  private async load(): Promise<StoredAskUserState> {
    if (this.state) return this.state
    if (!this.loadInFlight) {
      this.loadInFlight = this.readFresh().finally(() => {
        this.loadInFlight = null
      })
    }
    return this.loadInFlight
  }

  /** Always hits disk, bypassing the cache; used by mutations and CAS checks. */
  private async readFresh(): Promise<StoredAskUserState> {
    const state = await this.readFromDisk()
    this.state = state
    return state
  }

  private async readFromDisk(): Promise<StoredAskUserState> {
    try {
      const raw = await readFile(this.filePath, "utf8")
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch (error) {
        this.reportDiagnostic({ type: "invalid-state", issues: `invalid JSON: ${(error as Error).message}` })
        return emptyState()
      }
      return this.validateStoredState(parsed)
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") throw error
      return emptyState()
    }
  }

  /**
   * Validates the raw parsed file record-by-record with zod (finding 5)
   * instead of casting it directly into internal state. Also migrates the
   * pre-versioning legacy shape (no `version`/`revision` fields) by
   * stamping defaults. An invalid individual question/answer/transcript
   * event is skipped and reported via `onDiagnostic`; it never crashes the
   * load or corrupts the rest of the state.
   */
  private validateStoredState(raw: unknown): StoredAskUserState {
    if (!isRecord(raw)) {
      this.reportDiagnostic({ type: "invalid-state", issues: "stored state is not an object" })
      return emptyState()
    }

    // Finding 4: honor the envelope version. A file written by a newer
    // process may contain fields/shapes this (older) process does not
    // understand; loading it anyway and later persisting our incomplete view
    // back as version 1 would silently downgrade/drop that newer data. Refuse
    // outright -- this process cannot load, and therefore cannot ever
    // rewrite, a file whose declared version it does not support.
    if (typeof raw.version === "number" && raw.version > STORED_ASK_USER_STATE_VERSION) {
      this.reportDiagnostic({
        type: "invalid-state",
        issues: `store file version ${raw.version} is newer than the version this process supports (${STORED_ASK_USER_STATE_VERSION}); refusing to load or rewrite it`,
      })
      throw new AskUserStoreError(
        ASK_USER_ERROR_CODES.UNSUPPORTED_STORE_VERSION,
        `${this.filePath} has version ${raw.version}, which is newer than the ${STORED_ASK_USER_STATE_VERSION} this process supports; refusing to read it to avoid rewriting it as an older version`,
      )
    }

    const revision = typeof raw.revision === "number" && Number.isInteger(raw.revision) ? raw.revision : 0

    const questions: StoredAskUserState["questions"] = {}
    for (const [id, value] of Object.entries(isRecord(raw.questions) ? raw.questions : {})) {
      const parsed = AskUserQuestionSchema.safeParse(value)
      if (parsed.success) {
        questions[id] = parsed.data as AskUserQuestion
        continue
      }
      // Finding 5: a malformed `expiresAt` is the one field we recover from
      // rather than dropping the whole record. Fail closed instead of
      // losing the question: force it to an already-past sentinel so
      // startup/answer-time expiry enforcement treats it as expired, and
      // surface a diagnostic either way.
      const recovered = recoverQuestionWithInvalidExpiry(value, parsed.error)
      if (recovered) {
        questions[id] = recovered
        this.reportDiagnostic({
          type: "invalid-record",
          kind: "question",
          id,
          issues: `expiresAt invalid, question forced to already-expired: ${summarizeIssues(parsed.error)}`,
        })
      } else {
        this.reportDiagnostic({ type: "invalid-record", kind: "question", id, issues: summarizeIssues(parsed.error) })
      }
    }

    const answers: StoredAskUserState["answers"] = {}
    for (const [id, value] of Object.entries(isRecord(raw.answers) ? raw.answers : {})) {
      const parsed = AskUserAnswerSchema.safeParse(value)
      if (parsed.success) answers[id] = parsed.data as AskUserAnswer
      else this.reportDiagnostic({ type: "invalid-record", kind: "answer", id, issues: summarizeIssues(parsed.error) })
    }

    const transcriptsBySession: StoredAskUserState["transcriptsBySession"] = {}
    for (const [sessionId, events] of Object.entries(isRecord(raw.transcriptsBySession) ? raw.transcriptsBySession : {})) {
      if (!Array.isArray(events)) {
        this.reportDiagnostic({ type: "invalid-record", kind: "transcriptEvent", id: sessionId, issues: "session transcript is not an array" })
        continue
      }
      const valid: AskUserTranscriptEvent[] = []
      events.forEach((event, index) => {
        const parsed = AskUserTranscriptEventSchema.safeParse(event)
        if (parsed.success) valid.push(parsed.data as AskUserTranscriptEvent)
        else this.reportDiagnostic({ type: "invalid-record", kind: "transcriptEvent", id: `${sessionId}[${index}]`, issues: summarizeIssues(parsed.error) })
      })
      transcriptsBySession[sessionId] = valid
    }

    // Dangling pendingBySession entries (pointing at a skipped/missing
    // question) are dropped rather than surfaced as pending.
    const pendingBySession: StoredAskUserState["pendingBySession"] = {}
    for (const [sessionId, questionId] of Object.entries(isRecord(raw.pendingBySession) ? raw.pendingBySession : {})) {
      if (typeof questionId === "string" && questions[questionId]) pendingBySession[sessionId] = questionId
    }

    return { version: STORED_ASK_USER_STATE_VERSION, revision, questions, pendingBySession, answers, transcriptsBySession }
  }

  private reportDiagnostic(event: AskUserStoreDiagnosticEvent): void {
    try {
      this.onDiagnostic?.(event)
    } catch {
      // Diagnostics must never break loading.
    }
  }

  /**
   * Finding 1: stale-lock reclamation must not destroy mutual exclusion.
   * The lock file carries an owner token; `acquireOrReclaimLock` reclaims a
   * stale lock by replacing its content with a fresh token rather than
   * deleting it, and the caller re-verifies token ownership immediately
   * before the atomic rename (`ownsLock`) and again in `releaseLockIfOwned`
   * (read-verify-delete). A holder that merely paused past the staleness
   * window -- GC, slow disk, a suspended process, not necessarily a crash --
   * therefore detects on resume that another writer reclaimed the lock and
   * aborts this attempt (falling through to the caller's CAS retry loop)
   * instead of blindly deleting the reclaimer's lock or racing it to rename.
   */
  private async tryPersist(candidate: StoredAskUserState, expectedRevision: number): Promise<boolean> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const lockPath = `${this.filePath}.lock`
    const token = await this.acquireOrReclaimLock(lockPath)
    if (!token) return false
    try {
      const current = await this.readFromDisk()
      if (current.revision !== expectedRevision) return false
      const tmp = join(dirname(this.filePath), `.${randomUUID()}.tmp`)
      await writeFile(tmp, JSON.stringify(candidate, null, 2), "utf8")
      // Re-verify immediately before the irreversible commit: this is the
      // window a paused holder can lose the lock to a stale-lock reclaim.
      if (!(await this.ownsLock(lockPath, token))) {
        await rm(tmp, { force: true }).catch(() => undefined)
        return false
      }
      await rename(tmp, this.filePath)
      return true
    } finally {
      await this.releaseLockIfOwned(lockPath, token)
    }
  }

  /**
   * Exclusive-create acquire; on EEXIST, reclaims a lock whose recorded
   * `acquiredAtMs` (per this store's injectable clock, not wall-clock file
   * mtime, so staleness is deterministically testable) is older than
   * `lockStaleMs`. Reclaiming replaces the lock file's content with a new
   * token via a tmp-file + rename rather than deleting-then-recreating, so
   * there is never a window with no lock file at all for a third writer to
   * slip through. Residual window: two reclaimers can race the replace
   * itself; both then re-verify via `ownsLock` before committing, so at
   * most one of them proceeds and the other safely aborts and retries.
   */
  private async acquireOrReclaimLock(lockPath: string): Promise<string | null> {
    const token = randomUUID()
    const payload = JSON.stringify({ token, pid: process.pid, acquiredAtMs: this.now().getTime() } satisfies LockOwner & { pid: number })
    try {
      const handle = await open(lockPath, "wx")
      try {
        await handle.writeFile(payload, "utf8")
      } finally {
        await handle.close()
      }
      return token
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") throw error
      const existing = await this.readLockOwner(lockPath)
      // Finding: a lock file that is empty, truncated, or otherwise fails to
      // parse (e.g. a crash mid-write left a partial file) has no
      // `acquiredAtMs` for `readLockOwner` to return, so it comes back
      // `null`. Treating "unparseable" as "not stale" would make such a lock
      // permanently unreclaimable -- a deadlock forever, since no owner will
      // ever return to release a lock it never finished writing. Fall back
      // to the lock file's own mtime in that case: still-fresh (another
      // writer plausibly mid-write) is left alone; older than `lockStaleMs`
      // is reclaimed exactly like a parseable-but-stale lock.
      const isStale = existing
        ? this.now().getTime() - existing.acquiredAtMs > this.lockStaleMs
        : await this.isLockFileStaleByMtime(lockPath)
      if (!isStale) return null
      try {
        const tmp = `${lockPath}.${randomUUID()}.reclaim`
        await writeFile(tmp, payload, "utf8")
        await rename(tmp, lockPath)
        return token
      } catch {
        return null
      }
    }
  }

  /**
   * Fallback staleness check for a lock file whose contents could not be
   * parsed into a `LockOwner`. Uses the lock file's own mtime against the
   * injectable clock instead of an `acquiredAtMs` field it does not have. If
   * the file has vanished by the time we `stat` it (e.g. the holder released
   * concurrently, or a racing reclaimer already replaced it), it is treated
   * as not-stale here -- safe, since the caller then simply returns `null`
   * and the outer CAS retry loop observes the current on-disk lock state on
   * its next pass rather than this call racing a reclaim blindly.
   */
  private async isLockFileStaleByMtime(lockPath: string): Promise<boolean> {
    try {
      const info = await stat(lockPath)
      return this.now().getTime() - info.mtimeMs > this.lockStaleMs
    } catch {
      return false
    }
  }

  private async readLockOwner(lockPath: string): Promise<LockOwner | null> {
    try {
      const raw = await readFile(lockPath, "utf8")
      const parsed = JSON.parse(raw) as { token?: unknown; acquiredAtMs?: unknown }
      if (typeof parsed.token === "string" && typeof parsed.acquiredAtMs === "number") {
        return { token: parsed.token, acquiredAtMs: parsed.acquiredAtMs }
      }
      return null
    } catch {
      return null
    }
  }

  private async ownsLock(lockPath: string, token: string): Promise<boolean> {
    const owner = await this.readLockOwner(lockPath)
    return owner?.token === token
  }

  /** Read-verify-delete: only removes the lock file if it still carries our token. */
  private async releaseLockIfOwned(lockPath: string, token: string): Promise<void> {
    if (await this.ownsLock(lockPath, token)) {
      await rm(lockPath, { force: true }).catch(() => undefined)
    }
  }

  private emit(change: AskUserStoreChange): void {
    for (const listener of this.listeners) {
      try {
        const result = listener(change) as unknown
        if (isPromiseLike(result)) result.catch(() => undefined)
      } catch {
        // Store mutations must not be rolled back because an observer failed.
      }
    }
  }
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return !!value && typeof value === "object" && "catch" in value && typeof value.catch === "function"
}

export function buildDecisionRecord(question: AskUserQuestion, answer: AskUserAnswer): AskUserDecisionRecord {
  return {
    questionId: question.questionId,
    sessionId: question.sessionId,
    title: question.title,
    values: clone(answer.values),
    riskTier: answer.riskTier ?? question.riskTier,
    resolvedAt: answer.submittedAt,
    resolvedBy: answer.resolvedBy,
  }
}

function isPending(question: AskUserQuestion | undefined): question is AskUserQuestion {
  return question?.status === "ready"
}

function requireQuestion(state: StoredAskUserState, questionId: string): AskUserQuestion {
  const question = state.questions[questionId]
  if (!question) throw new AskUserStoreError(ASK_USER_ERROR_CODES.QUESTION_NOT_FOUND, `question ${questionId} not found`)
  return question
}

function transcriptSessionId(event: AskUserTranscriptEvent): string {
  switch (event.type) {
    case "created": return event.question.sessionId
    case "answered": return event.answer.sessionId
    default: return event.sessionId
  }
}

function transcriptQuestionId(event: AskUserTranscriptEvent): string {
  switch (event.type) {
    case "created": return event.question.questionId
    case "answered": return event.answer.questionId
    default: return event.questionId
  }
}

/** A fixed, always-in-the-past timestamp used to force an unparseable persisted `expiresAt` into "already expired" rather than dropping the whole question. */
const EXPIRED_SENTINEL_ISO = "1970-01-01T00:00:00.000Z"

/**
 * Finding 5 recovery path: if a question record fails schema validation
 * *solely* because of its `expiresAt` field, retry validation with
 * `expiresAt` forced to a sentinel that is unconditionally in the past. This
 * keeps the rest of the record (and the gate it represents) instead of
 * silently dropping it, while guaranteeing downstream expiry enforcement
 * treats it as expired (fail-closed) rather than serving a corrupt deadline.
 */
function recoverQuestionWithInvalidExpiry(value: unknown, error: ZodError): AskUserQuestion | null {
  if (!isRecord(value)) return null
  if (!error.issues.every((issue) => issue.path.length === 1 && issue.path[0] === "expiresAt")) return null
  const retried = AskUserQuestionSchema.safeParse({ ...value, expiresAt: EXPIRED_SENTINEL_ISO })
  return retried.success ? (retried.data as AskUserQuestion) : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function summarizeIssues(error: ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ")
}

function nowIso(): string {
  return new Date().toISOString()
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

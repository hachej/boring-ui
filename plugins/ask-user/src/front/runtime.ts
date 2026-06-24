import { createContext, useContext } from "react"
import type { AskUserQuestion } from "../shared/types"
import type { PendingQuestionHint } from "./client"

export type QuestionsStore = {
  getPending(sessionId: string | null | undefined): AskUserQuestion | null
  setPending(question: AskUserQuestion | null, sessionId?: string | null): void
  getPendingHints(): PendingQuestionHint[]
  getHydratedPendingKeys(): string[]
  setPendingHints(hints: PendingQuestionHint[]): void
  subscribe(listener: () => void): () => void
}

export type QuestionsRuntime = QuestionsStore & {
  apiBaseUrl: string
  authHeaders?: Record<string, string>
  activeSessionId?: string | null
  openSessionIds?: readonly string[]
  refreshPending(sessionId: string): Promise<AskUserQuestion | null>
}

export function createQuestionsStore(): QuestionsStore {
  const listeners = new Set<() => void>()
  const pendingBySession = new Map<string, AskUserQuestion>()
  const hintsBySession = new Map<string, PendingQuestionHint>()
  const emit = () => { for (const listener of [...listeners]) listener() }
  return {
    getPending(sessionId) {
      return sessionId ? pendingBySession.get(sessionId) ?? null : null
    },
    setPending(question, sessionId) {
      if (question) {
        pendingBySession.set(question.sessionId, question)
        hintsBySession.set(question.sessionId, { questionId: question.questionId, sessionId: question.sessionId, status: question.status })
      } else if (sessionId) {
        pendingBySession.delete(sessionId)
        hintsBySession.delete(sessionId)
      } else {
        pendingBySession.clear()
        hintsBySession.clear()
      }
      emit()
    },
    getPendingHints() {
      return [...hintsBySession.values()]
    },
    getHydratedPendingKeys() {
      return [...pendingBySession.values()].map((question) => `${question.sessionId}:${question.questionId}:${question.status}`)
    },
    setPendingHints(hints) {
      hintsBySession.clear()
      const authoritativeHints = new Map<string, PendingQuestionHint>()
      for (const hint of hints) {
        hintsBySession.set(hint.sessionId, hint)
        authoritativeHints.set(hint.sessionId, hint)
      }
      for (const [sessionId, question] of [...pendingBySession.entries()]) {
        const hint = authoritativeHints.get(sessionId)
        if (!hint || hint.questionId !== question.questionId || (hint.status && hint.status !== question.status)) {
          pendingBySession.delete(sessionId)
        }
      }
      emit()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

// Singleton store at module scope so command predicates and provider remounts
// see the same pending-question cache. The provider mounts this instance into
// its runtime context.
export const sharedQuestionsStore: QuestionsStore = createQuestionsStore()

export const QuestionsRuntimeContext = createContext<QuestionsRuntime | null>(null)

export function useQuestionsRuntime(): QuestionsRuntime {
  const ctx = useContext(QuestionsRuntimeContext)
  if (!ctx) throw new Error("askUserPlugin QuestionsPane must be rendered under AskUserProvider")
  return ctx
}

export function pendingQuestionSnapshot(store: QuestionsStore): string {
  const hints = store.getPendingHints()
    .map((hint) => `${hint.sessionId}:${hint.questionId}:${hint.status ?? "ready"}`)
    .sort()
  const hydrated = store.getHydratedPendingKeys().sort()
  return `${hints.length ? hints.join("|") : "none"}#hydrated=${hydrated.join("|")}`
}

export function isSessionOpen(runtime: Pick<QuestionsRuntime, "activeSessionId" | "openSessionIds">, sessionId: string): boolean {
  if (runtime.openSessionIds) return runtime.openSessionIds.includes(sessionId)
  return runtime.activeSessionId === sessionId
}

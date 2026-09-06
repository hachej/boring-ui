import { createContext, useContext } from "react"
import type { AskUserQuestion } from "../shared/types"
import type { PendingQuestionHint } from "./client"

export type QuestionsStore = {
  getPending(sessionId: string | null | undefined): AskUserQuestion | null
  getPendingByQuestionId(questionId: string): AskUserQuestion | null
  setPending(question: AskUserQuestion | null, sessionId?: string | null): void
  removePending(questionId: string): void
  getPendingHints(): PendingQuestionHint[]
  getPendingByToolCallId(toolCallId: string): AskUserQuestion | null
  getHydratedPendingKeys(): string[]
  setPendingHints(hints: PendingQuestionHint[]): void
  beginQuestionAction(question: AskUserQuestion): boolean
  finishQuestionAction(question: AskUserQuestion): void
  isQuestionActionInFlight(question: AskUserQuestion): boolean
  getQuestionActionKeys(): string[]
  subscribe(listener: () => void): () => void
}

export type QuestionsRuntime = QuestionsStore & {
  agentTypeId: string
  apiBaseUrl: string
  authHeaders?: Record<string, string>
  activeSessionId?: string | null
  openSessionIds?: readonly string[]
  agentTypeIdForSession(sessionId: string): string | undefined
  requestPendingRefresh(sessionId?: string, questionId?: string): void
}

export function createQuestionsStore(): QuestionsStore {
  const listeners = new Set<() => void>()
  const pendingByQuestion = new Map<string, AskUserQuestion>()
  const hintsByQuestion = new Map<string, PendingQuestionHint>()
  const actionsInFlight = new Set<string>()
  const actionKey = (question: AskUserQuestion) => `${question.sessionId}:${question.questionId}`
  const emit = () => { for (const listener of [...listeners]) listener() }
  return {
    getPending(sessionId) {
      if (!sessionId) return null
      const questions = [...pendingByQuestion.values()].filter((question) => question.sessionId === sessionId && question.status === "ready")
      return questions.find((question) => question.blocking !== false) ?? questions.at(-1) ?? null
    },
    getPendingByQuestionId(questionId) {
      const question = pendingByQuestion.get(questionId)
      return question?.status === "ready" ? question : null
    },
    setPending(question, sessionId) {
      if (question) {
        pendingByQuestion.set(question.questionId, question)
        hintsByQuestion.set(question.questionId, {
          questionId: question.questionId,
          sessionId: question.sessionId,
          ...(question.toolCallId ? { toolCallId: question.toolCallId } : {}),
          status: question.status,
          ...(question.blocking === false ? { blocking: false as const } : {}),
        })
      } else if (sessionId) {
        for (const [questionId, candidate] of pendingByQuestion) {
          if (candidate.sessionId === sessionId) pendingByQuestion.delete(questionId)
        }
        for (const [questionId, hint] of hintsByQuestion) {
          if (hint.sessionId === sessionId) hintsByQuestion.delete(questionId)
        }
      } else {
        pendingByQuestion.clear()
        hintsByQuestion.clear()
      }
      emit()
    },
    removePending(questionId) {
      const changed = pendingByQuestion.delete(questionId) || hintsByQuestion.delete(questionId)
      if (changed) {
        hintsByQuestion.delete(questionId)
        emit()
      }
    },
    getPendingHints() {
      return [...hintsByQuestion.values()]
    },
    getPendingByToolCallId(toolCallId) {
      for (const question of pendingByQuestion.values()) {
        if (question.status === "ready" && question.toolCallId === toolCallId) return question
      }
      return null
    },
    getHydratedPendingKeys() {
      return [...pendingByQuestion.values()].map((question) => `${question.sessionId}:${question.questionId}:${question.status}`)
    },
    setPendingHints(hints) {
      hintsByQuestion.clear()
      const authoritativeQuestionIds = new Set<string>()
      for (const hint of hints) {
        hintsByQuestion.set(hint.questionId, hint)
        authoritativeQuestionIds.add(hint.questionId)
      }
      for (const [questionId, question] of [...pendingByQuestion.entries()]) {
        const hint = hintsByQuestion.get(questionId)
        if (!authoritativeQuestionIds.has(questionId) || (hint?.status && hint.status !== question.status)) {
          pendingByQuestion.delete(questionId)
        }
      }
      emit()
    },
    beginQuestionAction(question) {
      const key = actionKey(question)
      if (actionsInFlight.has(key)) return false
      actionsInFlight.add(key)
      emit()
      return true
    },
    finishQuestionAction(question) {
      if (actionsInFlight.delete(actionKey(question))) emit()
    },
    isQuestionActionInFlight(question) {
      return actionsInFlight.has(actionKey(question))
    },
    getQuestionActionKeys() {
      return [...actionsInFlight]
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
  const actions = store.getQuestionActionKeys().sort()
  return `${hints.length ? hints.join("|") : "none"}#hydrated=${hydrated.join("|")}#actions=${actions.join("|")}`
}

export function isSessionOpen(runtime: Pick<QuestionsRuntime, "activeSessionId" | "openSessionIds">, sessionId: string): boolean {
  if (runtime.openSessionIds) return runtime.openSessionIds.includes(sessionId)
  return runtime.activeSessionId === sessionId
}

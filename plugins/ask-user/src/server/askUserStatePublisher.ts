import { ASK_USER_UI_STATE_SLOTS } from "../shared/constants"
import type { AskUserQuestion } from "../shared/types"
import type { UiBridge, UiState } from "@hachej/boring-workspace/server"
import type { AskUserStore, AskUserStoreChange } from "./askUserStore"

export type AskUserPendingHint = {
  questionId: string
  sessionId: string
  status: AskUserQuestion["status"]
}

export type AskUserPendingState = {
  hint: AskUserPendingHint | null
}

export class AskUserStatePublisher {
  private unsubscribe?: () => void
  private readonly publishChains = new Map<string, Promise<void>>()

  constructor(
    private readonly store: AskUserStore,
    private readonly bridge: UiBridge,
  ) {}

  start(): () => void {
    if (this.unsubscribe) return this.unsubscribe
    void this.sanitizePreservedState().catch(() => undefined)
    this.unsubscribe = this.store.subscribe((change) => {
      void this.enqueuePublishSession(change.sessionId)
    })
    return () => this.stop()
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.publishChains.clear()
  }

  async publishSession(sessionId: string): Promise<void> {
    const hint = toPendingHint(await this.store.getPending(sessionId))
    const current = (await this.bridge.getState()) ?? {}
    const next: UiState = {
      ...current,
      [ASK_USER_UI_STATE_SLOTS.PENDING]: { hint } satisfies AskUserPendingState,
    }
    await this.bridge.setState(next)
  }

  private enqueuePublishSession(sessionId: string): Promise<void> {
    const previous = this.publishChains.get(sessionId) ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(() => this.publishSession(sessionId))
      .finally(() => {
        if (this.publishChains.get(sessionId) === next) this.publishChains.delete(sessionId)
      })
    this.publishChains.set(sessionId, next)
    return next
  }

  private async sanitizePreservedState(): Promise<void> {
    const current = await this.bridge.getState()
    if (!current || !(ASK_USER_UI_STATE_SLOTS.PENDING in current)) return
    const existing = current[ASK_USER_UI_STATE_SLOTS.PENDING]
    const sanitized = sanitizePendingState(existing)
    if (JSON.stringify(existing) === JSON.stringify(sanitized)) return
    await this.bridge.setState({
      ...current,
      [ASK_USER_UI_STATE_SLOTS.PENDING]: sanitized,
    })
  }
}

function toPendingHint(question: AskUserQuestion | null): AskUserPendingHint | null {
  if (!question) return null
  return {
    questionId: question.questionId,
    sessionId: question.sessionId,
    status: question.status,
  }
}

function sanitizePendingState(value: unknown): AskUserPendingState {
  if (!value || typeof value !== "object") return { hint: null }
  const raw = value as { hint?: unknown; question?: unknown }
  return { hint: toHintFromUnknown(raw.hint) ?? toHintFromUnknown(raw.question) }
}

function toHintFromUnknown(value: unknown): AskUserPendingHint | null {
  if (!value || typeof value !== "object") return null
  const raw = value as { questionId?: unknown; sessionId?: unknown; status?: unknown }
  if (typeof raw.questionId !== "string" || typeof raw.sessionId !== "string" || typeof raw.status !== "string") return null
  if (!isQuestionStatus(raw.status)) return null
  return { questionId: raw.questionId, sessionId: raw.sessionId, status: raw.status }
}

function isQuestionStatus(value: string): value is AskUserQuestion["status"] {
  return value === "ready" || value === "answered" || value === "cancelled" || value === "abandoned"
}

export type { AskUserStoreChange }

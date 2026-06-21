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
  /** Compatibility/current hint for older frontends. */
  hint: AskUserPendingHint | null
  /** Session-indexed hints so background sessions can show a badge without exposing answer tokens. */
  hintsBySession: Record<string, AskUserPendingHint>
}

export class AskUserStatePublisher {
  private unsubscribe?: () => void
  private publishChain = Promise.resolve()

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
    this.publishChain = Promise.resolve()
  }

  async publishSession(sessionId: string): Promise<void> {
    const hint = toPendingHint(await this.store.getPending(sessionId))
    const current = (await this.bridge.getState()) ?? {}
    const currentPending = sanitizePendingState(current[ASK_USER_UI_STATE_SLOTS.PENDING])
    const hintsBySession = { ...currentPending.hintsBySession }
    if (hint) hintsBySession[sessionId] = hint
    else delete hintsBySession[sessionId]
    const nextPending: AskUserPendingState = {
      hint: hint ?? Object.values(hintsBySession)[0] ?? null,
      hintsBySession,
    }
    const next: UiState = {
      ...current,
      [ASK_USER_UI_STATE_SLOTS.PENDING]: nextPending,
    }
    await this.bridge.setState(next)
  }

  private enqueuePublishSession(sessionId: string): Promise<void> {
    const next = this.publishChain
      .catch(() => undefined)
      .then(() => this.publishSession(sessionId))
    this.publishChain = next.catch(() => undefined)
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
  if (!value || typeof value !== "object") return { hint: null, hintsBySession: {} }
  const raw = value as { hint?: unknown; question?: unknown; hintsBySession?: unknown }
  const hintsBySession: Record<string, AskUserPendingHint> = {}
  if (raw.hintsBySession && typeof raw.hintsBySession === "object" && !Array.isArray(raw.hintsBySession)) {
    for (const [sessionId, candidate] of Object.entries(raw.hintsBySession as Record<string, unknown>)) {
      const hint = toHintFromUnknown(candidate)
      if (hint && hint.sessionId === sessionId) hintsBySession[sessionId] = hint
    }
  }
  const hint = toHintFromUnknown(raw.hint) ?? toHintFromUnknown(raw.question) ?? Object.values(hintsBySession)[0] ?? null
  if (hint) hintsBySession[hint.sessionId] = hint
  return { hint, hintsBySession }
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

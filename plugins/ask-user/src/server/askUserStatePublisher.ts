import { ASK_USER_UI_STATE_SLOTS } from "../shared/constants"
import type { AskUserQuestion } from "../shared/types"
import { UI_STATE_INVALIDATION_COMMAND, type UiBridge, type UiState } from "@hachej/boring-workspace/server"
import type { AskUserStore, AskUserStoreChange } from "./askUserStore"

export type AskUserPendingHint = {
  questionId: string
  sessionId: string
  toolCallId?: string
  status: AskUserQuestion["status"]
}

export type AskUserPendingState = {
  /**
   * Compatibility/current hint for older frontends.
   * Non-authoritative in multi-session state; new readers must use hintsBySession.
   */
  hint: AskUserPendingHint | null
  /** Session-indexed hints so background sessions can show a badge without exposing answer tokens. */
  hintsBySession: Record<string, AskUserPendingHint>
}

export class AskUserStatePublisher {
  private unsubscribe?: () => void
  private publishChain = Promise.resolve()
  private readonly hintsBySession = new Map<string, AskUserPendingHint>()
  /** Snapshot of the last pending state whose invalidation the bridge accepted.
   * Recorded only after a successful notify, which is what makes an unchanged
   * republication retry a delivery that previously failed. */
  private lastAcceptedInvalidationSnapshot: string | undefined

  constructor(
    private readonly store: AskUserStore,
    private readonly bridge: UiBridge,
  ) {}

  start(): () => void {
    if (this.unsubscribe) return this.unsubscribe
    this.unsubscribe = this.store.subscribe((change) => {
      this.enqueuePublishSession(change.sessionId)
    })
    this.enqueueInitializeFromStore()
    return () => this.stop()
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.publishChain = Promise.resolve()
    this.hintsBySession.clear()
    this.lastAcceptedInvalidationSnapshot = undefined
  }

  async publishSession(sessionId: string): Promise<void> {
    const hint = toPendingHint(await this.store.getPending(sessionId))
    const current = (await this.bridge.getState()) ?? {}
    if (hint) this.hintsBySession.set(sessionId, hint)
    else this.hintsBySession.delete(sessionId)
    const nextPending = this.currentPendingState(hint)
    await this.publishPendingState(current, nextPending)
  }

  private currentPendingState(preferredHint?: AskUserPendingHint | null): AskUserPendingState {
    const hintsBySession = Object.fromEntries(this.hintsBySession.entries())
    return {
      hint: preferredHint ?? Object.values(hintsBySession)[0] ?? null,
      hintsBySession,
    }
  }

  private enqueuePublishSession(sessionId: string): void {
    this.enqueuePublish(() => this.publishSession(sessionId))
  }

  private enqueueInitializeFromStore(): void {
    this.enqueuePublish(() => this.initializeFromStore())
  }

  /** Serializes publications and absorbs their failures here, so no caller has
   * to remember to attach a rejection handler. A failed notify is not lost: it
   * leaves `lastAcceptedInvalidationSnapshot` unset, and the next publication
   * retries it. */
  private enqueuePublish(run: () => Promise<void>): void {
    this.publishChain = this.publishChain
      .catch(() => undefined)
      .then(run)
      .catch(() => undefined)
  }

  private async initializeFromStore(): Promise<void> {
    this.hintsBySession.clear()
    for (const question of await this.store.listPending()) {
      const hint = toPendingHint(question)
      if (hint) this.hintsBySession.set(hint.sessionId, hint)
    }
    const current = (await this.bridge.getState()) ?? {}
    const nextPending = this.currentPendingState()
    await this.publishPendingState(current, nextPending)
  }

  private async publishPendingState(current: UiState, nextPending: AskUserPendingState): Promise<void> {
    const nextSnapshot = JSON.stringify(nextPending)
    const stateChanged = JSON.stringify(current[ASK_USER_UI_STATE_SLOTS.PENDING]) !== nextSnapshot
    if (stateChanged) {
      await this.bridge.setState({
        ...current,
        [ASK_USER_UI_STATE_SLOTS.PENDING]: nextPending,
      })
    }
    if (!stateChanged && this.lastAcceptedInvalidationSnapshot === nextSnapshot) return
    await this.notifyPendingChanged()
    this.lastAcceptedInvalidationSnapshot = nextSnapshot
  }

  private async notifyPendingChanged(): Promise<void> {
    const result = await this.bridge.postCommand({
      kind: UI_STATE_INVALIDATION_COMMAND,
      params: { keys: [ASK_USER_UI_STATE_SLOTS.PENDING] },
    })
    if (result.status !== "ok") throw new Error(result.error?.message ?? "UI state invalidation was not delivered")
  }
}

function toPendingHint(question: AskUserQuestion | null): AskUserPendingHint | null {
  if (!question) return null
  return {
    questionId: question.questionId,
    sessionId: question.sessionId,
    ...(question.toolCallId ? { toolCallId: question.toolCallId } : {}),
    status: question.status,
  }
}

export type { AskUserStoreChange }

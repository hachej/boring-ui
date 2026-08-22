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
  private notifiedPendingSnapshot: string | undefined

  constructor(
    private readonly store: AskUserStore,
    private readonly bridge: UiBridge,
  ) {}

  start(): () => void {
    if (this.unsubscribe) return this.unsubscribe
    this.unsubscribe = this.store.subscribe((change) => {
      void this.enqueuePublishSession(change.sessionId)
    })
    void this.enqueueInitializeFromStore().catch(() => undefined)
    return () => this.stop()
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.publishChain = Promise.resolve()
    this.hintsBySession.clear()
    this.notifiedPendingSnapshot = undefined
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

  private enqueuePublishSession(sessionId: string): Promise<void> {
    return this.enqueuePublish(() => this.publishSession(sessionId))
  }

  private enqueueInitializeFromStore(): Promise<void> {
    return this.enqueuePublish(() => this.initializeFromStore())
  }

  private enqueuePublish(run: () => Promise<void>): Promise<void> {
    const next = this.publishChain
      .catch(() => undefined)
      .then(run)
    this.publishChain = next.catch(() => undefined)
    return next
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
    if (!stateChanged && this.notifiedPendingSnapshot === nextSnapshot) return
    await this.notifyPendingChanged()
    this.notifiedPendingSnapshot = nextSnapshot
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

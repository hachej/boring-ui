import { ASK_USER_UI_STATE_SLOTS } from "../shared/constants"
import type { AskUserQuestion } from "../shared/types"
import { UI_STATE_INVALIDATION_COMMAND, updateUiState, type UiBridge } from "@hachej/boring-workspace/server"
import type { AskUserStore, AskUserStoreChange } from "./askUserStore"

const PUBLISH_RETRY_MS = 100

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
  private generation = 0
  private cancelRetry?: () => void
  /** Snapshot of the last pending state whose invalidation the bridge accepted.
   * Recorded only after a successful notify, which is what makes an unchanged
   * republication retry a delivery that previously failed. */
  private lastAcceptedInvalidationSnapshot: string | undefined

  constructor(
    private readonly store: AskUserStore,
    private readonly bridge: UiBridge,
  ) {}

  start(): () => Promise<void> {
    if (this.unsubscribe) {
      const activeGeneration = this.generation
      return () => this.stop(activeGeneration)
    }
    const activeGeneration = ++this.generation
    this.unsubscribe = this.store.subscribe((change) => {
      void this.enqueuePublish(
        (generation) => this.publishSessionNow(change.sessionId, generation),
        activeGeneration,
      )
    })
    void this.enqueuePublish(
      (generation) => this.initializeFromStore(generation),
      activeGeneration,
    )
    return () => this.stop(activeGeneration)
  }

  async stop(expectedGeneration = this.generation): Promise<void> {
    if (expectedGeneration !== this.generation) return
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.generation += 1
    this.cancelRetry?.()
    this.cancelRetry = undefined
    this.hintsBySession.clear()
    this.lastAcceptedInvalidationSnapshot = undefined
    await this.publishChain
  }

  async publishSession(sessionId: string): Promise<void> {
    if (this.unsubscribe) {
      await this.enqueuePublish(
        (generation) => this.publishSessionNow(sessionId, generation),
        this.generation,
      )
      return
    }
    await this.publishSessionNow(sessionId)
  }

  private async publishSessionNow(sessionId: string, generation?: number): Promise<void> {
    const hint = toPendingHint(await this.store.getPending(sessionId))
    if (!this.isCurrent(generation)) return
    if (hint) this.hintsBySession.set(sessionId, hint)
    else this.hintsBySession.delete(sessionId)
    const nextPending = this.currentPendingState(hint)
    await this.publishPendingState(nextPending, generation)
  }

  private currentPendingState(preferredHint?: AskUserPendingHint | null): AskUserPendingState {
    const hintsBySession = Object.fromEntries(this.hintsBySession.entries())
    return {
      hint: preferredHint ?? Object.values(hintsBySession)[0] ?? null,
      hintsBySession,
    }
  }

  private isCurrent(generation?: number): boolean {
    return generation === undefined
      || (this.unsubscribe !== undefined && this.generation === generation)
  }

  /** Serialize publications across stop/start and explicitly retry failures. */
  private enqueuePublish(
    run: (generation: number) => Promise<void>,
    generation: number,
  ): Promise<void> {
    const execute = async (): Promise<void> => {
      let nextRun = run
      while (this.isCurrent(generation)) {
        try {
          await nextRun(generation)
          return
        } catch {
          if (!await this.waitForRetry(generation)) return
          // Reconcile the complete store on retry so changes that happened
          // during the failed publication cannot remain unpublished.
          nextRun = (retryGeneration) => this.initializeFromStore(retryGeneration)
        }
      }
    }
    const operation = this.publishChain.then(execute, execute)
    this.publishChain = operation.then(() => undefined, () => undefined)
    return operation
  }

  private async waitForRetry(generation: number): Promise<boolean> {
    if (!this.isCurrent(generation)) return false
    return await new Promise<boolean>((resolve) => {
      let settled = false
      const finish = (retry: boolean) => {
        if (settled) return
        settled = true
        this.cancelRetry = undefined
        resolve(retry)
      }
      const timer = setTimeout(() => finish(this.isCurrent(generation)), PUBLISH_RETRY_MS)
      this.cancelRetry = () => {
        clearTimeout(timer)
        finish(false)
      }
    })
  }

  private async initializeFromStore(generation?: number): Promise<void> {
    const pending = await this.store.listPending()
    if (!this.isCurrent(generation)) return
    this.hintsBySession.clear()
    for (const question of pending) {
      const hint = toPendingHint(question)
      if (hint) this.hintsBySession.set(hint.sessionId, hint)
    }
    const nextPending = this.currentPendingState()
    await this.publishPendingState(nextPending, generation)
  }

  private async publishPendingState(
    nextPending: AskUserPendingState,
    generation?: number,
  ): Promise<void> {
    const nextSnapshot = JSON.stringify(nextPending)
    let stateChanged = false
    await updateUiState(this.bridge, (current) => {
      if (!this.isCurrent(generation)) return undefined
      stateChanged = JSON.stringify(current[ASK_USER_UI_STATE_SLOTS.PENDING]) !== nextSnapshot
      return stateChanged
        ? { ...current, [ASK_USER_UI_STATE_SLOTS.PENDING]: nextPending }
        : undefined
    })
    if (!this.isCurrent(generation)) return
    if (!stateChanged && this.lastAcceptedInvalidationSnapshot === nextSnapshot) return
    await this.notifyPendingChanged(generation)
    if (!this.isCurrent(generation)) return
    this.lastAcceptedInvalidationSnapshot = nextSnapshot
  }

  private async notifyPendingChanged(generation?: number): Promise<void> {
    if (!this.isCurrent(generation)) return
    const result = await this.bridge.postCommand({
      kind: UI_STATE_INVALIDATION_COMMAND,
      params: { keys: [ASK_USER_UI_STATE_SLOTS.PENDING] },
    })
    if (!this.isCurrent(generation)) return
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

import { ASK_USER_UI_STATE_SLOTS } from "../shared/constants"
import type { AskUserQuestion } from "../shared/types"
import type { UiBridge, UiState } from "../../../shared/ui-bridge"
import type { AskUserStore, AskUserStoreChange } from "./AskUserStore"

export type AskUserPendingState = {
  question: AskUserQuestion | null
  bySession?: Record<string, AskUserQuestion | null>
}

export class AskUserStatePublisher {
  private unsubscribe?: () => void

  constructor(
    private readonly store: AskUserStore,
    private readonly bridge: UiBridge,
  ) {}

  start(): () => void {
    if (this.unsubscribe) return this.unsubscribe
    this.unsubscribe = this.store.subscribe((change) => {
      void this.publishSession(change.sessionId)
    })
    return () => this.stop()
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = undefined
  }

  async publishSession(sessionId: string): Promise<void> {
    const question = await this.store.getPending(sessionId)
    const current = (await this.bridge.getState()) ?? {}
    const previousSlot = current[ASK_USER_UI_STATE_SLOTS.PENDING]
    const previousBySession = previousSlot && typeof previousSlot === "object" && "bySession" in previousSlot
      ? (previousSlot as { bySession?: Record<string, AskUserQuestion | null> }).bySession ?? {}
      : {}
    const next: UiState = {
      ...current,
      [ASK_USER_UI_STATE_SLOTS.PENDING]: {
        question,
        bySession: { ...previousBySession, [sessionId]: question },
      } satisfies AskUserPendingState,
    }
    await this.bridge.setState(next)
  }
}

export function createAskUserStatePublisher(store: AskUserStore, bridge: UiBridge): AskUserStatePublisher {
  return new AskUserStatePublisher(store, bridge)
}

export type { AskUserStoreChange }

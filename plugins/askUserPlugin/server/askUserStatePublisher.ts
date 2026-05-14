import { ASK_USER_UI_STATE_SLOTS } from "../shared/constants"
import type { AskUserQuestion } from "../shared/types"
import type { UiBridge, UiState } from "@hachej/boring-workspace/server"
import type { AskUserStore, AskUserStoreChange } from "./askUserStore"

export type AskUserPendingState = {
  question: AskUserQuestion | null
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
    const next: UiState = {
      ...current,
      [ASK_USER_UI_STATE_SLOTS.PENDING]: { question } satisfies AskUserPendingState,
    }
    await this.bridge.setState(next)
  }
}

export type { AskUserStoreChange }

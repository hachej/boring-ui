import { describe, expect, it, vi } from "vitest"
import type { UiBridge, UiState } from "../../../shared/ui-bridge"
import { updateUiState } from "../updateUiState"

describe("updateUiState", () => {
  it("serializes read-modify-write updates on the same bridge", async () => {
    let state: UiState = {}
    let setCalls = 0
    let markFirstSetStarted: (() => void) | undefined
    let releaseFirstSet: (() => void) | undefined
    const firstSetStarted = new Promise<void>((resolve) => { markFirstSetStarted = resolve })
    const firstSetGate = new Promise<void>((resolve) => { releaseFirstSet = resolve })
    const getState = vi.fn(async () => ({ ...state }))
    const bridge: UiBridge = {
      getState,
      async setState(next) {
        setCalls += 1
        if (setCalls === 1) {
          markFirstSetStarted?.()
          await firstSetGate
        }
        state = next
      },
      async postCommand() { return { seq: 1, status: "ok" } },
      subscribeCommands() { return () => undefined },
    }

    const first = updateUiState(bridge, (current) => ({ ...current, first: true }))
    await firstSetStarted
    const second = updateUiState(bridge, (current) => ({ ...current, second: true }))
    await Promise.resolve()

    expect(getState).toHaveBeenCalledTimes(1)
    releaseFirstSet?.()
    await Promise.all([first, second])

    expect(getState).toHaveBeenCalledTimes(2)
    expect(state).toEqual({ first: true, second: true })
  })
})

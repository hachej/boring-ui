import { describe, expect, it, vi } from "vitest"
import { postUiCommand, registerUiCommandConsumer } from "../uiCommandBus"
import type { UiCommand } from "../types"

const command: UiCommand = {
  kind: "openFile",
  params: { filesystem: "company_context", path: "/policy.md" },
}

describe("uiCommandBus", () => {
  it("delivers posted commands only while a consumer is mounted", () => {
    const consume = vi.fn()
    const unregister = registerUiCommandConsumer(consume)

    postUiCommand(command)
    expect(consume).toHaveBeenCalledOnce()
    expect(consume).toHaveBeenCalledWith(command)

    unregister()
    postUiCommand(command)
    expect(consume).toHaveBeenCalledOnce()
  })
})

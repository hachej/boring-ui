import { describe, expect, it, vi } from "vitest"
import registerBoringFeedbackAgent from "../index"

describe("boring feedback Pi extension", () => {
  it("registers /feedback and forwards report text to the feedback skill prompt", async () => {
    const sendUserMessage = vi.fn()
    let handler: ((args: string) => void | Promise<void>) | undefined
    const registerCommand = vi.fn((_name, options) => {
      handler = options.handler
    })

    registerBoringFeedbackAgent({ registerCommand, sendUserMessage })

    expect(registerCommand).toHaveBeenCalledWith(
      "feedback",
      expect.objectContaining({ description: expect.stringContaining("feedback") }),
    )

    await handler?.("the settings panel crashes on save")

    expect(sendUserMessage).toHaveBeenCalledWith(
      expect.stringContaining("the settings panel crashes on save"),
      { deliverAs: "followUp" },
    )
  })

  it("asks the agent to start intake when /feedback has no args", async () => {
    const sendUserMessage = vi.fn()
    let handler: ((args: string) => void | Promise<void>) | undefined

    registerBoringFeedbackAgent({
      registerCommand: (_name, options) => {
        handler = options.handler
      },
      sendUserMessage,
    })

    await handler?.("")

    expect(sendUserMessage).toHaveBeenCalledWith(
      expect.stringContaining("Ask me for the feedback report"),
      { deliverAs: "followUp" },
    )
  })
})

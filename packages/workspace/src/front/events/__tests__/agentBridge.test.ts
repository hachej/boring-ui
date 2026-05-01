import { describe, expect, it, vi, beforeEach } from "vitest"
import { emitAgentData } from "../agentBridge"
import { events, workspaceEvents } from "../index"

describe("emitAgentData", () => {
  beforeEach(() => events._reset())

  it("emits raw agent data as an opaque workspace event", () => {
    const fn = vi.fn()
    const part = { type: "data-file-changed", data: { path: "src/x.ts" } }
    events.on(workspaceEvents.agentData, fn)
    emitAgentData(part)
    expect(fn).toHaveBeenCalledWith(
      expect.objectContaining({
        part,
        ts: expect.any(Number),
      }),
    )
  })

  it("does not inspect or reject arbitrary payloads", () => {
    const fn = vi.fn()
    events.on(workspaceEvents.agentData, fn)
    emitAgentData(null)
    emitAgentData("plain text")
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

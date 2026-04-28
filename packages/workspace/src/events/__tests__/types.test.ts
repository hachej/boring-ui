import { describe, it, expect } from "vitest"
import { agentMeta, userMeta, type Origin } from "../types"

describe("event meta helpers", () => {
  it("userMeta() returns a narrowed user origin with timestamp", () => {
    const m = userMeta()
    expect(m.cause).toBe("user")
    expect(typeof m.ts).toBe("number")
  })

  it("agentMeta() requires toolCallId", () => {
    const m = agentMeta("call-1")
    expect(m).toMatchObject({ cause: "agent", toolCallId: "call-1" })
  })

  // Compile-time check (running = passing). Asserts the discriminated
  // Origin union catches "agent without toolCallId" — the bug Gemini
  // flagged in plan review.
  it("[type-level] agent cause requires toolCallId", () => {
    const valid: Origin = { cause: "agent", toolCallId: "x" }
    // @ts-expect-error — agent without toolCallId is rejected
    const invalid: Origin = { cause: "agent" }
    expect(valid.cause).toBe("agent")
    expect(invalid).toBeDefined()
  })
})

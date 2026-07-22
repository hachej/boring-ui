import { describe, expect, it } from "vitest"
import { fullChatSessionIdFromEvent } from "../WorkspaceShellCapabilitiesHost"

describe("fullChatSessionIdFromEvent", () => {
  it("accepts only bounded non-empty session ids", () => {
    expect(fullChatSessionIdFromEvent(new CustomEvent("open", { detail: { sessionId: " native-exact " } }))).toBe("native-exact")
    expect(fullChatSessionIdFromEvent(new CustomEvent("open", { detail: {} }))).toBeNull()
    expect(fullChatSessionIdFromEvent(new CustomEvent("open", { detail: { sessionId: 42 } }))).toBeNull()
    expect(fullChatSessionIdFromEvent(new CustomEvent("open", { detail: { sessionId: "x".repeat(129) } }))).toBeNull()
  })

})

import { describe, expect, it } from "vitest"
import { fullChatSessionIdFromEvent, workspacePathFromRevealEvent } from "../WorkspaceShellCapabilitiesHost"

describe("fullChatSessionIdFromEvent", () => {
  it("accepts only bounded non-empty session ids", () => {
    expect(fullChatSessionIdFromEvent(new CustomEvent("open", { detail: { sessionId: " native-exact " } }))).toBe("native-exact")
    expect(fullChatSessionIdFromEvent(new CustomEvent("open", { detail: {} }))).toBeNull()
    expect(fullChatSessionIdFromEvent(new CustomEvent("open", { detail: { sessionId: 42 } }))).toBeNull()
    expect(fullChatSessionIdFromEvent(new CustomEvent("open", { detail: { sessionId: "x".repeat(129) } }))).toBeNull()
  })

  it("accepts only bounded string reveal paths at the event boundary", () => {
    expect(workspacePathFromRevealEvent(new CustomEvent("reveal", { detail: { path: " docs/issues/776 " } }))).toBe("docs/issues/776")
    expect(workspacePathFromRevealEvent(new CustomEvent("reveal", { detail: { path: 42 } }))).toBeNull()
    expect(workspacePathFromRevealEvent(new CustomEvent("reveal", { detail: { path: "x".repeat(1025) } }))).toBeNull()
  })
})

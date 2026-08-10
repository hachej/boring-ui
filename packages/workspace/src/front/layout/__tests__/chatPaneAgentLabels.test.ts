import { describe, expect, it } from "vitest"
import { chatPaneAgentLabels } from "../chatPaneAgentLabels"

describe("chatPaneAgentLabels", () => {
  it("labels every Agent by its short name when a fleet exists", () => {
    expect(chatPaneAgentLabels([
      { agentTypeId: "alpha", label: "Boring Coder" },
      { agentTypeId: "beta", label: "Researcher" },
    ])).toEqual(new Map([["alpha", "Coder"], ["beta", "Researcher"]]))
  })

  it("labels nothing with one Agent or none — there is nothing to disambiguate", () => {
    expect(chatPaneAgentLabels([{ agentTypeId: "default", label: "Boring Coder" }])).toBeNull()
    expect(chatPaneAgentLabels([])).toBeNull()
  })
})

import { describe, expect, it, vi } from "vitest"
import { openHumanArtifact } from "./openHumanArtifact"

describe("openHumanArtifact", () => {
  it("routes only the registered surface target through shell capabilities", () => {
    const openArtifact = vi.fn(() => ({ success: true as const }))
    expect(openHumanArtifact({ openArtifact }, {
      id: "plan",
      surfaceKind: "workspace-file",
      target: "docs/plan.md",
      title: "Plan",
    }, { sessionId: "native-session" })).toEqual({ success: true })
    expect(openArtifact).toHaveBeenCalledWith({
      type: "surface",
      surfaceKind: "workspace-file",
      target: "docs/plan.md",
    }, {
      sessionId: "native-session",
      title: "Plan",
      instanceId: "human-artifact:plan",
    })
  })
})

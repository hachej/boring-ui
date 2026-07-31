import { describe, expect, it } from "vitest"
import type { WorkspaceAgentSession } from "../WorkspaceAgentFront"
import { workspaceAgentSessionSnapshotsEqual } from "../useWorkspaceAgentSessionCoordinator"

const base: WorkspaceAgentSession[] = [
  { id: "older", agentTypeId: "alpha", title: "Older", updatedAt: 1, turnCount: 1 },
  { id: "newer", agentTypeId: "alpha", title: "Newer", updatedAt: 2, turnCount: 1 },
]

describe("workspaceAgentSessionSnapshotsEqual", () => {
  it("publishes updatedAt-only changes so consumers can recompute recency order", () => {
    expect(workspaceAgentSessionSnapshotsEqual(base, base.map((session) => ({ ...session })))).toBe(true)
    expect(workspaceAgentSessionSnapshotsEqual(base, [
      { ...base[0]!, updatedAt: 3 },
      base[1]!,
    ])).toBe(false)
  })

  it("publishes ephemeral adoption changes and ordering changes", () => {
    expect(workspaceAgentSessionSnapshotsEqual(base, [
      { ...base[0]!, ephemeral: true },
      base[1]!,
    ])).toBe(false)
    expect(workspaceAgentSessionSnapshotsEqual(base, [base[1]!, base[0]!])).toBe(false)
  })
})

// @vitest-environment node
import { resolve } from "node:path"
import { afterEach, describe, expect, test } from "vitest"

import { resolveDefaultAgentFleet } from "../createWorkspaceAgentServer"

const REPOSITORY_ROOT = resolve(import.meta.dirname, "../../../../../..")

describe("resolveDefaultAgentFleet (BORING_AGENT_FLEET gate, gh-1106 slice 3)", () => {
  const originalFlag = process.env.BORING_AGENT_FLEET

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.BORING_AGENT_FLEET
    else process.env.BORING_AGENT_FLEET = originalFlag
  })

  test("flag absent: byte-identical legacy single-default-agent boot", async () => {
    delete process.env.BORING_AGENT_FLEET
    const agents = await resolveDefaultAgentFleet(REPOSITORY_ROOT)
    expect(agents).toEqual([{ agentTypeId: "default", legacyDefault: true }])
  })

  test("flag=1: composes the default agent plus the repository's factory seats", async () => {
    process.env.BORING_AGENT_FLEET = "1"
    const agents = await resolveDefaultAgentFleet(REPOSITORY_ROOT)
    expect(agents[0]).toEqual({ agentTypeId: "default", legacyDefault: true })
    expect(agents.slice(1).map((agent) => agent.agentTypeId)).toEqual([
      "boring-concierge",
      "boring-triage",
      "boring-steward",
      "boring-worker",
      "boring-reviewer",
    ])
  })
})

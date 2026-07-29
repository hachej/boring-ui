import { describe, expect, it } from "vitest"
import { createWorkspacePlaygroundRealAgentFleet } from "../realAgentFleet"

describe("workspace-playground real agent fleet", () => {
  it("stays disabled unless the real fleet flag is set", () => {
    expect(createWorkspacePlaygroundRealAgentFleet({})).toBeUndefined()
  })

  it("configures two real agents with isolated identity, model, and full app plugin bindings", () => {
    const composition = createWorkspacePlaygroundRealAgentFleet({
      BORING_WORKSPACE_PLAYGROUND_REAL_FLEET: "1",
      BORING_WORKSPACE_PLAYGROUND_DEFAULT_MODEL: "test:default-model",
      BORING_WORKSPACE_PLAYGROUND_RESEARCHER_MODEL: "test:researcher-model",
    })

    expect(composition).toEqual({
      defaultAgentTypeId: "default",
      agents: [
        expect.objectContaining({
          agentTypeId: "default",
          definition: expect.objectContaining({
            instructions: expect.stringContaining("DEFAULT_AGENT:"),
          }),
          plugins: [{ name: "ask-user" }, { name: "diagram" }, { name: "tasks" }],
          model: { preferred: "test:default-model" },
        }),
        expect.objectContaining({
          agentTypeId: "researcher",
          definition: expect.objectContaining({
            instructions: expect.stringContaining("RESEARCHER_AGENT:"),
          }),
          plugins: [{ name: "ask-user" }, { name: "diagram" }, { name: "tasks" }],
          model: { preferred: "test:researcher-model" },
        }),
      ],
    })
  })
})

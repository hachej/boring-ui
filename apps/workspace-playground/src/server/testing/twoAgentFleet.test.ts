import { describe, expect, it } from "vitest"
import {
  SCRIPTED_TWO_AGENT_CAPABILITY_PLUGINS,
  SCRIPTED_TWO_AGENT_FLEET,
} from "./twoAgentFleet"

describe("SCRIPTED_TWO_AGENT_FLEET", () => {
  it("gives Alpha and Beta divergent models and capability plugins", () => {
    const [alpha, beta] = SCRIPTED_TWO_AGENT_FLEET
    expect(alpha.model.preferred).not.toBe(beta.model.preferred)
    expect(alpha.plugins).toEqual([{ name: "scripted-alpha-capability" }])
    expect(beta.plugins).toEqual([{ name: "scripted-beta-capability" }])

    const toolNamesByPlugin = Object.fromEntries(
      SCRIPTED_TWO_AGENT_CAPABILITY_PLUGINS.map((plugin) => [
        plugin.id,
        plugin.agentTools.map((tool) => tool.name),
      ]),
    )
    expect(toolNamesByPlugin["scripted-alpha-capability"]).toEqual(["alpha_capability"])
    expect(toolNamesByPlugin["scripted-beta-capability"]).toEqual(["beta_capability"])
  })
})

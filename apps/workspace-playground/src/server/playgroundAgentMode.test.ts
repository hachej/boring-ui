import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { resolvePlaygroundAgentMode } from "./playgroundAgentMode"
import { SCRIPTED_DEFAULT_AGENT_TYPE_ID } from "../shared/playgroundAgents"
import {
  SCRIPTED_ONE_AGENT,
  SCRIPTED_TWO_AGENT_DEFAULT,
  SCRIPTED_TWO_AGENT_FLEET,
} from "./testing/twoAgentFleet"

describe("workspace playground agent mode", () => {
  it("defaults to exactly one scripted agent", () => {
    expect(resolvePlaygroundAgentMode({})).toBe("scripted-single")
    expect(SCRIPTED_ONE_AGENT).toEqual([SCRIPTED_TWO_AGENT_FLEET[0]])
    expect(SCRIPTED_ONE_AGENT).toHaveLength(1)
    expect(SCRIPTED_ONE_AGENT[0].agentTypeId).toBe(SCRIPTED_DEFAULT_AGENT_TYPE_ID)
    expect(SCRIPTED_TWO_AGENT_DEFAULT).toBe(SCRIPTED_DEFAULT_AGENT_TYPE_ID)
  })

  it("keeps the two-agent scripted fleet available for e2e coverage", () => {
    expect(resolvePlaygroundAgentMode({ BORING_AGENT_E2E_SCRIPTED_PI: "1" })).toBe("scripted-multi")
    expect(SCRIPTED_TWO_AGENT_FLEET).toHaveLength(2)
  })

  it("routes the named multi-agent dev script to the factory fleet", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../../package.json"), "utf8"),
    ) as { scripts: Record<string, string> }

    expect(packageJson.scripts.dev).toBe("pnpm run build:deps && vite")
    expect(packageJson.scripts["dev:multiagent"]).toBe("VITE_BORING_FACTORY_AGENTS=1 pnpm run dev")
    expect(resolvePlaygroundAgentMode({ VITE_BORING_FACTORY_AGENTS: "1" })).toBe("factory")
  })
})

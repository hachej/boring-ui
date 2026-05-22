import { describe, expect, it } from "vitest"

// The legacy front-plugin object adapter remains as an unexported internal
// module for old migration code, but current authoring surfaces must not teach
// or expose it. Public plugin authors use definePlugin({ ... }) from /plugin.
describe("legacy front plugin adapter privacy", () => {
  it("is absent from the root and /plugin public surfaces", async () => {
    const rootApi = await import("../../../index")
    const pluginApi = await import("../../../plugin")

    expect("defineFrontPlugin" in rootApi).toBe(false)
    expect("WorkspaceFrontPlugin" in rootApi).toBe(false)
    expect("defineFrontPlugin" in pluginApi).toBe(false)
    expect("WorkspaceFrontPlugin" in pluginApi).toBe(false)
  })
})

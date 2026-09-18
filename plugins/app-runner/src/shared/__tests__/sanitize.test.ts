import { describe, expect, it } from "vitest"
import { appRunnerAppId, sanitizeAppName } from "../sanitize"

describe("canonical runner ids", () => {
  it.each(["team_a", "Team-a", " team-a", "team--a", "-team", "team-"])("rejects noncanonical id %s instead of rewriting it", (value) => {
    expect(() => sanitizeAppName(value)).toThrow(/must already be canonical/)
  })

  it("keeps distinct canonical ids distinct", () => {
    expect(appRunnerAppId("team-a", "foo-bar")).toBe("team-a--foo-bar")
    expect(sanitizeAppName("team-a")).toBe("team-a")
  })
})

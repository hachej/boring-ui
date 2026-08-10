import { describe, expect, it } from "vitest"
import { assertReleaseCandidateDistModule } from "../release-candidate-dist"

describe("release-candidate dist-only module guard", () => {
  it.each([
    "/repo/packages/agent/src/front/index.ts",
    "/repo/plugins/tasks/src/front/index.tsx?import",
  ])("rejects package source loaded through any Vite hook: %s", (id) => {
    expect(() => assertReleaseCandidateDistModule(id, "transform")).toThrow(
      /release-candidate dist-only resolution violation/,
    )
  })

  it.each([
    "/repo/packages/agent/dist/front/index.js",
    "/repo/plugins/tasks/dist/front/index.js",
    "/repo/apps/workspace-playground/src/front/main.tsx",
  ])("allows dist packages and playground fixture source: %s", (id) => {
    expect(() => assertReleaseCandidateDistModule(id, "load")).not.toThrow()
  })
})

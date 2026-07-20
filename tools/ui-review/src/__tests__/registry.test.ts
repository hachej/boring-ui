import { describe, expect, it } from "vitest"
import { uiReviewSpecs, UiReviewSpecRegistry } from "../registry"
import type { UiReviewSpec } from "../core/reviewSpec"

function spec(id: string, appRoot: UiReviewSpec["target"]["appRoot"]): UiReviewSpec {
  return {
    id,
    specRevision: `${id}-v1`,
    fixtureResetId: `${id}-fixture-v1`,
    rubricVersion: "rubric-v1",
    target: {
      appRoot,
      buildCommand: ["pnpm", "run", "build"],
      serverCommand: ["pnpm", "run", "dev"],
      route: "/",
      defaultPort: 5_380,
      serverEnvironmentKeys: ["PORT"],
      environment: () => ({}),
      ready: async () => {},
    },
    viewports: [{ name: "primary", width: 1_024, height: 768, deviceScaleFactor: 1 }],
    checkpoints: [{ id: "loaded", reach: async () => {} }],
    criticPrompt: "Review supplied screenshots and return schema-valid JSON.",
    criticContextPaths: [".impeccable.md"],
    ownerSpotChecks: ["Confirm the loaded checkpoint."],
    hardGates: {
      contractVersion: "test-v1",
      collect: async () => ({}),
      evaluate: () => ({ schemaVersion: 1, contractVersion: "test-v1", results: [] }),
      validate: () => {},
    },
  }
}

describe("UI review spec registry", () => {
  it("registers the command-palette and component-baseline review specs", () => {
    expect(uiReviewSpecs.ids()).toEqual(["workspace-command-palette", "workspace-component-baselines"])
    expect(uiReviewSpecs.get("workspace-component-baselines").checkpoints.every((checkpoint) => checkpoint.visualBaseline)).toBe(true)
  })

  it("registers specs targeting all current playgrounds without changing core", () => {
    const registry = new UiReviewSpecRegistry()
      .register(spec("agent-smoke", "apps/agent-playground"))
      .register(spec("workspace-smoke", "apps/workspace-playground"))
      .register(spec("full-app-smoke", "apps/full-app"))

    expect(registry.ids()).toEqual(["agent-smoke", "full-app-smoke", "workspace-smoke"])
    expect(registry.get("full-app-smoke").target.appRoot).toBe("apps/full-app")
  })

  it.each(["https://example.com", "../workspace", "workspace/spec", "javascript:alert(1)"])(
    "rejects an unregistered path or URL %s",
    (id) => expect(() => new UiReviewSpecRegistry().get(id)).toThrow("UI_REVIEW_SPEC_ID_INVALID"),
  )

  it("rejects unknown and duplicate registered ids", () => {
    const registry = new UiReviewSpecRegistry().register(spec("workspace-smoke", "apps/workspace-playground"))
    expect(() => registry.get("other-smoke")).toThrow("UI_REVIEW_SPEC_UNKNOWN")
    expect(() => registry.register(spec("workspace-smoke", "apps/agent-playground"))).toThrow("UI_REVIEW_SPEC_DUPLICATE")
  })

  it("rejects unknown viewport filters and unsafe visual-baseline names", () => {
    const unknownViewport = spec("workspace-smoke", "apps/workspace-playground")
    unknownViewport.checkpoints = [{ id: "loaded", viewportNames: ["missing"], reach: async () => {} }]
    expect(() => new UiReviewSpecRegistry().register(unknownViewport)).toThrow("UI_REVIEW_SPEC_CHECKPOINTS_INVALID")

    const unsafeBaseline = spec("workspace-smoke", "apps/workspace-playground")
    unsafeBaseline.checkpoints = [{
      id: "loaded",
      visualBaseline: { fileName: "../escape.png", locator: "#root", maxDiffPixels: 0, rationale: "Exact fixture." },
      reach: async () => {},
    }]
    expect(() => new UiReviewSpecRegistry().register(unsafeBaseline)).toThrow("UI_REVIEW_SPEC_CHECKPOINTS_INVALID")
  })
})

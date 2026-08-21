import { describe, expect, it } from "vitest"
import { uiReviewSpecs, UiReviewSpecRegistry } from "../registry"
import type { UiReviewExplorationState, UiReviewSpec } from "../core/reviewSpec"

function spec(id: string, targetRoot: UiReviewSpec["target"]["root"]): UiReviewSpec {
  return {
    id,
    specRevision: `${id}-v1`,
    fixtureResetId: `${id}-fixture-v1`,
    rubricVersion: "rubric-v1",
    target: {
      root: targetRoot,
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
  it("registers the ask-user, Agent-sidebar, command-palette, component-baseline, and automation review specs", () => {
    expect(uiReviewSpecs.ids()).toEqual(["ask-user-inline", "automation-pane-popover", "workspace-agent-sidebar", "workspace-command-palette", "workspace-component-baselines"])
    const componentSpec = uiReviewSpecs.get("workspace-component-baselines")
    expect(componentSpec.target.root).toBe("tools/ui-review/fixtures/workspace-components")
    expect(componentSpec.checkpoints.every((checkpoint) => checkpoint.visualBaseline)).toBe(true)
    const askUserSpec = uiReviewSpecs.get("ask-user-inline")
    expect(askUserSpec.checkpoints.map((checkpoint) => checkpoint.id)).toEqual(["pending-light", "pending", "selected", "resolved", "inbox-list", "inbox-expanded"])
    const automationSpec = uiReviewSpecs.get("automation-pane-popover")
    expect(automationSpec.target.root).toBe("tools/ui-review/fixtures/workspace-components")
    expect(automationSpec.checkpoints).toHaveLength(4)
    for (const id of uiReviewSpecs.ids()) {
      expect(uiReviewSpecs.get(id).target.serverCommand.slice(-3)).toEqual(["--host", "127.0.0.1", "--strictPort"])
    }
  })

  it("registers specs targeting all current playgrounds without changing core", () => {
    const registry = new UiReviewSpecRegistry()
      .register(spec("agent-smoke", "apps/agent-playground"))
      .register(spec("workspace-smoke", "apps/workspace-playground"))
      .register(spec("full-app-smoke", "apps/full-app"))

    expect(registry.ids()).toEqual(["agent-smoke", "full-app-smoke", "workspace-smoke"])
    expect(registry.get("full-app-smoke").target.root).toBe("apps/full-app")
  })

  it("selects a painted command-palette Wait for replay", () => {
    const select = uiReviewSpecs.get("workspace-command-palette").exploration!.selectReplayState
    const states = [
      { ordinal: 19, viewport: { name: "desktop" }, action: "Wait", screenshotDigest: "painted", screenshotBytes: 200, normalizedState: { palette: { workspaceReady: true, dialogVisible: true, mode: "Commands" } } },
      { ordinal: 14, viewport: { name: "desktop" }, action: "Wait", screenshotDigest: "closed", screenshotBytes: 100, normalizedState: { palette: { workspaceReady: true, dialogVisible: false, mode: "none" } } },
      { ordinal: 16, viewport: { name: "desktop" }, action: { Click: {} }, screenshotDigest: "skeleton", screenshotBytes: 95, normalizedState: { palette: { workspaceReady: true, dialogVisible: true, mode: "Chats" } } },
      { ordinal: 17, viewport: { name: "desktop" }, action: "Wait", screenshotDigest: "skeleton", screenshotBytes: 95, normalizedState: { palette: { workspaceReady: true, dialogVisible: true, mode: "Chats" } } },
    ] as unknown as UiReviewExplorationState[]

    expect(select(states)).toBe(states[0])
    expect(select(states.slice(1))).toBeUndefined()

    const mobileStates = [
      { ordinal: 17, viewport: { name: "mobile" }, action: "Wait", screenshotDigest: "painted", screenshotBytes: 200, normalizedState: { palette: { workspaceReady: true, dialogVisible: true, mode: null } } },
      { ordinal: 14, viewport: { name: "mobile" }, action: "Wait", screenshotDigest: "closed", screenshotBytes: 100, normalizedState: { palette: { workspaceReady: true, dialogVisible: false, mode: null } } },
      { ordinal: 15, viewport: { name: "mobile" }, action: { Click: {} }, screenshotDigest: "skeleton", screenshotBytes: 100, normalizedState: { palette: { workspaceReady: true, dialogVisible: true, mode: null } } },
      { ordinal: 16, viewport: { name: "mobile" }, action: "Wait", screenshotDigest: "skeleton", screenshotBytes: 100, normalizedState: { palette: { workspaceReady: true, dialogVisible: true, mode: null } } },
    ] as unknown as UiReviewExplorationState[]
    expect(select(mobileStates)).toBe(mobileStates[0])
  })

  it.each(["https://example.com", "../workspace", "workspace/spec", "javascript:alert(1)"])(
    "rejects an unregistered path or URL %s",
    (id) => expect(() => new UiReviewSpecRegistry().get(id)).toThrow("UI_REVIEW_SPEC_ID_INVALID"),
  )

  it("rejects unknown target roots, ids, and duplicate registrations", () => {
    const invalidRoot = spec("invalid-root", "apps/workspace-playground")
    invalidRoot.target.root = "packages/workspace" as UiReviewSpec["target"]["root"]
    expect(() => new UiReviewSpecRegistry().register(invalidRoot)).toThrow("UI_REVIEW_SPEC_TARGET_ROOT_INVALID")

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

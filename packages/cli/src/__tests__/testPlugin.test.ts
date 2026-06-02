import { describe, expect, test } from "vitest"
import { buildPanelId, buildPanelInstanceId, buildPanelSelector, defaultPlaywrightBrowsersPath, formatSelfTestResult, inferSelfTestUrl, inferSelfTestWorkspaceId, isMissingPlaywrightBrowserError, redactUrl } from "../server/testPlugin"

describe("plugin self-test helpers", () => {
  test("builds default panel id, self-test panel instance id, and selector", () => {
    const panelId = buildPanelId("niche-explorer")
    const panelInstanceId = buildPanelInstanceId("niche-explorer", panelId)

    expect(panelId).toBe("niche-explorer.panel")
    expect(panelInstanceId).toBe("self-test:niche-explorer:niche-explorer.panel")
    expect(buildPanelSelector({ pluginId: "niche-explorer", panelId, panelInstanceId })).toBe(
      '[data-boring-plugin-id="niche-explorer"][data-boring-panel-component-id="niche-explorer.panel"][data-boring-panel-instance-id="self-test:niche-explorer:niche-explorer.panel"]',
    )
  })

  test("infers self-test URL from explicit args, env, port, then default", () => {
    expect(inferSelfTestUrl("http://explicit.test", { BORING_UI_SELF_TEST_URL: "http://env.test" })).toBe("http://explicit.test")
    expect(inferSelfTestUrl(undefined, { BORING_UI_SELF_TEST_URL: "http://env.test" })).toBe("http://env.test")
    expect(inferSelfTestUrl(undefined, { PORT: "5640" })).toBe("http://127.0.0.1:5640")
    expect(inferSelfTestUrl(undefined, {})).toBe("http://127.0.0.1:5200")
  })

  test("infers workspaces-mode workspace id from explicit arg then env", () => {
    expect(inferSelfTestWorkspaceId("explicit", { BORING_UI_WORKSPACE_ID: "env" })).toBe("explicit")
    expect(inferSelfTestWorkspaceId(undefined, { BORING_UI_WORKSPACE_ID: "env" })).toBe("env")
    expect(inferSelfTestWorkspaceId(undefined, { BORING_WORKSPACE_ID: "workspace" })).toBe("workspace")
    expect(inferSelfTestWorkspaceId(undefined, {})).toBeUndefined()
  })

  test("builds sandbox-local Playwright browser cache path", () => {
    expect(defaultPlaywrightBrowsersPath({ BORING_AGENT_WORKSPACE_ROOT: "/workspace" })).toBe("/workspace/.boring-agent/playwright-browsers")
    expect(defaultPlaywrightBrowsersPath({})).toBeUndefined()
  })

  test("detects missing Playwright browser launch errors", () => {
    expect(isMissingPlaywrightBrowserError(new Error("Executable doesn't exist at /cache/chromium"))).toBe(true)
    expect(isMissingPlaywrightBrowserError(new Error("Please run the following command to download new browsers: playwright install"))).toBe(true)
    expect(isMissingPlaywrightBrowserError(new Error("host is unreachable"))).toBe(false)
  })

  test("redacts URL credentials, query, and hash", () => {
    expect(redactUrl("http://user:pass@example.com/path?token=secret#frag")).toBe("http://example.com/path")
  })

  test("formats failing result with captured errors", () => {
    expect(formatSelfTestResult({
      ok: false,
      pluginId: "demo",
      reloadErrors: [{ code: "PLUGIN_FRONT_ERROR", message: "boom" }],
      pageErrors: [],
      consoleErrors: [],
      failedRequests: [{ status: 500, url: "http://localhost/api/bad" }],
      pane: {
        found: false,
        state: "error",
        selector: "[data-demo]",
        panelId: "demo.panel",
        panelInstanceId: "self-test:demo:demo.panel",
      },
    })).toContain("FAIL demo")
  })
})

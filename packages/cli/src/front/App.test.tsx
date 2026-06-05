// @vitest-environment jsdom
import React from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { CliWorkspaceShell } from "./App"

const workspaceAgentFrontSpy = vi.fn((props: Record<string, unknown>) => (
  <div>
    <div data-testid="workspace-agent-front" data-mode={String(props.frontPluginHotReload)}>
      {String(props.appTitle)}
    </div>
    <div data-testid="top-bar-right">{props.topBarRight as React.ReactNode}</div>
  </div>
))

vi.mock("@hachej/boring-agent", () => ({
  ChatPanel: () => null,
  useSessions: () => ({ sessions: [], loading: false }),
}))

vi.mock("@hachej/boring-ask-user/front", () => ({
  askUserPlugin: { pluginId: "ask-user", pluginLabel: "Questions" },
}))

vi.mock("@hachej/boring-workspace/app/front", () => ({
  WorkspaceAgentFront: (props: Record<string, unknown>) => workspaceAgentFrontSpy(props),
}))

vi.mock("./WorkspaceSwitcherControl", () => ({
  WorkspaceSwitcherControl: () => <div data-testid="workspace-switcher" />,
}))

describe("CliWorkspaceShell", () => {
  const originalFetch = globalThis.fetch

  test("publishes JSX runtime singletons for runtime plugin fronts", () => {
    const singletons = globalThis.__BORING_RUNTIME_SINGLETONS__ as Record<string, Record<string, unknown>> | undefined
    expect(typeof singletons?.["react/jsx-runtime"]?.jsx).toBe("function")
    expect(typeof singletons?.["react/jsx-dev-runtime"]?.jsxDEV).toBe("function")
  })

  beforeEach(() => {
    workspaceAgentFrontSpy.mockClear()
  })

  afterEach(() => {
    cleanup()
    globalThis.fetch = originalFetch
    window.localStorage.clear()
    document.title = ""
  })

  test("enables runtime hot loading without rendering plugin helper pills", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith("/api/v1/workspace/meta")) {
        return new Response(JSON.stringify({
          projectName: "Folder Workspace",
          version: "1.2.3",
          runtimePluginFrontLoadingEnabled: true,
          runtimePluginTrustLabel: "Trusted local runtime plugins",
          runtimePluginDiagnosticsEnabled: true,
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    render(<CliWorkspaceShell />)

    await waitFor(() => expect(workspaceAgentFrontSpy).toHaveBeenCalled())
    expect(workspaceAgentFrontSpy.mock.calls.at(-1)?.[0]).toMatchObject({
      frontPluginHotReload: "vite",
      appTitle: "Folder Workspace",
      plugins: [expect.objectContaining({ pluginId: "ask-user" })],
    })

    expect(screen.getByText("v1.2.3")).not.toBeNull()
    expect(screen.queryByText("Trusted local runtime plugins")).toBeNull()
    expect(screen.queryByText("Plugin diagnostics")).toBeNull()
  })
})

// @vitest-environment jsdom
import React from "react"
import { render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT } from "@hachej/boring-agent/shared"
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

vi.mock("@hachej/boring-workspace/app/front", () => ({
  WorkspaceAgentFront: (props: Record<string, unknown>) => workspaceAgentFrontSpy(props),
}))

vi.mock("./WorkspaceSwitcherControl", () => ({
  WorkspaceSwitcherControl: () => <div data-testid="workspace-switcher" />,
}))

describe("CliWorkspaceShell", () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    workspaceAgentFrontSpy.mockClear()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    window.localStorage.clear()
    document.title = ""
  })

  test("enables runtime hot loading and renders trust/loading status from workspace meta", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith("/api/v1/workspace/meta")) {
        return new Response(JSON.stringify({
          projectName: "Folder Workspace",
          version: "1.2.3",
          runtimePluginFrontLoadingEnabled: true,
          runtimePluginTrustLabel: "Trusted local runtime plugins",
          runtimePluginTrustDescription: "CLI-owned runtime module host",
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    render(<CliWorkspaceShell />)

    expect(await screen.findByText("Plugins loading…")).not.toBeNull()
    await waitFor(() => expect(workspaceAgentFrontSpy).toHaveBeenCalled())
    expect(workspaceAgentFrontSpy.mock.calls.at(-1)?.[0]).toMatchObject({
      frontPluginHotReload: "vite",
      appTitle: "Folder Workspace",
    })

    window.dispatchEvent(new CustomEvent(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, {
      detail: { type: "boring.plugin.replay-complete", replay: true },
    }))

    expect(await screen.findByText("Trusted local runtime plugins")).not.toBeNull()
    expect(screen.getByText("v1.2.3")).not.toBeNull()
  })
})

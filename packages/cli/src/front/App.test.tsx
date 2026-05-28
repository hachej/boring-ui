// @vitest-environment jsdom
import React from "react"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
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
          runtimePluginDiagnosticsEnabled: true,
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }
      if (url.endsWith("/api/v1/runtime-plugin-diagnostics")) {
        return new Response(JSON.stringify({
          workspaceId: "folder",
          plugins: [{
            id: "demo-plugin",
            rootDir: "/tmp/demo-plugin",
            frontPath: "front/index.tsx",
            serverLoadedRevision: 2,
            frontTarget: { kind: "native", entryUrl: "/api/v1/agent-plugins/runtime/folder/demo-plugin/2/front/index.tsx", revision: 2, trust: "local-trusted-native" },
            host: {
              pluginId: "demo-plugin",
              workspaceId: "folder",
              revision: 2,
              entryUrl: "/api/v1/agent-plugins/runtime/folder/demo-plugin/2/front/index.tsx",
              frontEntrySubpath: "front/index.tsx",
              lastRequestedPath: "front/index.tsx",
              lastTransformAt: Date.now(),
              lastServeAt: Date.now(),
              recent: [],
            },
          }],
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
      detail: { type: "boring.plugin.front-pending", id: "demo-plugin", revision: 2, replay: true },
    }))
    window.dispatchEvent(new CustomEvent(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, {
      detail: { type: "boring.plugin.replay-complete", replay: true },
    }))
    expect(screen.getByText("Plugins loading…")).not.toBeNull()
    window.dispatchEvent(new CustomEvent(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, {
      detail: { type: "boring.plugin.front-settled", id: "demo-plugin", revision: 2, replay: true },
    }))

    expect(await screen.findByText("Trusted local runtime plugins")).not.toBeNull()
    expect(screen.getByText("Plugin diagnostics")).not.toBeNull()
    expect(screen.getByText("v1.2.3")).not.toBeNull()

    fireEvent.click(screen.getByText("Plugin diagnostics"))
    expect(await screen.findByText("Runtime plugin diagnostics")).not.toBeNull()
    expect(screen.getByText("demo-plugin")).not.toBeNull()
    expect(screen.getByText(/server revision: 2/)).not.toBeNull()
  })

  test("shows browser front-load failures in runtime plugin diagnostics", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith("/api/v1/workspace/meta")) {
        return new Response(JSON.stringify({
          projectName: "Folder Workspace",
          runtimePluginFrontLoadingEnabled: true,
          runtimePluginDiagnosticsEnabled: true,
        }), { status: 200, headers: { "Content-Type": "application/json" } })
      }
      if (url.endsWith("/api/v1/runtime-plugin-diagnostics")) {
        return new Response(JSON.stringify({
          workspaceId: "folder",
          plugins: [{ id: "demo-plugin", serverLoadedRevision: 3, host: { pluginId: "demo-plugin", workspaceId: "folder", revision: 3, recent: [] } }],
        }), { status: 200, headers: { "Content-Type": "application/json" } })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    render(<CliWorkspaceShell />)
    await screen.findByText("Plugin diagnostics")

    window.dispatchEvent(new CustomEvent(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, {
      detail: { type: "boring.plugin.replay-complete", replay: true },
    }))
    window.dispatchEvent(new CustomEvent(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, {
      detail: {
        type: "boring.plugin.front-error",
        id: "demo-plugin",
        revision: 3,
        code: "PLUGIN_LOAD_FAILED",
        stage: "register",
        message: "register failed",
      },
    }))

    await waitFor(() => expect(screen.getByText("Plugin diagnostics (1)")).not.toBeNull())
    fireEvent.click(screen.getByText("Plugin diagnostics (1)"))
    expect(await screen.findByText(/browser error: PLUGIN_LOAD_FAILED/)).not.toBeNull()
    expect(screen.getAllByText(/register failed/).length).toBeGreaterThan(0)
  })

  test("ignores runtime plugin browser errors from another workspace", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith("/api/v1/workspace/meta")) {
        return new Response(JSON.stringify({
          projectName: "Boring UI",
          workspacesMode: true,
          runtimePluginFrontLoadingEnabled: true,
          runtimePluginDiagnosticsEnabled: true,
        }), { status: 200, headers: { "Content-Type": "application/json" } })
      }
      if (url.endsWith("/api/v1/local-workspaces")) {
        return new Response(JSON.stringify({
          workspaces: [{ id: "active", name: "Active", path: "/tmp/active", available: true }],
        }), { status: 200, headers: { "Content-Type": "application/json" } })
      }
      if (url.endsWith("/api/v1/runtime-plugin-diagnostics")) {
        return new Response(JSON.stringify({ workspaceId: "active", plugins: [] }), { status: 200, headers: { "Content-Type": "application/json" } })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    render(<CliWorkspaceShell />)
    await screen.findByText("Plugin diagnostics")

    window.dispatchEvent(new CustomEvent(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, {
      detail: { type: "boring.plugin.replay-complete", workspaceId: "active", replay: true },
    }))
    window.dispatchEvent(new CustomEvent(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, {
      detail: {
        type: "boring.plugin.front-error",
        id: "demo-plugin",
        revision: 9,
        workspaceId: "other-workspace",
        code: "PLUGIN_LOAD_FAILED",
        stage: "import",
        message: "stale workspace import failed",
      },
    }))
    window.dispatchEvent(new CustomEvent(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, {
      detail: {
        type: "boring.plugin.error",
        id: "server-plugin",
        revision: 10,
        workspaceId: "other-workspace",
        message: "other workspace server error",
      },
    }))

    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(screen.queryByText("Plugin diagnostics (1)")).toBeNull()
    fireEvent.click(screen.getByText("Plugin diagnostics"))
    expect(await screen.findByText("Runtime plugin diagnostics")).not.toBeNull()
    expect(screen.queryByText("demo-plugin")).toBeNull()
    expect(screen.queryByText("server-plugin")).toBeNull()
  })
})

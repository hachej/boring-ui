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

vi.mock("@hachej/boring-ask-user/front", () => {
  const createAskUserPlugin = (options?: Record<string, unknown>) => ({ pluginId: "ask-user", pluginLabel: "Questions", options })
  const askUserPlugin = createAskUserPlugin()
  return { askUserPlugin, createAskUserPlugin, default: askUserPlugin }
})

vi.mock("@hachej/boring-diagram/front", () => ({
  diagramPlugin: { pluginId: "diagram", pluginLabel: "Diagram" },
}))

vi.mock("@hachej/boring-tasks/front", () => {
  const createTasksPlugin = () => ({ pluginId: "tasks", pluginLabel: "Tasks" })
  return { createTasksPlugin, default: createTasksPlugin() }
})

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
    window.history.replaceState(null, "", "/")
    document.title = ""
  })

  function mockWorkspacesMode(workspacesByCall: Array<Array<{ id: string; name: string; path: string; available: boolean }>>) {
    let call = 0
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith("/api/v1/workspace/meta")) {
        return new Response(JSON.stringify({ projectName: "Folder Workspace", workspacesMode: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }
      if (url.endsWith("/api/v1/local-workspaces")) {
        const workspaces = workspacesByCall[Math.min(call, workspacesByCall.length - 1)] ?? []
        call += 1
        return new Response(JSON.stringify({ workspaces }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }
      if (url.includes("/api/v1/agent/pi-chat/sessions")) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch
  }

  test("does not redirect away from a URL workspace that is still cold-starting", async () => {
    window.history.replaceState(null, "", "/workspace/target")
    // The URL-targeted workspace is in the list but not yet available (cold-starting).
    // A fallback is available. The fix: mount the URL workspace directly; let
    // WorkspaceAgentFront handle the boot/loading state rather than redirecting.
    mockWorkspacesMode([
      [
        { id: "other", name: "Other", path: "/other", available: true },
        { id: "target", name: "Target", path: "/target", available: false },
      ],
    ])

    render(<CliWorkspaceShell />)

    // Must mount the URL workspace, never the fallback.
    await waitFor(() => expect(workspaceAgentFrontSpy).toHaveBeenCalled())
    expect(workspaceAgentFrontSpy.mock.calls.at(-1)?.[0]).toMatchObject({
      workspaceId: "target",
      workspaceLayout: "plugin-tabs",
      workspaceSectionTitle: "Projects",
    })
    expect(window.location.pathname).toBe("/workspace/target")
  })

  test("waits for a URL workspace that is absent during cold start", async () => {
    window.history.replaceState(null, "", "/workspace/target")
    // First list lacks the URL-targeted workspace (still initializing); a fallback is available.
    mockWorkspacesMode([
      [{ id: "other", name: "Other", path: "/other", available: true }],
      [
        { id: "other", name: "Other", path: "/other", available: true },
        { id: "target", name: "Target", path: "/target", available: true },
      ],
    ])

    render(<CliWorkspaceShell />)

    // It must not silently mount the fallback workspace.
    await screen.findByText("Loading workspace…")
    expect(workspaceAgentFrontSpy).not.toHaveBeenCalled()

    // Once the targeted workspace becomes available, it resolves to it (never the fallback).
    // The cold-start poll re-fetches after 1.5s, so allow extra time here.
    await waitFor(() => expect(workspaceAgentFrontSpy).toHaveBeenCalled(), { timeout: 4000 })
    expect(workspaceAgentFrontSpy.mock.calls.at(-1)?.[0]).toMatchObject({ workspaceId: "target" })
    expect(window.location.pathname).toBe("/workspace/target")
  })

  test("mounts the URL workspace directly when it is already available", async () => {
    window.history.replaceState(null, "", "/workspace/target")
    mockWorkspacesMode([
      [
        { id: "other", name: "Other", path: "/other", available: true },
        { id: "target", name: "Target", path: "/target", available: true },
      ],
    ])

    render(<CliWorkspaceShell />)

    await waitFor(() => expect(workspaceAgentFrontSpy).toHaveBeenCalled())
    expect(workspaceAgentFrontSpy.mock.calls.at(-1)?.[0]).toMatchObject({ workspaceId: "target" })
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
      workspaceLayout: "plugin-tabs",
      workspaceSectionTitle: "Project",
      appTitle: "Folder Workspace",
      plugins: [
        expect.objectContaining({ pluginId: "ask-user", options: { appLeftInbox: true } }),
        expect.any(Function),
        expect.objectContaining({ pluginId: "diagram" }),
        expect.objectContaining({ pluginId: "tasks" }),
      ],
    })

    expect(screen.getByText("v1.2.3")).not.toBeNull()
    expect(screen.queryByText("Trusted local runtime plugins")).toBeNull()
    expect(screen.queryByText("Plugin diagnostics")).toBeNull()
  })

  test("honors a legacy ?session= deep link once, then strips it from the URL", async () => {
    window.history.replaceState(null, "", "/workspace/target?session=chat-legacy")
    mockWorkspacesMode([
      [{ id: "target", name: "Target", path: "/target", available: true }],
    ])

    render(<CliWorkspaceShell />)

    await waitFor(() => expect(workspaceAgentFrontSpy).toHaveBeenCalled())
    // The legacy session id is forwarded once to seed the active session…
    expect(workspaceAgentFrontSpy.mock.calls.at(-1)?.[0]).toMatchObject({
      workspaceId: "target",
      activeSessionId: "chat-legacy",
    })
    // …and onActiveSessionIdChange is no longer wired up (the URL is not synced).
    expect(workspaceAgentFrontSpy.mock.calls.at(-1)?.[0].onActiveSessionIdChange).toBeUndefined()
    // The param is dropped from the address bar; the path is preserved.
    await waitFor(() => expect(window.location.search).toBe(""))
    expect(window.location.pathname).toBe("/workspace/target")
  })

  test("does not write ?session= into the URL on a fresh open", async () => {
    window.history.replaceState(null, "", "/workspace/target")
    mockWorkspacesMode([
      [{ id: "target", name: "Target", path: "/target", available: true }],
    ])

    render(<CliWorkspaceShell />)

    await waitFor(() => expect(workspaceAgentFrontSpy).toHaveBeenCalled())
    expect(workspaceAgentFrontSpy.mock.calls.at(-1)?.[0]).toMatchObject({ workspaceId: "target" })
    expect(workspaceAgentFrontSpy.mock.calls.at(-1)?.[0].activeSessionId).toBeUndefined()
    expect(window.location.search).toBe("")
    expect(window.location.pathname).toBe("/workspace/target")
  })

  test("scopes a legacy ?session= to the workspace the link pointed at", async () => {
    // The deep link targets `target`, but `other` is what becomes active first.
    // The legacy session must not bleed onto a different workspace.
    window.history.replaceState(null, "", "/workspace/other?session=chat-legacy")
    mockWorkspacesMode([
      [
        { id: "other", name: "Other", path: "/other", available: true },
        { id: "target", name: "Target", path: "/target", available: true },
      ],
    ])

    render(<CliWorkspaceShell />)

    await waitFor(() => expect(workspaceAgentFrontSpy).toHaveBeenCalled())
    // `other` is the URL workspace here, so it does receive the legacy session.
    expect(workspaceAgentFrontSpy.mock.calls.at(-1)?.[0]).toMatchObject({
      workspaceId: "other",
      activeSessionId: "chat-legacy",
    })
    await waitFor(() => expect(window.location.search).toBe(""))
  })

  test("workspaces mode passes the active workspace name as the document-title label", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith("/api/v1/workspace/meta")) {
        return new Response(JSON.stringify({ projectName: "Boring UI", workspacesMode: true, version: "1.0.0" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }
      if (url.endsWith("/api/v1/local-workspaces")) {
        return new Response(JSON.stringify({
          workspaces: [{ id: "ws-alpha-be8d3c24", name: "Alpha Project", path: "/tmp/ws-alpha", available: true }],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }
      if (url.includes("/api/v1/agent/pi-chat/sessions")) {
        return new Response(JSON.stringify([
          { id: "chat-1", title: "Check Qwen compatibility", updatedAt: "2026-06-15T00:00:00.000Z" },
          { id: "chat-2", title: "Research account deletion", updatedAt: "2026-06-14T00:00:00.000Z" },
        ]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    render(<CliWorkspaceShell />)

    await waitFor(() => expect(workspaceAgentFrontSpy).toHaveBeenCalled())
    // The tab title comes from workspaceLabel; it must be the friendly name,
    // not the slug+hash workspace id.
    await waitFor(() => expect(workspaceAgentFrontSpy.mock.calls.at(-1)?.[0]).toMatchObject({
      workspaceId: "ws-alpha-be8d3c24",
      workspaceLabel: "Alpha Project",
      workspaceLayout: "plugin-tabs",
      workspaceSectionTitle: "Projects",
      appLeftProjects: expect.arrayContaining([expect.objectContaining({
        id: "ws-alpha-be8d3c24",
        name: "Alpha Project",
        sessionCount: 2,
        sessions: expect.arrayContaining([expect.objectContaining({ id: "chat-1", title: "Check Qwen compatibility" })]),
      })]),
    }))
  })

  test("recovers from a transient local-workspaces fetch failure instead of latching the empty state", async () => {
    // Root URL (no /workspace/<id>); the first local-workspaces fetch fails
    // transiently (e.g. cold-start 503), the retry succeeds and returns items.
    window.history.replaceState(null, "", "/")
    let wsCall = 0
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith("/api/v1/workspace/meta")) {
        return new Response(JSON.stringify({ projectName: "Boring UI", workspacesMode: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }
      if (url.endsWith("/api/v1/local-workspaces")) {
        wsCall += 1
        if (wsCall === 1) {
          return new Response(JSON.stringify({ error: "warming" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          })
        }
        return new Response(JSON.stringify({
          workspaces: [{ id: "ws-alpha-be8d3c24", name: "Alpha Project", path: "/tmp/ws-alpha", available: true }],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }
      if (url.includes("/api/v1/agent/pi-chat/sessions")) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    render(<CliWorkspaceShell />)

    // The transient failure must NOT render the dead-end "No local workspaces" screen.
    await screen.findByText("Loading workspaces…")
    expect(screen.queryByText("No local workspaces")).toBeNull()

    // The scheduled retry (1.5s) succeeds and the workspace mounts.
    await waitFor(() => expect(workspaceAgentFrontSpy).toHaveBeenCalled(), { timeout: 4000 })
    expect(workspaceAgentFrontSpy.mock.calls.at(-1)?.[0]).toMatchObject({ workspaceId: "ws-alpha-be8d3c24" })
    expect(screen.queryByText("No local workspaces")).toBeNull()
  })
})

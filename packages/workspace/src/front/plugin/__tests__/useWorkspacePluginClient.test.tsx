import { afterEach, describe, expect, it, vi } from "vitest"
import { renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import {
  WorkspacePluginClientProvider,
  createWorkspacePluginClient,
  useWorkspacePluginClient,
} from "../useWorkspacePluginClient"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("createWorkspacePluginClient", () => {
  it("allows cross-origin apiBaseUrl when no workspace/auth context can leak", () => {
    expect(() => createWorkspacePluginClient("https://api.example.com")).not.toThrow()
  })

  it("rejects cross-origin apiBaseUrl before attaching privileged headers", () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    expect(() => createWorkspacePluginClient("https://attacker.example", "workspace-1", {
      Authorization: "Bearer token",
    })).toThrow("same-origin API base URLs")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rejects absolute and protocol-relative paths before attaching privileged headers", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const client = createWorkspacePluginClient("", "workspace-1", {
      Authorization: "Bearer token",
    })

    await expect(client.postJson("https://attacker.example/collect", {})).rejects.toThrow("same-origin API paths")
    await expect(client.postJson("//attacker.example/collect", {})).rejects.toThrow("same-origin API paths")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("preserves custom missing-file guidance when raw file API returns a JSON 404", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "file not found" } }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    })))

    const client = createWorkspacePluginClient("", "workspace-1")

    await expect(client.readJsonFile(".pi/extensions/example/data.json", {
      missingMessage: "No data yet. Ask the agent to refresh the dashboard.",
    })).rejects.toThrow("No data yet. Ask the agent to refresh the dashboard.: file not found (404)")
  })

  it("strips inherited content-type headers for body-less POSTs", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }))
    vi.stubGlobal("fetch", fetchMock)

    const client = createWorkspacePluginClient("", "workspace-1", {
      Authorization: "Bearer token",
      "Content-Type": "application/json",
    })

    await client.postJson("/api/v1/refresh")

    const firstCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(firstCall[1].headers).toEqual({
      Authorization: "Bearer token",
      "x-boring-workspace-id": "workspace-1",
    })
    expect(firstCall[1].body).toBeUndefined()
  })

  it("does not advertise JSON content for body-less POSTs", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }))
    vi.stubGlobal("fetch", fetchMock)

    const client = createWorkspacePluginClient("", "workspace-1")

    await client.postJson("/api/v1/refresh")

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/refresh?workspaceId=workspace-1",
      expect.objectContaining({
        method: "POST",
        headers: { "x-boring-workspace-id": "workspace-1" },
      }),
    )
    const firstCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(firstCall[1].body).toBeUndefined()
  })

  it("adds workspace query, workspace header, auth headers, and JSON content type", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }))
    vi.stubGlobal("fetch", fetchMock)

    const client = createWorkspacePluginClient("/base/", "workspace-1", {
      Authorization: "Bearer token",
    })

    await client.postJson("/api/v1/example?x=1", { hello: "world" })

    expect(fetchMock).toHaveBeenCalledWith(
      "/base/api/v1/example?x=1&workspaceId=workspace-1",
      expect.objectContaining({
        credentials: "include",
        method: "POST",
        body: JSON.stringify({ hello: "world" }),
        headers: expect.objectContaining({
          Authorization: "Bearer token",
          "content-type": "application/json",
          "x-boring-workspace-id": "workspace-1",
        }),
      }),
    )
  })
})

describe("useWorkspacePluginClient", () => {
  it("allows host-configured cross-origin apiBaseUrl with workspace/auth context", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <WorkspacePluginClientProvider
        apiBaseUrl="https://api.example.com"
        workspaceId="workspace-2"
        authHeaders={{ Authorization: "Bearer auth" }}
      >
        {children}
      </WorkspacePluginClientProvider>
    )

    const { result } = renderHook(() => useWorkspacePluginClient(), { wrapper })

    expect(result.current.apiBaseUrl).toBe("https://api.example.com")
    expect(result.current.workspaceHeaders()).toEqual({ "x-boring-workspace-id": "workspace-2" })
  })

  it("reads the client from WorkspacePluginClientProvider", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <WorkspacePluginClientProvider
        apiBaseUrl="/workspace-api"
        workspaceId="workspace-2"
        authHeaders={{ Authorization: "Bearer auth" }}
      >
        {children}
      </WorkspacePluginClientProvider>
    )

    const { result } = renderHook(() => useWorkspacePluginClient(), { wrapper })

    expect(result.current.apiBaseUrl).toBe("/workspace-api")
    expect(result.current.workspaceId).toBe("workspace-2")
    expect(result.current.workspaceHeaders()).toEqual({ "x-boring-workspace-id": "workspace-2" })
  })
})

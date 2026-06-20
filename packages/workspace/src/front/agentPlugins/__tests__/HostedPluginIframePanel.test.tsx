import React from "react"
import { render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, test, vi } from "vitest"
import { HostedPluginIframePanel } from "../HostedPluginIframePanel"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("HostedPluginIframePanel", () => {
  test("renders strict sandboxed srcdoc iframe and fetches with nonce", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ srcdoc: "<p>hosted</p>" }) }))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    render(<HostedPluginIframePanel {...({ params: { apiBaseUrl: "/agent", workspaceId: "w1", pluginId: "p1", panelId: "main", revision: 1 } } as any)} />)
    const iframe = screen.getByTitle("p1:main") as HTMLIFrameElement
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts")
    expect(iframe.getAttribute("sandbox")).not.toContain("allow-forms")
    expect(iframe.getAttribute("sandbox")).not.toContain("allow-same-origin")
    expect(iframe.getAttribute("referrerpolicy")).toBe("no-referrer")
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [[fetchUrl]] = fetchMock.mock.calls as unknown as [[RequestInfo | URL]]
    const url = String(fetchUrl)
    expect(url).toContain("/api/v1/agent-plugins/p1/iframe/main/document?nonce=")
    expect(url).toContain("workspaceId=w1")
    await waitFor(() => expect(iframe.srcdoc).toBe("<p>hosted</p>"))
  })
})

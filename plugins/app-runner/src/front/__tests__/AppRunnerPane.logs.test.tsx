import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { PaneProps } from "@hachej/boring-workspace/plugin"
import { AppRunnerPane, type AppRunnerPaneParams } from "../AppRunnerPane"

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })
}

function paneProps(params: AppRunnerPaneParams): PaneProps<AppRunnerPaneParams> {
  return { params, api: {} as PaneProps["api"], containerApi: {} as PaneProps["containerApi"] }
}

describe("AppRunnerPane logs section", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("renders the selected app's recent errors and log lines under the iframe", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith("/apps")) {
        return jsonResponse({
          workspaceId: "ws-1",
          apps: [{ appName: "myapp", workspaceId: "ws-1", kind: "app", version: 2, sha: "abcdef123456", url: "x", updatedAt: "now", appId: "ws-1--myapp", appUrl: "/api/v1/plugins/app-runner/open/myapp/" }],
        })
      }
      if (url.endsWith("/versions")) {
        return jsonResponse({ versions: [{ version: 2, kind: "app", sha: "abcdef123456", created_at: "now", current: true, previewUrl: "/p/2/" }], appId: "ws-1--myapp", appUrl: "/open/" })
      }
      if (url.endsWith("/logs")) {
        return jsonResponse({ lines: ["server started", "GET / 200"], errors: ["TypeError: boom"] })
      }
      throw new Error(`unexpected fetch ${url}`)
    }))

    render(<AppRunnerPane {...paneProps({ appName: "myapp" })} />)

    expect(await screen.findByText("TypeError: boom")).toBeInTheDocument()
    expect(screen.getByText("GET / 200")).toBeInTheDocument()
    expect(screen.getByTestId("app-runner-logs")).toBeInTheDocument()
    expect(screen.getByTestId("app-runner-metadata")).toHaveTextContent("Kind: app")
    expect(screen.getByTestId("app-runner-metadata")).toHaveTextContent("SHA: abcdef123456")
    expect(screen.getByTitle("myapp preview")).toHaveAttribute("sandbox", "allow-scripts allow-forms")
    expect(screen.getByTitle("myapp preview").getAttribute("sandbox")).not.toContain("allow-same-origin")
  })
})

import { render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DataProvider } from "../data/DataProvider"
import { MediaViewer } from "./MediaViewer"

function renderViewer(filesystem?: string) {
  return render(
    <DataProvider apiBaseUrl="">
      <MediaViewer path="assets/chart.png" kind="image" filesystem={filesystem} onReload={vi.fn()} />
    </DataProvider>,
  )
}

describe("MediaViewer", () => {
  const originalFetch = globalThis.fetch
  const originalCreateObjectUrl = URL.createObjectURL
  const originalRevokeObjectUrl = URL.revokeObjectURL

  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => new Response("missing", { status: 404 })) as typeof fetch
    URL.createObjectURL = vi.fn(() => "blob:preview")
    URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    URL.createObjectURL = originalCreateObjectUrl
    URL.revokeObjectURL = originalRevokeObjectUrl
  })

  it("keeps the reload action visible while the preview is loading or failed", async () => {
    renderViewer()

    expect(screen.getByRole("button", { name: "Reload chart.png" })).toBeInTheDocument()
    expect(await screen.findByText("Failed to load preview")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Reload chart.png" })).toBeInTheDocument()
  })

  it("passes company filesystem to raw preview and sanitizes denied errors", async () => {
    renderViewer("company_context")

    expect(await screen.findByText("not found or denied")).toBeInTheDocument()
    const url = String(vi.mocked(globalThis.fetch).mock.calls[0][0])
    expect(url).toContain("filesystem=company_context")
  })
})

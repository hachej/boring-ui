import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Automation } from "../../shared"
import { AutomationPromptPanel } from "../AutomationPromptPanel"
import { AutomationClientProvider } from "../AutomationRuntimeContext"
import type { AutomationClient } from "../client"

function automation(): Automation {
  return {
    id: "auto-1",
    title: "Daily digest",
    enabled: true,
    cron: "0 9 * * *",
    timezone: "UTC",
    model: "test:model",
    promptRef: "hosted:auto-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }
}

function client(overrides: Partial<AutomationClient> = {}): AutomationClient {
  return {
    getAutomation: vi.fn(async () => automation()),
    getPrompt: vi.fn(async () => "# Original prompt"),
    getPromptSnapshot: vi.fn(async () => ({ prompt: "# Original prompt", updatedAt: "2026-01-01T00:00:00.000Z" })),
    updatePrompt: vi.fn(async () => undefined),
    ...overrides,
  } as AutomationClient
}

function renderPromptPanel(value: AutomationClient) {
  return render(
    <AutomationClientProvider value={value}>
      <AutomationPromptPanel params={{ automationId: "auto-1" }} api={{} as never} containerApi={{} as never} />
    </AutomationClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  sessionStorage.clear()
  vi.clearAllMocks()
})

describe("AutomationPromptPanel", () => {
  it("loads and saves the canonical prompt in the workbench", async () => {
    const value = client()
    renderPromptPanel(value)

    const editor = await screen.findByLabelText("Daily digest prompt")
    expect(editor).toHaveValue("# Original prompt")
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()

    fireEvent.change(editor, { target: { value: "# Updated prompt" } })
    expect(screen.getByRole("button", { name: "Reload" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => expect(value.updatePrompt).toHaveBeenCalledWith("auto-1", "# Updated prompt", {
      expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
    }))
    expect(await screen.findByRole("status")).toHaveTextContent("Prompt saved.")
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
  })

  it("keeps prompt actions touch-sized on mobile", async () => {
    const originalWidth = window.innerWidth
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 })
    try {
      renderPromptPanel(client())
      await screen.findByLabelText("Daily digest prompt")
      expect(screen.getByRole("button", { name: "Reload" })).toHaveStyle({ minHeight: "44px" })
      expect(screen.getByRole("button", { name: "Save" })).toHaveStyle({ minHeight: "44px" })
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth })
    }
  })

  it("supports the workbench save shortcut", async () => {
    const value = client()
    renderPromptPanel(value)

    const editor = await screen.findByLabelText("Daily digest prompt")
    fireEvent.change(editor, { target: { value: "Run the report" } })
    fireEvent.keyDown(editor, { key: "s", ctrlKey: true })

    await waitFor(() => expect(value.updatePrompt).toHaveBeenCalledWith("auto-1", "Run the report", {
      expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
    }))
  })

  it("restores an unsaved draft after the workbench tab remounts", async () => {
    const value = client()
    const first = renderPromptPanel(value)
    const editor = await screen.findByLabelText("Daily digest prompt")
    fireEvent.change(editor, { target: { value: "Recovered draft" } })
    first.unmount()

    renderPromptPanel(value)
    expect(await screen.findByLabelText("Daily digest prompt")).toHaveValue("Recovered draft")
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled()
  })

  it("keeps save failures visible without discarding the draft", async () => {
    const value = client({ updatePrompt: vi.fn(async () => { throw new Error("save unavailable") }) })
    renderPromptPanel(value)

    const editor = await screen.findByLabelText("Daily digest prompt")
    fireEvent.change(editor, { target: { value: "Unsaved draft" } })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("save unavailable")
    expect(editor).toHaveValue("Unsaved draft")
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled()
  })
})

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AutomationPromptPanel } from "../AutomationPromptPanel"
import { AutomationClientProvider } from "../AutomationRuntimeContext"
import type { AutomationClient } from "../client"

function client(overrides: Partial<AutomationClient> = {}): AutomationClient {
  return {
    getPrompt: vi.fn(async () => "# Original prompt"),
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
  vi.clearAllMocks()
})

describe("AutomationPromptPanel", () => {
  it("loads and saves the canonical prompt", async () => {
    const value = client()
    renderPromptPanel(value)

    const editor = await screen.findByLabelText("Automation prompt")
    expect(editor).toHaveValue("# Original prompt")
    fireEvent.change(editor, { target: { value: "# Updated prompt" } })
    expect(screen.getByRole("button", { name: "Reload" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => expect(value.updatePrompt).toHaveBeenCalledWith("auto-1", "# Updated prompt"))
    expect(await screen.findByRole("status")).toHaveTextContent("Prompt saved.")
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
  })

  it("supports Ctrl/⌘+S", async () => {
    const value = client()
    renderPromptPanel(value)
    const editor = await screen.findByLabelText("Automation prompt")

    fireEvent.change(editor, { target: { value: "Run the report" } })
    fireEvent.keyDown(editor, { key: "s", ctrlKey: true })

    await waitFor(() => expect(value.updatePrompt).toHaveBeenCalledWith("auto-1", "Run the report"))
  })

  it("keeps save failures visible without discarding the draft", async () => {
    const value = client({ updatePrompt: vi.fn(async () => { throw new Error("save unavailable") }) })
    renderPromptPanel(value)
    const editor = await screen.findByLabelText("Automation prompt")

    fireEvent.change(editor, { target: { value: "Unsaved draft" } })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("save unavailable")
    expect(editor).toHaveValue("Unsaved draft")
  })

  it("uses mobile-first touch targets with compact desktop overrides", async () => {
    renderPromptPanel(client())
    await screen.findByLabelText("Automation prompt")
    expect(screen.getByRole("button", { name: "Reload" })).toHaveClass("min-h-11", "sm:min-h-8")
    expect(screen.getByRole("button", { name: "Save" })).toHaveClass("min-h-11", "sm:min-h-8")
  })
})

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { Automation, AutomationRun } from "../../shared"
import { AutomationPanel } from "../AutomationPanel"
import { AutomationClientProvider } from "../AutomationRuntimeContext"
import type { AutomationClient } from "../client"

const shellState = vi.hoisted(() => ({
  current: undefined as undefined | {
    openArtifact: ReturnType<typeof vi.fn>
    openDetachedChat: ReturnType<typeof vi.fn>
  },
}))

vi.mock("@hachej/boring-workspace/plugin", () => ({
  useWorkspaceShellCapabilities: () => shellState.current,
}))

function automation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: "auto-1",
    title: "Daily digest",
    enabled: true,
    cron: "0 9 * * *",
    timezone: "UTC",
    model: "test:gpt-5.5",
    promptRef: ".pi/automation/prompts/auto-1.md",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  }
}

function automationRun(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: "run-1",
    automationId: "auto-1",
    sessionId: "session-1",
    status: "succeeded",
    trigger: "manual",
    scheduledFor: null,
    startedAt: "2026-01-02T09:00:00.000Z",
    completedAt: "2026-01-02T09:01:00.000Z",
    durationMs: 60_000,
    inputTokens: 100,
    outputTokens: 25,
    totalTokens: 125,
    promptSnapshot: "# Prompt",
    modelSnapshot: "gpt-5.5",
    error: null,
    createdAt: "2026-01-02T09:00:00.000Z",
    updatedAt: "2026-01-02T09:01:00.000Z",
    ...overrides,
  }
}

function createClient(overrides: Partial<Record<keyof AutomationClient, ReturnType<typeof vi.fn>>> = {}) {
  return {
    listAutomations: vi.fn(async () => []),
    createAutomation: vi.fn(async (input) => automation({ ...input, id: "created-1" })),
    getAutomation: vi.fn(async (id) => automation({ id })),
    updateAutomation: vi.fn(async (id, patch) => automation({ id, ...patch })),
    deleteAutomation: vi.fn(async () => undefined),
    getPrompt: vi.fn(async () => "# Prompt"),
    updatePrompt: vi.fn(async () => undefined),
    runNow: vi.fn(async () => automationRun()),
    listRuns: vi.fn(async () => []),
    ...overrides,
  } as unknown as AutomationClient & Record<keyof AutomationClient, ReturnType<typeof vi.fn>>
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

function renderPanel(client: AutomationClient) {
  return render(
    <AutomationClientProvider value={client}>
      <AutomationPanel />
    </AutomationClientProvider>,
  )
}

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = function () {}
})

beforeEach(() => {
  shellState.current = {
    openArtifact: vi.fn(() => ({ success: false, reason: "no-artifact", message: "No artifact is available." })),
    openDetachedChat: vi.fn(() => ({ success: true })),
  }
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe("AutomationPanel", () => {
  it("shows loading and empty states for the automation list", async () => {
    const list = deferred<Automation[]>()
    const client = createClient({ listAutomations: vi.fn(() => list.promise) })

    const { container } = renderPanel(client)

    expect(container.querySelector('[data-boring-workspace-part="automation-panel"]')).toBeInTheDocument()
    expect(screen.getByText("Loading automations…")).toBeInTheDocument()

    await act(async () => {
      list.resolve([])
    })

    expect(await screen.findByText("No automations yet")).toBeInTheDocument()
  })

  it("shows accessible route errors", async () => {
    const client = createClient({ listAutomations: vi.fn(async () => { throw new Error("list failed") }) })

    renderPanel(client)

    expect(await screen.findByRole("alert")).toHaveTextContent("list failed")
  })

  it("validates create drafts before submitting with associated field errors and descriptions", async () => {
    const client = createClient()

    renderPanel(client)
    await screen.findByText("No automations yet")
    fireEvent.click(screen.getByRole("button", { name: "New" }))
    fireEvent.change(screen.getByLabelText("Cron"), { target: { value: "" } })
    fireEvent.change(screen.getByLabelText("Timezone"), { target: { value: "Mars/Base" } })
    fireEvent.submit(screen.getByRole("form", { name: "Create automation form" }))

    expect(await screen.findByText("Title is required.")).toBeInTheDocument()
    expect(screen.getByText("Invalid cron schedule. Use exactly five fields, for example 0 9 * * *.")).toHaveAttribute("id", "automation-cron-error")
    expect(screen.getByLabelText("Cron")).toHaveAttribute("aria-describedby", "automation-cron-description automation-cron-error")
    expect(screen.getByText("Invalid timezone. Use a valid IANA timezone, for example UTC or America/New_York.")).toHaveAttribute("id", "automation-timezone-error")
    expect(screen.getByLabelText("Timezone")).toHaveAttribute("aria-describedby", "automation-timezone-description automation-timezone-error")
    expect(screen.getByLabelText("Markdown prompt")).toHaveAttribute("aria-describedby", "automation-prompt-description")
    expect(client.createAutomation).not.toHaveBeenCalled()
  })

  it("loads a required model selection and creates a valid automation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      models: [{ provider: "test", id: "gpt-5.5", label: "Test GPT", available: true }],
    })))
    const client = createClient()

    renderPanel(client)
    await screen.findByText("No automations yet")
    fireEvent.click(screen.getByRole("button", { name: "New" }))
    expect(await screen.findByText("Select a model to continue.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Model" })).toHaveTextContent("Select model")

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Weekly review" } })
    fireEvent.click(screen.getByRole("button", { name: "Model" }))
    fireEvent.click(await screen.findByText("Test GPT"))
    fireEvent.click(screen.getByRole("button", { name: "Create automation" }))

    await waitFor(() => expect(client.createAutomation).toHaveBeenCalledWith(expect.objectContaining({
      title: "Weekly review",
      model: "test:gpt-5.5",
    })))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("explains model-service failures instead of presenting an empty picker", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({}, { status: 503 })))
    const client = createClient()

    renderPanel(client)
    await screen.findByText("No automations yet")
    fireEvent.click(screen.getByRole("button", { name: "New" }))

    expect(await screen.findByText("Models unavailable. Close and reopen the editor to retry.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Model" })).toBeDisabled()
  })

  it("exposes an accessible enabled switch and closes the editor without saving", async () => {
    const client = createClient()

    renderPanel(client)
    await screen.findByText("No automations yet")
    fireEvent.click(screen.getByRole("button", { name: "New" }))

    const enabled = screen.getByRole("switch", { name: "Automation enabled" })
    expect(enabled).toHaveAttribute("aria-checked", "true")
    fireEvent.click(enabled)
    expect(enabled).toHaveAttribute("aria-checked", "false")

    fireEvent.click(screen.getByRole("button", { name: "Close automation editor" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(client.createAutomation).not.toHaveBeenCalled()
  })

  it("keeps dirty editor drafts by disabling refresh while the editor is open", async () => {
    const existing = automation()
    const client = createClient({ listAutomations: vi.fn(async () => [existing]) })

    renderPanel(client)
    await screen.findByText(existing.title)
    fireEvent.click(screen.getByRole("button", { name: "Edit" }))

    const title = await screen.findByLabelText("Title")
    fireEvent.change(title, { target: { value: "Dirty local title" } })

    const refresh = screen.getByRole("button", { name: "Refresh", hidden: true })
    expect(refresh).toBeDisabled()
    fireEvent.click(refresh)

    expect(client.listAutomations).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText("Title")).toHaveValue("Dirty local title")
  })

  it("prevents every editor dismissal while a save is in flight", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      models: [{ provider: "test", id: "gpt-5.5", label: "Test GPT", available: true }],
    })))
    const promptSave = deferred<void>()
    const existing = automation()
    const client = createClient({
      listAutomations: vi.fn(async () => [existing]),
      updatePrompt: vi.fn(() => promptSave.promise),
    })

    renderPanel(client)
    await screen.findByText(existing.title)
    fireEvent.click(screen.getByRole("button", { name: "Edit" }))
    await screen.findByLabelText("Markdown prompt")
    fireEvent.click(screen.getByRole("button", { name: "Save automation" }))

    const close = screen.getByRole("button", { name: "Close automation editor" })
    expect(close).toBeDisabled()
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
    expect(screen.getByRole("dialog")).toBeInTheDocument()

    await act(async () => promptSave.resolve())
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(client.updateAutomation).toHaveBeenCalledTimes(1)
  })

  it("validates edit drafts, writes prompt before metadata, and refreshes after partial metadata failure", async () => {
    const existing = automation()
    const refreshed = automation({ title: "Server title", updatedAt: "2026-01-03T00:00:00.000Z" })
    const client = createClient({
      listAutomations: vi.fn(async () => [existing]),
      getPrompt: vi.fn()
        .mockResolvedValueOnce("# Fresh prompt")
        .mockResolvedValueOnce("# Server prompt"),
      updateAutomation: vi.fn(async () => { throw new Error("metadata down") }),
      getAutomation: vi.fn(async () => refreshed),
    })

    renderPanel(client)
    await screen.findByText(existing.title)
    fireEvent.click(screen.getByRole("button", { name: "Edit" }))

    const title = await screen.findByLabelText("Title")
    fireEvent.change(title, { target: { value: "" } })
    fireEvent.click(screen.getByRole("button", { name: "Save automation" }))

    expect(await screen.findByText("Title is required.")).toBeInTheDocument()
    expect(client.updatePrompt).not.toHaveBeenCalled()

    fireEvent.change(title, { target: { value: "Updated title" } })
    fireEvent.change(screen.getByLabelText("Markdown prompt"), { target: { value: "# Saved prompt" } })
    fireEvent.click(screen.getByRole("button", { name: "Save automation" }))

    await screen.findByText(/Prompt saved, but automation metadata was not saved: metadata down\./)
    expect(client.updatePrompt).toHaveBeenCalledWith(existing.id, "# Saved prompt")
    expect(client.updatePrompt.mock.invocationCallOrder[0]).toBeLessThan(client.updateAutomation.mock.invocationCallOrder[0])
    expect(client.getAutomation).toHaveBeenCalledWith(existing.id)
    await waitFor(() => {
      expect(screen.getByLabelText("Title")).toHaveValue("Server title")
      expect(screen.getByLabelText("Markdown prompt")).toHaveValue("# Server prompt")
    })
  })

  it("refreshes canonical prompt on every edit entry and ignores stale prompt loads", async () => {
    const firstPrompt = deferred<string>()
    const secondPrompt = deferred<string>()
    const existing = automation()
    const client = createClient({
      listAutomations: vi.fn(async () => [existing]),
      getPrompt: vi.fn()
        .mockReturnValueOnce(firstPrompt.promise)
        .mockReturnValueOnce(secondPrompt.promise),
    })

    renderPanel(client)
    await screen.findByText(existing.title)

    fireEvent.click(screen.getByRole("button", { name: "Edit" }))
    expect(await screen.findByText("Loading prompt…")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Close automation editor" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole("button", { name: "Edit" }))

    await act(async () => {
      secondPrompt.resolve("# Fresh canonical prompt")
    })
    expect(await screen.findByLabelText("Markdown prompt")).toHaveValue("# Fresh canonical prompt")

    await act(async () => {
      firstPrompt.resolve("# Stale prompt")
    })

    await waitFor(() => {
      expect(screen.getByLabelText("Markdown prompt")).toHaveValue("# Fresh canonical prompt")
    })
    expect(client.getPrompt).toHaveBeenCalledTimes(2)
  })

  it("runs once, disables duplicate clicks, and inserts the completed run into expanded history", async () => {
    const existing = automation()
    const run = automationRun()
    const pending = deferred<AutomationRun>()
    const client = createClient({
      listAutomations: vi.fn(async () => [existing]),
      runNow: vi.fn(() => pending.promise),
    })

    renderPanel(client)
    await screen.findByText(existing.title)
    const runButton = screen.getByRole("button", { name: `Run ${existing.title} now` })
    fireEvent.click(runButton)
    fireEvent.click(runButton)

    expect(runButton).toBeDisabled()
    expect(client.runNow).toHaveBeenCalledTimes(1)
    await act(async () => pending.resolve(run))

    expect(await screen.findByText("Automation finished. Open its session from run history.")).toBeInTheDocument()
    expect(screen.getByText("Succeeded")).toBeInTheDocument()
    expect(runButton).not.toBeDisabled()
  })

  it("expands run history, disables no-session runs, opens sessions, and reports shell open failures", async () => {
    shellState.current!.openDetachedChat = vi.fn(() => ({ success: false, reason: "open-failed", message: "Could not open chat." }))
    const existing = automation()
    const client = createClient({
      listAutomations: vi.fn(async () => [existing]),
      listRuns: vi.fn(async () => [
        automationRun({ id: "run-no-session", sessionId: null }),
        automationRun({ id: "run-with-session", sessionId: "session-1" }),
      ]),
    })

    renderPanel(client)
    await screen.findByText(existing.title)

    fireEvent.click(screen.getByText(existing.title))

    expect(await screen.findByText("Run history")).toBeInTheDocument()
    expect(await screen.findByLabelText("Run has no session")).toBeDisabled()
    fireEvent.click(screen.getByLabelText("Open session session-1"))

    expect(shellState.current!.openDetachedChat).toHaveBeenCalledWith("session-1", { title: "gpt-5.5", composingEnabled: true })
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not open chat.")
  })
})

import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { captureFrontPlugin } from "@hachej/boring-workspace/plugin"
import type { AskUserQuestion } from "../../shared/types"
import { askUserPlugin } from "../index"

const capturedPlugin = captureFrontPlugin(askUserPlugin)

const question: AskUserQuestion = {
  questionId: "q1",
  sessionId: "default",
  ownerPrincipalId: "anonymous",
  status: "ready",
  title: "Choose A or B",
  context: "Pick one.",
  answerToken: "secret",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  schema: { wireVersion: 1, fields: [{ type: "radio", name: "choice", label: "Choose one", required: true, options: [{ value: "A", label: "A" }, { value: "B", label: "B" }] }] },
}

function getProvider() {
  return capturedPlugin.registrations.providers[0]!.component as any
}

function getPanel() {
  return capturedPlugin.registrations.panels[0]!.component as any
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("askUserPlugin front shell", () => {
  it("reads pending question, submits with token/session, and closes ephemeral pane", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("human-input.v1.pending")) return Response.json({ ok: true, output: { pending: question } })
      if (String(url).endsWith("/api/v1/workspace-bridge/call")) return Response.json({ ok: true, output: { ok: true, status: "answered" } })
      if (String(url).endsWith("/api/v1/ui/state")) return Response.json({})
      return Response.json({})
    })
    vi.stubGlobal("fetch", fetchMock)
    const Provider = getProvider()
    const Panel = getPanel()
    const close = vi.fn()
    const closeWorkbench = vi.fn()
    render(<Provider apiBaseUrl="" activeSessionId="default"><Panel params={{ __closeWorkbenchOnDone: closeWorkbench }} api={{ close }} className="h-full" /></Provider>)

    expect(await screen.findByText("Choose A or B")).toBeInTheDocument()
    expect(screen.queryByText(/^Questions$/)).not.toBeInTheDocument()
    const choice = screen.getByRole("radio", { name: "A" })
    fireEvent.click(choice)
    fireEvent.change(choice, { target: { checked: true } })
    await waitFor(() => expect(screen.getByRole("button", { name: "Send answers" })).not.toBeDisabled())
    fireEvent.click(screen.getByRole("button", { name: "Send answers" }))

    await waitFor(() => expect(close).toHaveBeenCalled())
    expect(closeWorkbench).toHaveBeenCalled()
    const submitCall = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("human-input.v1.answer"))
    expect(JSON.parse(String(submitCall![1]!.body))).toMatchObject({
      op: "human-input.v1.answer",
      input: { questionId: "q1", sessionId: "default", answerToken: "secret", values: { choice: "A" } },
    })
  })

  it("rehydrates question from human-input pending when opened from surface metadata", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("human-input.v1.pending")) {
        return Response.json({ ok: true, output: { pending: question } })
      }
      if (String(url).endsWith("/api/v1/ui/state")) return Response.json({})
      return Response.json({})
    })
    vi.stubGlobal("fetch", fetchMock)
    const Provider = getProvider()
    const Panel = getPanel()
    const { container } = render(<Provider apiBaseUrl=""><Panel params={{ questionId: "q1", sessionId: "default" }} api={{ close: vi.fn() }} className="h-full" /></Provider>)

    expect(await screen.findByText("Choose A or B")).toBeInTheDocument()
    expect(container.firstElementChild).toHaveClass("overflow-hidden")
  })

  it("composer stop cancels pending question even when pane is closed", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("human-input.v1.pending")) return Response.json({ ok: true, output: { pending: question } })
      if (String(url).endsWith("/api/v1/workspace-bridge/call")) return Response.json({ ok: true, output: { ok: true, status: "cancelled" } })
      if (String(url).endsWith("/api/v1/ui/state")) return Response.json({})
      return Response.json({})
    })
    vi.stubGlobal("fetch", fetchMock)
    const Provider = getProvider()
    render(<Provider apiBaseUrl="" activeSessionId="default"><div>child</div></Provider>)
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("human-input.v1.pending"))).toBe(true))
    window.dispatchEvent(new CustomEvent("boring:workspace-composer-stop", { detail: { sessionId: "default" } }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("human-input.v1.cancel"))).toBe(true))
  })

  it("registers surface resolver and no-topbar panel output", () => {
    const panel = capturedPlugin.registrations.panels[0]!
    const resolver = capturedPlugin.registrations.surfaceResolvers[0]!
    expect(panel.id).toBe("ask-user.questions")
    expect(panel.chromeless).toBe(true)
    expect(resolver.resolve({ kind: "questions", target: "q1", meta: { sessionId: "default" } })).toMatchObject({ component: "ask-user.questions", id: "ask-user.questions", params: { questionId: "q1", sessionId: "default" } })
  })

  it("carries pluginId + pluginLabel metadata (definePlugin contract)", () => {
    expect(askUserPlugin.pluginId).toBe("ask-user")
    expect(askUserPlugin.pluginLabel).toBe("Questions")
  })
})

import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ASK_USER_UI_STATE_SLOTS } from "../../shared/constants"
import type { AskUserQuestion } from "../../shared/types"
import { askUserPlugin } from "../index"

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
  return askUserPlugin.outputs!.find((output) => output.type === "provider")!.component as any
}

function getPanel() {
  return (askUserPlugin.outputs!.find((output) => output.type === "panel") as any).panel.component as any
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("askUserPlugin front shell", () => {
  it("reads pending question, submits with token/session, and closes ephemeral pane", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (String(url).endsWith("/api/v1/ui/state")) return Response.json({ [ASK_USER_UI_STATE_SLOTS.PENDING]: { question } })
      if (String(url).endsWith("/api/v1/questions/commands")) return Response.json({ ok: true, status: "answered" })
      return Response.json({})
    })
    vi.stubGlobal("fetch", fetchMock)
    const Provider = getProvider()
    const Panel = getPanel()
    const close = vi.fn()
    const closeWorkbench = vi.fn()
    render(<Provider apiBaseUrl=""><Panel params={{ __closeWorkbenchOnDone: closeWorkbench }} api={{ close }} className="h-full" /></Provider>)

    expect(await screen.findByText("Choose A or B")).toBeInTheDocument()
    expect(screen.queryByText(/^Questions$/)).not.toBeInTheDocument()
    const choice = screen.getByRole("radio", { name: "A" })
    fireEvent.click(choice)
    fireEvent.change(choice, { target: { checked: true } })
    await waitFor(() => expect(screen.getByRole("button", { name: "Send answers" })).not.toBeDisabled())
    fireEvent.click(screen.getByRole("button", { name: "Send answers" }))

    await waitFor(() => expect(close).toHaveBeenCalled())
    expect(closeWorkbench).toHaveBeenCalled()
    const submitCall = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/api/v1/questions/commands") && String(init?.body).includes("questions.submit"))
    expect(JSON.parse(String(submitCall![1]!.body))).toMatchObject({
      kind: "questions.submit",
      params: { questionId: "q1", sessionId: "default", answerToken: "secret", values: { choice: "A" } },
    })
  })

  it("renders question from openSurface metadata even before pending-state poll catches up", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (String(url).endsWith("/api/v1/ui/state")) return Response.json({})
      return Response.json({})
    })
    vi.stubGlobal("fetch", fetchMock)
    const Provider = getProvider()
    const Panel = getPanel()
    render(<Provider apiBaseUrl=""><Panel params={{ questionId: "q1", question }} api={{ close: vi.fn() }} className="h-full" /></Provider>)

    expect(await screen.findByText("Choose A or B")).toBeInTheDocument()
  })

  it("composer stop cancels pending question even when pane is closed", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (String(url).endsWith("/api/v1/ui/state")) return Response.json({ [ASK_USER_UI_STATE_SLOTS.PENDING]: { question } })
      if (String(url).endsWith("/api/v1/questions/commands")) return Response.json({ ok: true, status: "cancelled" })
      return Response.json({})
    })
    vi.stubGlobal("fetch", fetchMock)
    const Provider = getProvider()
    render(<Provider apiBaseUrl=""><div>child</div></Provider>)
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/api/v1/ui/state"))).toBe(true))
    window.dispatchEvent(new CustomEvent("boring:workspace-composer-stop", { detail: { sessionId: "default" } }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/api/v1/questions/commands") && String(init?.body).includes("questions.cancel"))).toBe(true))
  })

  it("registers surface resolver and no-topbar panel output", () => {
    const panel = askUserPlugin.outputs!.find((output) => output.type === "panel") as any
    const resolver = askUserPlugin.outputs!.find((output) => output.type === "surface-resolver") as any
    expect(panel.panel.id).toBe("ask-user.questions")
    expect(panel.panel.chromeless).toBe(true)
    expect(resolver.resolver.resolve({ kind: "questions", target: "q1", meta: { question } })).toMatchObject({ component: "ask-user.questions", id: "ask-user.questions", params: { questionId: "q1", question } })
  })
})

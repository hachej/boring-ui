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
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

describe("askUserPlugin front shell", () => {
  it("reads pending question, submits with token/session, and closes ephemeral pane", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/v1/workspace-bridge/call")) {
        const body = JSON.parse(String(init?.body ?? "{}"))
        if (body.op === "human-input.v1.pending") return Response.json({ ok: true, output: { pending: question } })
        if (body.op === "human-input.v1.answer") return Response.json({ ok: true, output: { status: "answered" } })
      }
      return Response.json({})
    })
    vi.stubGlobal("fetch", fetchMock)
    const Provider = getProvider()
    const Panel = getPanel()
    const close = vi.fn()
    const closeWorkbench = vi.fn()
    render(<Provider apiBaseUrl=""><Panel params={{ __closeWorkbenchOnDone: closeWorkbench }} api={{ close }} className="h-full" /></Provider>)

    expect(await screen.findByText("Choose A or B")).toBeInTheDocument()
    expect(screen.getByText(/^Questions$/)).toBeInTheDocument()
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
      idempotencyKey: expect.stringMatching(/^ask-user-idem:/),
      input: { questionId: "q1", sessionId: "default", nonce: "secret", values: { choice: "A" } },
    })
    expect(JSON.parse(String(submitCall![1]!.body)).idempotencyKey).not.toBe("secret")
    expect(String(submitCall![1]!.headers)).not.toContain("Bearer")
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/api/v1/questions/commands"))).toBe(false)
  })

  it("renders question from openSurface metadata even before pending-state poll catches up", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true, output: { pending: null } }))
    vi.stubGlobal("fetch", fetchMock)
    const Provider = getProvider()
    const Panel = getPanel()
    render(<Provider apiBaseUrl=""><Panel params={{ questionId: "q1", question }} api={{ close: vi.fn() }} className="h-full" /></Provider>)

    expect(await screen.findByText("Choose A or B")).toBeInTheDocument()
  })

  it("composer stop cancels pending question even when pane is closed", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/v1/workspace-bridge/call")) {
        const body = JSON.parse(String(init?.body ?? "{}"))
        if (body.op === "human-input.v1.pending") return Response.json({ ok: true, output: { pending: question } })
        if (body.op === "human-input.v1.cancel") return Response.json({ ok: true, output: { status: "cancelled" } })
      }
      return Response.json({})
    })
    vi.stubGlobal("fetch", fetchMock)
    const Provider = getProvider()
    render(<Provider apiBaseUrl=""><div>child</div></Provider>)
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("human-input.v1.pending"))).toBe(true))
    window.dispatchEvent(new CustomEvent("boring:workspace-composer-stop", { detail: { sessionId: "default" } }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("human-input.v1.cancel"))).toBe(true))
    const cancelCall = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("human-input.v1.cancel"))
    expect(JSON.parse(String(cancelCall![1]!.body))).toMatchObject({
      op: "human-input.v1.cancel",
      idempotencyKey: expect.stringMatching(/^ask-user-idem:/),
      input: { questionId: "q1", sessionId: "default", nonce: "secret", reason: "user_cancelled" },
    })
    expect(JSON.parse(String(cancelCall![1]!.body)).idempotencyKey).not.toBe("secret")
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/api/v1/questions/commands"))).toBe(false)
  })

  it("close without explicit cancel does not cancel the pending question", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/v1/workspace-bridge/call")) {
        const body = JSON.parse(String(init?.body ?? "{}"))
        if (body.op === "human-input.v1.pending") return Response.json({ ok: true, output: { pending: question } })
        if (body.op === "human-input.v1.cancel") return Response.json({ ok: true, output: { status: "cancelled" } })
      }
      return Response.json({})
    })
    vi.stubGlobal("fetch", fetchMock)
    const Provider = getProvider()
    const Panel = getPanel()
    const { unmount } = render(<Provider apiBaseUrl=""><Panel params={{}} api={{ close: vi.fn() }} className="h-full" /></Provider>)

    expect(await screen.findByText("Choose A or B")).toBeInTheDocument()
    unmount()
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("human-input.v1.cancel"))).toBe(false)
  })

  it("reopens a pending question with draft values and never calls old command routes", async () => {
    const textQuestion: AskUserQuestion = { ...question, questionId: "draft-q", schema: { wireVersion: 1, fields: [{ type: "text", name: "answer", label: "Answer", required: true }] } }
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/v1/workspace-bridge/call")) {
        const body = JSON.parse(String(init?.body ?? "{}"))
        if (body.op === "human-input.v1.pending") return Response.json({ ok: true, output: { pending: textQuestion } })
      }
      return Response.json({})
    })
    vi.stubGlobal("fetch", fetchMock)
    const Provider = getProvider()
    const Panel = getPanel()
    const first = render(<Provider apiBaseUrl="" activeSessionId="default"><Panel params={{}} api={{ close: vi.fn() }} className="h-full" /></Provider>)

    const input = await screen.findByRole("textbox", { name: /answer/i })
    fireEvent.change(input, { target: { value: "draft answer" } })
    expect(input).toHaveValue("draft answer")
    first.unmount()

    render(<Provider apiBaseUrl="" activeSessionId="default"><Panel params={{}} api={{ close: vi.fn() }} className="h-full" /></Provider>)
    expect(await screen.findByRole("textbox", { name: /answer/i })).toHaveValue("draft answer")
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/api/v1/questions/commands"))).toBe(false)
  })

  it("explicit cancel asks before discarding dirty answers and then calls human-input.v1.cancel", async () => {
    const textQuestion: AskUserQuestion = { ...question, schema: { wireVersion: 1, fields: [{ type: "text", name: "answer", label: "Answer", required: true }] } }
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/v1/workspace-bridge/call")) {
        const body = JSON.parse(String(init?.body ?? "{}"))
        if (body.op === "human-input.v1.pending") return Response.json({ ok: true, output: { pending: textQuestion } })
        if (body.op === "human-input.v1.cancel") return Response.json({ ok: true, output: { status: "cancelled" } })
      }
      return Response.json({})
    })
    vi.stubGlobal("fetch", fetchMock)
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true)
    const Provider = getProvider()
    const Panel = getPanel()
    render(<Provider apiBaseUrl=""><Panel params={{}} api={{ close: vi.fn() }} className="h-full" /></Provider>)

    const input = await screen.findByRole("textbox", { name: /answer/i })
    fireEvent.change(input, { target: { value: "draft" } })
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(confirm).toHaveBeenCalledWith("Discard your answer?")
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("human-input.v1.cancel"))).toBe(false)
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("human-input.v1.cancel"))).toBe(true))
    const cancelCall = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("human-input.v1.cancel"))
    expect(JSON.parse(String(cancelCall![1]!.body))).toMatchObject({
      op: "human-input.v1.cancel",
      idempotencyKey: expect.stringMatching(/^ask-user-idem:/),
      input: { questionId: "q1", sessionId: "default", nonce: "secret", reason: "user_cancelled" },
    })
    expect(JSON.parse(String(cancelCall![1]!.body)).idempotencyKey).not.toBe("secret")
  })

  it("renders terminal question lifecycle cards", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true, output: { pending: null } }))
    vi.stubGlobal("fetch", fetchMock)
    const Provider = getProvider()
    const Panel = getPanel()
    for (const [status, label] of [["answered", "Question answered"], ["cancelled", "Question cancelled"], ["abandoned", "Question abandoned"], ["timed_out", "Question timed out"], ["ui_unavailable", "Question unavailable"]] as const) {
      const { unmount } = render(<Provider apiBaseUrl=""><Panel params={{ question: { ...question, status } }} api={{ close: vi.fn() }} className="h-full" /></Provider>)
      expect(await screen.findByText(label)).toBeInTheDocument()
      unmount()
    }
  })

  it("registers surface resolver and no-topbar panel output", () => {
    const panel = capturedPlugin.registrations.panels[0]!
    const resolver = capturedPlugin.registrations.surfaceResolvers[0]!
    expect(panel.id).toBe("ask-user.questions")
    expect(panel.chromeless).toBe(true)
    expect(resolver.resolve({ kind: "questions", target: "q1", meta: { question } })).toMatchObject({ component: "ask-user.questions", id: "ask-user.questions", params: { questionId: "q1", question } })
    expect(capturedPlugin.registrations.surfaceResolvers[1]!.resolve({ kind: "human-input", target: "q1", meta: { question: { ...question, status: "pending", nonce: "secret", payload: { title: question.title, context: question.context, schema: question.schema } } } })).toMatchObject({ component: "ask-user.questions", params: { question: { answerToken: "secret", status: "ready" } } })
  })

  it("carries pluginId + pluginLabel metadata (definePlugin contract)", () => {
    expect(askUserPlugin.pluginId).toBe("hachej-boring-ask-user")
    expect(askUserPlugin.pluginLabel).toBe("Questions")
  })
})
